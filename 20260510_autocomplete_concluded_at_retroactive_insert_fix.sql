-- =====================================================================
-- Hotfix complementar: concluded_at para retroativos já criados
-- =====================================================================
-- A correção de criação/edição retroativa imediata está no frontend
-- (/site/script.js), após todos os agendamento_servicos serem gravados.
--
-- Este SQL é apenas complementar/seguro:
--   1. Remove triggers experimentais caso tenham sido aplicados.
--   2. Reexecuta a reconciliação em lote para registros retroativos que
--      já existiam antes do ajuste do frontend.
--
-- Garantias:
--   * NÃO altera status.
--   * NÃO sobrescreve concluded_at existente.
--   * NÃO mexe em dashboards/métricas/regras visuais.
-- =====================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_agendamento_servicos_auto_concluded_at
  ON public.agendamento_servicos;
DROP TRIGGER IF EXISTS trg_agendamentos_auto_concluded_at
  ON public.agendamentos;

DROP FUNCTION IF EXISTS public.trg_agendamento_servicos_try_set_auto_concluded_at();
DROP FUNCTION IF EXISTS public.trg_agendamentos_try_set_auto_concluded_at();
DROP FUNCTION IF EXISTS public.fn_try_set_auto_concluded_at(uuid);

DO $$
DECLARE
  v_batch integer;
  v_total integer := 0;
BEGIN
  LOOP
    SELECT public.fn_reconcile_auto_concluded_at(5000) INTO v_batch;
    v_total := v_total + COALESCE(v_batch, 0);
    EXIT WHEN COALESCE(v_batch, 0) = 0;
  END LOOP;

  RAISE NOTICE '[concluded_at retroactive frontend hotfix] linhas reconciliadas: %', v_total;
END$$;

COMMIT;
