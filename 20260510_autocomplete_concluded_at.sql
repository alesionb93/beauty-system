-- =====================================================================
-- Fix: preencher agendamentos.concluded_at no fluxo de AUTO-CONCLUSÃO
-- =====================================================================
-- Contexto:
--   A "auto-conclusão" do app é puramente visual (frontend, script.js
--   isAppointmentAutoCompleted): now() > data+hora+duração+30min buffer.
--   O DB não recebe UPDATE, então o trigger trg_fill_agendamento_concluded_at
--   nunca dispara para esses casos e concluded_at fica NULL.
--
-- Estratégia (mais minimalista e segura possível):
--   * NÃO altera status (preserva dashboards, métricas, comportamento visual).
--   * NÃO sobrescreve concluded_at já preenchido.
--   * Apenas popula concluded_at com o "instante efetivo de fim do
--     atendimento" (data + hora + duração + buffer 30min) para os
--     agendamentos que JÁ passaram desse instante e não estão cancelados.
--   * Roda em backfill único e em job pg_cron a cada 5 minutos.
--
-- Premissas validadas no script.js:
--   - AUTO_CONCLUSAO_BUFFER_MIN = 30
--   - Status considerados "cancelados" e portanto NUNCA auto-concluídos:
--       'cancelado', 'desmarcado', 'excluido', 'excluído'
--     (NB: 'cancelado_com_venda' já vem persistido com status='concluido'
--      e concluded_at é setado pela conclusão manual; este script o ignora
--      via filtro status='concluido' já cumprido pelo trigger atual.)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Função: duração total de um agendamento, em minutos.
--    Replica getAppointmentTotalDuration() do frontend, com fallback 30.
--    Usa a tabela agendamento_servicos quando existe; caso contrário,
--    cai no servico único / default. Mantém 30 como fallback final.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agendamento_duracao_total_min(
  p_agendamento_id uuid
) RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total integer := 0;
  v_has_table boolean;
BEGIN
  -- Tenta somar via agendamento_servicos (estrutura mais comum).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='agendamento_servicos'
  ) INTO v_has_table;

  IF v_has_table THEN
    EXECUTE format($f$
      SELECT COALESCE(SUM(COALESCE(NULLIF(asv.duracao,0), sp.duracao, 30)), 0)::int
      FROM public.agendamento_servicos asv
      LEFT JOIN public.servicos sp ON sp.id = asv.servico_id
      WHERE asv.agendamento_id = %L
    $f$, p_agendamento_id) INTO v_total;
  END IF;

  -- Fallback: serviço único na própria linha do agendamento.
  IF v_total IS NULL OR v_total = 0 THEN
    SELECT COALESCE(NULLIF(s.duracao,0), 30)::int
      INTO v_total
      FROM public.agendamentos a
      LEFT JOIN public.servicos s
        ON s.id = a.servico_id
      WHERE a.id = p_agendamento_id;
  END IF;

  RETURN COALESCE(NULLIF(v_total,0), 30);
EXCEPTION WHEN OTHERS THEN
  -- Schema diferente do esperado: devolve fallback seguro.
  RETURN 30;
END;
$$;

COMMENT ON FUNCTION public.fn_agendamento_duracao_total_min(uuid) IS
'Replica getAppointmentTotalDuration() do frontend. Fallback 30min.';

-- ---------------------------------------------------------------------
-- 2) Função: instante efetivo de fim (auto-conclusão) de um agendamento.
--    = (data + hora) + duração_total + 30min de buffer.
--    Retorna timestamptz (assumindo timezone do servidor; ajustar se
--    o app gravar em outro fuso). Mantém compatibilidade com o cálculo
--    feito hoje no frontend (que usa horário local do navegador).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agendamento_auto_end_at(
  p_agendamento_id uuid
) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT ((a.data::timestamp + a.hora)
          + make_interval(mins => public.fn_agendamento_duracao_total_min(a.id) + 30)
         ) AT TIME ZONE 'America/Sao_Paulo'
  FROM public.agendamentos a
  WHERE a.id = p_agendamento_id;
$$;

COMMENT ON FUNCTION public.fn_agendamento_auto_end_at(uuid) IS
'Instante de auto-conclusão visual: data+hora+duração+30min (BRT).';

-- ---------------------------------------------------------------------
-- 3) Procedure de reconciliação: popula concluded_at para agendamentos
--    que JÁ passaram do instante de auto-conclusão e ainda estão NULL.
--    NÃO altera status. NÃO sobrescreve concluded_at existente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reconcile_auto_concluded_at(
  p_limit integer DEFAULT 5000
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  WITH candidatos AS (
    SELECT a.id,
           public.fn_agendamento_auto_end_at(a.id) AS end_at
    FROM public.agendamentos a
    WHERE a.concluded_at IS NULL
      AND lower(coalesce(a.status::text,'')) NOT IN
          ('cancelado','desmarcado','excluido','excluído')
      -- Pré-filtro barato: só agendamentos cujo dia já passou
      -- ou está acabando hoje (evita varrer futuro).
      AND a.data <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ORDER BY a.data DESC, a.hora DESC
    LIMIT p_limit
  ),
  para_atualizar AS (
    SELECT id, end_at
    FROM candidatos
    WHERE end_at IS NOT NULL
      AND end_at < now()
  )
  UPDATE public.agendamentos a
     SET concluded_at = pa.end_at
    FROM para_atualizar pa
   WHERE a.id = pa.id
     AND a.concluded_at IS NULL;  -- guarda anti-race

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.fn_reconcile_auto_concluded_at(integer) IS
'Popula concluded_at de agendamentos auto-concluídos visualmente. Não toca status.';

-- ---------------------------------------------------------------------
-- 4) Índice de apoio (parcial) — torna a varredura barata em produção.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agendamentos_pending_concluded_at
  ON public.agendamentos (data, hora)
  WHERE concluded_at IS NULL;

-- ---------------------------------------------------------------------
-- 5) Backfill imediato (em lotes para não travar locks longos).
--    Roda em loop até esvaziar o backlog histórico.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_batch integer;
  v_total integer := 0;
BEGIN
  LOOP
    SELECT public.fn_reconcile_auto_concluded_at(5000) INTO v_batch;
    v_total := v_total + COALESCE(v_batch, 0);
    EXIT WHEN COALESCE(v_batch,0) = 0;
  END LOOP;
  RAISE NOTICE '[concluded_at backfill] linhas atualizadas: %', v_total;
END$$;

-- ---------------------------------------------------------------------
-- 6) Job pg_cron a cada 5 minutos (mantém DB em sincronia com o
--    frontend, que também re-renderiza a cada 60s).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove agendamento anterior (idempotente).
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname = 'reconcile_auto_concluded_at';

    PERFORM cron.schedule(
      'reconcile_auto_concluded_at',
      '*/5 * * * *',
      $cron$ SELECT public.fn_reconcile_auto_concluded_at(5000); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron não instalado — agende fn_reconcile_auto_concluded_at externamente.';
  END IF;
END$$;

COMMIT;

-- =====================================================================
-- ROLLBACK (se necessário):
--   SELECT cron.unschedule('reconcile_auto_concluded_at');
--   DROP INDEX IF EXISTS public.idx_agendamentos_pending_concluded_at;
--   DROP FUNCTION IF EXISTS public.fn_reconcile_auto_concluded_at(integer);
--   DROP FUNCTION IF EXISTS public.fn_agendamento_auto_end_at(uuid);
--   DROP FUNCTION IF EXISTS public.fn_agendamento_duracao_total_min(uuid);
-- (concluded_at populado pelo backfill permanece — é seguro manter.)
-- =====================================================================
