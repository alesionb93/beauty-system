


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."agendamento_status" AS ENUM (
    'agendado',
    'confirmado',
    'concluido',
    'cancelado',
    'nao_compareceu'
);


ALTER TYPE "public"."agendamento_status" OWNER TO "postgres";


CREATE TYPE "public"."app_role" AS ENUM (
    'admin',
    'colaborador',
    'master_admin'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."cor_tipo" AS ENUM (
    'base',
    'pigmento'
);


ALTER TYPE "public"."cor_tipo" OWNER TO "postgres";


CREATE TYPE "public"."estoque_mov_tipo" AS ENUM (
    'entrada',
    'saida',
    'ajuste'
);


ALTER TYPE "public"."estoque_mov_tipo" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_fin_parse_marker"("p_obs" "text", "p_key" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  m text;
BEGIN
  IF p_obs IS NULL OR p_obs = '' THEN
    RETURN 0;
  END IF;
  m := (regexp_matches(p_obs, p_key || ':\s*([0-9]+(?:\.[0-9]+)?)', 'i'))[1];
  IF m IS NULL THEN
    RETURN 0;
  END IF;
  RETURN m::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;


ALTER FUNCTION "public"."_fin_parse_marker"("p_obs" "text", "p_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_fin_parse_marker"("p_obs" "text", "p_key" "text") IS 'Compatibilidade transitória: extrai valor de markers CAIXINHA:/DESCONTO:/ACRESCIMO: em agendamento_pagamentos.observacao.';



CREATE OR REPLACE FUNCTION "public"."_trg_recompute_financeiro"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_agid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_agid := OLD.agendamento_id;
  ELSE
    v_agid := NEW.agendamento_id;
  END IF;

  PERFORM public.recompute_agendamento_financeiro(v_agid);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_trg_recompute_financeiro"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_venda_assert_tenant"("p_venda_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.vendas where id = p_venda_id;
  if v_tenant is null then
    raise exception 'venda % não encontrada', p_venda_id;
  end if;
  if v_tenant <> public.current_tenant_id() then
    raise exception 'venda pertence a outro tenant';
  end if;
  return v_tenant;
end;
$$;


ALTER FUNCTION "public"."_venda_assert_tenant"("p_venda_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_venda_mover_estoque"("p_venda_id" "uuid", "p_tipo" "public"."estoque_mov_tipo") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.estoque_movimentacoes (tenant_id, produto_id, tipo, quantidade, observacao)
  select i.tenant_id, i.produto_id, p_tipo, i.quantidade,
         case when p_tipo = 'saida' then 'Venda de balcão ' else 'Estorno de venda ' end || i.venda_id
    from public.venda_itens i
    join public.produtos pr on pr.id = i.produto_id
   where i.venda_id = p_venda_id
     and i.produto_id is not null
     and pr.tem_estoque = true;
end;
$$;


ALTER FUNCTION "public"."_venda_mover_estoque"("p_venda_id" "uuid", "p_tipo" "public"."estoque_mov_tipo") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_debug_auth_v6"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'auth_uid', auth.uid(),
    'jwt_role', current_setting('request.jwt.claim.role', true),
    'jwt_sub', current_setting('request.jwt.claim.sub', true),
    'usuario', (
      SELECT jsonb_build_object(
        'id', u.id,
        'tenant_id', u.tenant_id,
        'profissional_id', u.profissional_id,
        'ativo', u.ativo
      )
      FROM public.usuarios u
      WHERE u.id = auth.uid()
      LIMIT 1
    ),
    'roles', (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', ur.role::text,
            'tenant_id', ur.tenant_id
          )
        ),
        '[]'::jsonb
      )
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
    )
  );
$$;


ALTER FUNCTION "public"."agenda_debug_auth_v6"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_debug_bloqueios_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'auth_uid', auth.uid(),
    'jwt_role', auth.jwt() ->> 'role',
    'tenant_id_testado', _tenant_id,
    'profissional_id_testado', _profissional_id,
    'is_master_admin', public.agenda_is_master_admin_v7(),
    'is_admin_tenant', public.agenda_is_admin_tenant_v7(_tenant_id),
    'is_profissional_atual', public.agenda_is_profissional_atual_v7(_tenant_id, _profissional_id),
    'can_insert', (
      public.agenda_is_admin_tenant_v7(_tenant_id)
      OR public.agenda_is_profissional_atual_v7(_tenant_id, _profissional_id)
    ),
    'usuario', (
      SELECT to_jsonb(u)
      FROM public.usuarios u
      WHERE u.id = auth.uid()
      LIMIT 1
    ),
    'roles', (
      SELECT COALESCE(jsonb_agg(to_jsonb(ur)), '[]'::jsonb)
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
    )
  );
$$;


ALTER FUNCTION "public"."agenda_debug_bloqueios_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_eh_admin_tenant_v4"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (ur.tenant_id = _tenant_id OR ur.tenant_id IS NULL)
      AND (
        lower(replace(ur.role::text, '-', '_')) IN (
          'admin',
          'administrator',
          'administrador',
          'master',
          'master_admin',
          'admin_master',
          'super_admin',
          'owner',
          'dono'
        )
        OR lower(ur.role::text) LIKE '%admin%'
        OR lower(ur.role::text) LIKE '%master%'
        OR lower(ur.role::text) LIKE '%owner%'
      )
  );
$$;


ALTER FUNCTION "public"."agenda_eh_admin_tenant_v4"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_eh_admin_tenant_v5"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.tenant_id = _tenant_id
        OR ur.tenant_id IS NULL
      )
      AND (
        lower(replace(ur.role::text, '-', '_')) IN (
          'admin',
          'administrator',
          'administrador',
          'master',
          'master_admin',
          'admin_master',
          'super_admin',
          'owner',
          'dono'
        )
        OR lower(ur.role::text) LIKE '%admin%'
        OR lower(ur.role::text) LIKE '%master%'
        OR lower(ur.role::text) LIKE '%owner%'
      )
  );
$$;


ALTER FUNCTION "public"."agenda_eh_admin_tenant_v5"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_eh_admin_tenant_v6"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.tenant_id = _tenant_id
        OR ur.tenant_id IS NULL
      )
      AND (
        lower(replace(ur.role::text, '-', '_')) IN (
          'admin',
          'administrator',
          'administrador',
          'master',
          'master_admin',
          'admin_master',
          'super_admin',
          'owner',
          'dono'
        )
        OR lower(ur.role::text) LIKE '%admin%'
        OR lower(ur.role::text) LIKE '%master%'
        OR lower(ur.role::text) LIKE '%owner%'
      )
  );
$$;


ALTER FUNCTION "public"."agenda_eh_admin_tenant_v6"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_eh_profissional_atual_v5"("_tenant_id" "uuid", "_profissional_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.tenant_id = _tenant_id
      AND u.profissional_id = _profissional_id
  );
$$;


ALTER FUNCTION "public"."agenda_eh_profissional_atual_v5"("_tenant_id" "uuid", "_profissional_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_eh_profissional_atual_v6"("_tenant_id" "uuid", "_profissional_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.tenant_id = _tenant_id
      AND u.profissional_id = _profissional_id
  );
$$;


ALTER FUNCTION "public"."agenda_eh_profissional_atual_v6"("_tenant_id" "uuid", "_profissional_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_is_admin_tenant_v7"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT auth.uid() IS NOT NULL
  AND (
    public.agenda_is_master_admin_v7()
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = _tenant_id
        AND ur.role::text = 'admin'
    )
  );
$$;


ALTER FUNCTION "public"."agenda_is_admin_tenant_v7"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_is_master_admin_v7"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text = 'master_admin'
  );
$$;


ALTER FUNCTION "public"."agenda_is_master_admin_v7"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_is_profissional_atual_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.tenant_id = _tenant_id
      AND u.profissional_id = _profissional_id
      AND COALESCE(u.ativo, true) = true
  );
$$;


ALTER FUNCTION "public"."agenda_is_profissional_atual_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_usuario_atual_v4"() RETURNS TABLE("user_id" "uuid", "tenant_id" "uuid", "profissional_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    u.id AS user_id,
    u.tenant_id,
    u.profissional_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."agenda_usuario_atual_v4"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_usuario_atual_v5"() RETURNS TABLE("user_id" "uuid", "tenant_id" "uuid", "profissional_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    u.id,
    u.tenant_id,
    u.profissional_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."agenda_usuario_atual_v5"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agenda_usuario_atual_v6"() RETURNS TABLE("user_id" "uuid", "tenant_id" "uuid", "profissional_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    u.id AS user_id,
    u.tenant_id,
    u.profissional_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."agenda_usuario_atual_v6"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agendamento_esta_concluido"("_ag_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agendamentos
    WHERE id = _ag_id
      AND status IS NOT NULL
      AND lower(status::text) IN ('concluido','concluído','finalizado')
  );
$$;


ALTER FUNCTION "public"."agendamento_esta_concluido"("_ag_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_insert_user_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Só insere se o usuário NÃO tem nenhuma role ainda
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id
  ) THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (NEW.id, 'admin', NEW.tenant_id);
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_insert_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_tenant"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    -- Usuário pertence diretamente ao tenant em public.usuarios
    exists (
      select 1
      from public.usuarios u
      where u.id = auth.uid()
        and u.tenant_id = _tenant_id
    )
    or
    -- Usuário tem vínculo com o tenant em public.user_roles
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.tenant_id = _tenant_id
        and ur.role::text in ('admin', 'colaborador')
    )
    or
    -- Master admin pode operar no tenant selecionado pelo sistema
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role::text = 'master_admin'
    );
$$;


ALTER FUNCTION "public"."can_access_tenant"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_tenant_from_path"("_tenant_text" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  _tenant_id uuid;
begin
  if _tenant_text is null or btrim(_tenant_text) = '' then
    return false;
  end if;

  begin
    _tenant_id := _tenant_text::uuid;
  exception when others then
    return false;
  end;

  return public.can_access_tenant(_tenant_id);
end;
$$;


ALTER FUNCTION "public"."can_access_tenant_from_path"("_tenant_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_service_recommendations"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and (
        ur.role = 'master_admin'
        or (ur.tenant_id = _tenant_id and ur.role = 'admin')
      )
  )
  or exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.tenant_id = _tenant_id
  )
$$;


ALTER FUNCTION "public"."can_manage_service_recommendations"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_tenant_settings"("p_tenant" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'master_admin'              -- master vê tudo
        OR (ur.tenant_id = p_tenant AND ur.role IN ('admin','master_admin'))
      )
  );
$$;


ALTER FUNCTION "public"."can_manage_tenant_settings"("p_tenant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_profissional"("_tenant_id" "uuid", "_profissional_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    public.is_admin_for_tenant(_tenant_id)
    OR public.current_user_profissional_id() = _profissional_id
$$;


ALTER FUNCTION "public"."can_read_profissional"("_tenant_id" "uuid", "_profissional_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_tenant_settings"("p_tenant" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'master_admin'
        OR ur.tenant_id = p_tenant
      )
  );
$$;


ALTER FUNCTION "public"."can_read_tenant_settings"("p_tenant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_agendamento_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row       public.agendamentos%ROWTYPE;
  v_agora_br  timestamp;
BEGIN
  v_agora_br := (now() AT TIME ZONE 'America/Sao_Paulo')::timestamp;

  SELECT * INTO v_row
  FROM public.agendamentos
  WHERE id = _agendamento_id
    AND tenant_id  = _tenant_id
    AND cliente_id = _cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado ou não pertence ao cliente informado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status::text IN ('cancelado', 'excluido', 'excluído', 'desmarcado') THEN
    RETURN true; -- idempotente
  END IF;

  IF v_row.status::text IN ('concluido', 'concluído') THEN
    RAISE EXCEPTION 'Não é possível cancelar um agendamento já concluído.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Só permite cancelar futuros (comparação no fuso Brasil)
  IF ((v_row.data + v_row.hora)::timestamp) < v_agora_br THEN
    RAISE EXCEPTION 'Não é possível cancelar um agendamento que já ocorreu.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.agendamentos
     SET status     = 'cancelado',
         updated_at = now()
   WHERE id = _agendamento_id;

  -- Log opcional (só se a tabela existir)
  BEGIN
    INSERT INTO public.cancelamento_log (
      tenant_id, agendamento_id,
      cancelado_por_nome, cancelado_por_role,
      motivo_slug, motivo_nome,
      status_anterior
    ) VALUES (
      _tenant_id, _agendamento_id,
      'Cliente (site público)', 'cliente_publico',
      'cliente_site', 'Cancelado pelo cliente no site',
      v_row.status::text
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."cancel_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_agendamento_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cancel_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_agendamento_id" "uuid") IS 'Fluxo público: cancela um agendamento futuro do próprio cliente identificado no site externo.';



CREATE OR REPLACE FUNCTION "public"."cancelar_venda"("p_venda_id" "uuid", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_status text;
begin
  perform public._venda_assert_tenant(p_venda_id);
  select status into v_status from public.vendas where id = p_venda_id;
  if v_status = 'cancelada' then
    raise exception 'venda já cancelada';
  end if;

  perform public._venda_mover_estoque(p_venda_id, 'entrada'::estoque_mov_tipo);

  update public.vendas
     set status = 'cancelada',
         cancelada_em = now(),
         cancelada_por = auth.uid(),
         motivo_cancelamento = p_motivo
   where id = p_venda_id;
end;
$$;


ALTER FUNCTION "public"."cancelar_venda"("p_venda_id" "uuid", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_tenant_active_users_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_max     integer;
  v_ativos  integer;
BEGIN
  -- Só valida quando o registro passa a contar como ATIVO
  IF TG_OP = 'INSERT' AND COALESCE(NEW.ativo, true) IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NOT (COALESCE(NEW.ativo, true) IS TRUE AND COALESCE(OLD.ativo, true) IS NOT TRUE) THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.max_active_users INTO v_max
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id;

  -- Fallback SOMENTE se a coluna/registro realmente não existir
  IF v_max IS NULL OR v_max <= 0 THEN
    v_max := 3;
  END IF;

  SELECT count(*) INTO v_ativos
  FROM public.usuarios u
  WHERE u.tenant_id = NEW.tenant_id
    AND u.ativo IS TRUE
    AND u.id <> NEW.id
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = u.id AND r.role = 'master_admin'
    );

  IF v_ativos >= v_max THEN
    RAISE EXCEPTION
      'Limite de usuários ativos atingido (%). Inative um usuário antes de ativar outro.', v_max
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_tenant_active_users_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."comissoes_v2_kpis"("p_tenant_id" "uuid", "p_profissional_id" "uuid", "p_inicio" "date", "p_fim" "date") RETURNS TABLE("comissao" numeric, "caixinha" numeric, "total_receber" numeric, "atendimentos" integer, "produtos_vendidos" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH ev AS (
    SELECT *
      FROM public.comissoes_v2_eventos e
     WHERE e.tenant_id = p_tenant_id
       AND e.profissional_id = p_profissional_id
       AND e.event_date BETWEEN p_inicio AND p_fim
  ),
  cx AS (
    SELECT COALESCE(SUM(a.caixinha_total), 0)::numeric AS total
      FROM public.agendamentos a
     WHERE a.tenant_id = p_tenant_id
       AND a.profissional_id = p_profissional_id
       AND a.data BETWEEN p_inicio AND p_fim
       AND (a.status = 'concluido'::public.agendamento_status
            OR a.conclusion_type = 'cancelado_com_venda')
  )
  SELECT ROUND(COALESCE((SELECT SUM(ev.comissao) FROM ev), 0), 2)                    AS comissao,
         ROUND((SELECT total FROM cx), 2)                                            AS caixinha,
         ROUND(COALESCE((SELECT SUM(ev.comissao) FROM ev), 0)
               + (SELECT total FROM cx), 2)                                          AS total_receber,
         COALESCE((SELECT COUNT(DISTINCT ev.agendamento_id)
                     FROM ev WHERE ev.conta_atendimento), 0)::integer                AS atendimentos,
         ROUND(COALESCE((SELECT SUM(ev.valor) FROM ev
                          WHERE ev.event_type = 'produto'), 0), 2)                   AS produtos_vendidos;
$$;


ALTER FUNCTION "public"."comissoes_v2_kpis"("p_tenant_id" "uuid", "p_profissional_id" "uuid", "p_inicio" "date", "p_fim" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."comissoes_v2_snapshot"("p_inicio" "date", "p_fim" "date", "p_profissional_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_prof_id    uuid;
  v_tenant_id  uuid;
  v_is_admin   boolean := false;
  v_nome       text;
  v_dias       integer;
  v_prev_ini   date;
  v_prev_fim   date;
  k            record;
  a            record;
  v_agenda     jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'unauthenticated');
  END IF;

  SELECT u.profissional_id, u.tenant_id
    INTO v_prof_id, v_tenant_id
    FROM public.usuarios u
   WHERE u.id = v_uid
     AND COALESCE(u.ativo, true) = true
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_vinculo');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = v_uid
       AND ur.tenant_id = v_tenant_id
       AND ur.role::text = 'admin'
  ) INTO v_is_admin;

  -- Admin pode inspecionar outro profissional; colaborador vê só o próprio.
  IF p_profissional_id IS NOT NULL AND v_is_admin THEN
    v_prof_id := p_profissional_id;
  END IF;

  IF v_prof_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_profissional');
  END IF;

  SELECT pf.nome INTO v_nome
    FROM public.profissionais pf
   WHERE pf.id = v_prof_id
   LIMIT 1;

  -- Período anterior equivalente
  v_dias     := (p_fim - p_inicio) + 1;
  v_prev_fim := p_inicio - 1;
  v_prev_ini := v_prev_fim - (v_dias - 1);

  SELECT * INTO k FROM public.comissoes_v2_kpis(v_tenant_id, v_prof_id, p_inicio, p_fim);
  SELECT * INTO a FROM public.comissoes_v2_kpis(v_tenant_id, v_prof_id, v_prev_ini, v_prev_fim);

  -- Histórico: UMA LINHA POR EVENTO.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.event_date, x.event_time NULLS FIRST, x.ord_evento, x.created_at), '[]'::jsonb)
    INTO v_agenda
    FROM (
      SELECT e.event_type,
             e.event_id,
             e.event_date,
             e.event_time,
             e.ord_evento,
             e.created_at,
             e.agendamento_id,
             to_char(e.event_date, 'DD/MM')                       AS data_label,
             COALESCE(to_char(e.event_time, 'HH24:MI'), '')       AS hora,
             e.titulo                                             AS servico_nome,
             e.cliente_nome,
             ROUND(e.valor, 2)                                    AS valor,
             ROUND(e.comissao, 2)                                 AS comissao,
             ROUND(COALESCE(cx.caixinha, 0), 2)                   AS caixinha,
             e.conta_atendimento
        FROM public.comissoes_v2_eventos e
        -- Caixinha é 100% do profissional e pertence ao agendamento:
        -- exibida apenas no primeiro evento remunerado daquele agendamento.
        LEFT JOIN LATERAL (
          SELECT ag.caixinha_total AS caixinha
            FROM public.agendamentos ag
           WHERE ag.id = e.agendamento_id
             AND ag.profissional_id = v_prof_id
             AND COALESCE(ag.caixinha_total, 0) > 0
             AND e.event_id = (
                   SELECT e2.event_id
                     FROM public.comissoes_v2_eventos e2
                    WHERE e2.agendamento_id = e.agendamento_id
                      AND e2.profissional_id = v_prof_id
                      AND e2.comissao > 0
                    ORDER BY e2.ord_evento, e2.created_at
                    LIMIT 1)
        ) cx ON true
       WHERE e.tenant_id = v_tenant_id
         AND e.profissional_id = v_prof_id
         AND e.event_date BETWEEN p_inicio AND p_fim
    ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'profissional', jsonb_build_object('id', v_prof_id, 'nome', COALESCE(v_nome, '')),
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'kpis', jsonb_build_object(
      'totalReceber',     COALESCE(k.total_receber, 0),
      'comissao',         COALESCE(k.comissao, 0),
      'caixinha',         COALESCE(k.caixinha, 0),
      'atendimentos',     COALESCE(k.atendimentos, 0),
      'produtosVendidos', COALESCE(k.produtos_vendidos, 0)
    ),
    'anterior', jsonb_build_object(
      'totalReceber',     COALESCE(a.total_receber, 0),
      'comissao',         COALESCE(a.comissao, 0),
      'caixinha',         COALESCE(a.caixinha, 0),
      'atendimentos',     COALESCE(a.atendimentos, 0),
      'produtosVendidos', COALESCE(a.produtos_vendidos, 0)
    ),
    'agenda', v_agenda
  );
END;
$$;


ALTER FUNCTION "public"."comissoes_v2_snapshot"("p_inicio" "date", "p_fim" "date", "p_profissional_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."comissoes_v2_snapshot"("p_inicio" "date", "p_fim" "date", "p_profissional_id" "uuid") IS 'Snapshot do módulo Comissões V2. agenda[] retorna EVENTOS de comissão (1 evento = 1 linha), não agendamentos.';



CREATE OR REPLACE FUNCTION "public"."create_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_profissional_id" "uuid", "_data" "date", "_hora" "text", "_servico_id" "uuid", "_duracao" integer, "_preco" numeric, "_pacote_acao" "text" DEFAULT NULL::"text", "_cliente_pacote_id" "uuid" DEFAULT NULL::"uuid", "_pacote_def_id" "uuid" DEFAULT NULL::"uuid", "_servicos_extras" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _ag_id uuid;
  _cp_id uuid;
  _p record;
  _expira date;
  _ex jsonb;
  _hora_t time := _hora::time;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = _cliente_id AND tenant_id = _tenant_id) THEN
    RAISE EXCEPTION 'cliente inválido';
  END IF;

  INSERT INTO agendamentos (
    tenant_id, cliente_id, cliente_nome, cliente_telefone,
    profissional_id, data, hora, status, origem
  ) VALUES (
    _tenant_id, _cliente_id, _cliente_nome, _cliente_telefone,
    _profissional_id, _data, _hora_t, 'agendado', 'externo'
  )
  RETURNING id INTO _ag_id;

  IF _pacote_acao = 'usar' AND _cliente_pacote_id IS NOT NULL THEN
    INSERT INTO agendamento_servicos
      (tenant_id, agendamento_id, servico_id, profissional_id, preco, duracao,
       cliente_pacote_id, origem, credito_consumido)
    VALUES
      (_tenant_id, _ag_id, _servico_id, _profissional_id, 0, _duracao,
       _cliente_pacote_id, 'pacote_uso', false);

  ELSIF _pacote_acao = 'vender' AND _pacote_def_id IS NOT NULL THEN
    SELECT * INTO _p FROM pacotes
     WHERE id = _pacote_def_id AND tenant_id = _tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'pacote ofertado não encontrado'; END IF;

    _expira := _data + COALESCE(_p.validade_dias, 30);

    INSERT INTO cliente_pacotes (
      tenant_id, cliente_id, pacote_id,
      quantidade_total, quantidade_restante,
      preco_unitario, preco_total,
      data_inicio, data_expiracao, status
    ) VALUES (
      _tenant_id, _cliente_id, _p.id,
      _p.quantidade_total, _p.quantidade_total,
      _p.preco_unitario_final, _p.preco_total,
      _data, _expira, 'ativo'
    )
    RETURNING id INTO _cp_id;

    INSERT INTO agendamento_servicos
      (tenant_id, agendamento_id, servico_id, profissional_id, preco, duracao,
       cliente_pacote_id, origem, credito_consumido)
    VALUES
      (_tenant_id, _ag_id, _servico_id, _profissional_id,
       COALESCE(_p.preco_total,0), 1,
       _cp_id, 'pacote_venda', false);

    INSERT INTO agendamento_servicos
      (tenant_id, agendamento_id, servico_id, profissional_id, preco, duracao,
       cliente_pacote_id, origem, credito_consumido)
    VALUES
      (_tenant_id, _ag_id, _servico_id, _profissional_id, 0, _duracao,
       _cp_id, 'pacote_uso', false);

  ELSE
    INSERT INTO agendamento_servicos
      (tenant_id, agendamento_id, servico_id, profissional_id, preco, duracao,
       cliente_pacote_id, origem, credito_consumido)
    VALUES
      (_tenant_id, _ag_id, _servico_id, _profissional_id,
       COALESCE(_preco,0), _duracao,
       NULL, 'avulso', false);
  END IF;

  FOR _ex IN SELECT * FROM jsonb_array_elements(COALESCE(_servicos_extras,'[]'::jsonb))
  LOOP
    INSERT INTO agendamento_servicos
      (tenant_id, agendamento_id, servico_id, profissional_id, preco, duracao,
       cliente_pacote_id, origem, credito_consumido)
    VALUES
      (_tenant_id, _ag_id,
       (_ex->>'id')::uuid, _profissional_id,
       COALESCE((_ex->>'preco')::numeric, 0),
       COALESCE((_ex->>'duracao')::int, 30),
       NULL, 'avulso', false);
  END LOOP;

  RETURN _ag_id;
END;
$$;


ALTER FUNCTION "public"."create_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_profissional_id" "uuid", "_data" "date", "_hora" "text", "_servico_id" "uuid", "_duracao" integer, "_preco" numeric, "_pacote_acao" "text", "_cliente_pacote_id" "uuid", "_pacote_def_id" "uuid", "_servicos_extras" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_public_booking"("_tenant_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_servico_id" "uuid", "_profissional_id" "uuid", "_data" "date", "_hora" time without time zone, "_duracao" integer, "_preco" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cliente_id    uuid;
  v_nome_existente text;
  v_agendamento_id uuid;
  v_nome_norm_in   text;
  v_nome_norm_db   text;
BEGIN
  -- Validação básica de input
  IF _tenant_id IS NULL OR _cliente_nome IS NULL OR _cliente_telefone IS NULL
     OR _servico_id IS NULL OR _profissional_id IS NULL
     OR _data IS NULL OR _hora IS NULL THEN
    RAISE EXCEPTION 'Parâmetros obrigatórios ausentes';
  END IF;

  IF length(btrim(_cliente_nome)) < 2 THEN
    RAISE EXCEPTION 'Informe seu nome completo.';
  END IF;

  -- 1) Procurar cliente pelo telefone dentro do tenant
  SELECT id, nome
    INTO v_cliente_id, v_nome_existente
  FROM public.clientes
  WHERE tenant_id = _tenant_id
    AND telefone  = _cliente_telefone
  LIMIT 1;

  IF v_cliente_id IS NOT NULL THEN
    -- Normaliza nomes para comparação tolerante (acentos, caixa, espaços)
    v_nome_norm_in := lower(btrim(regexp_replace(unaccent(_cliente_nome),    '\s+', ' ', 'g')));
    v_nome_norm_db := lower(btrim(regexp_replace(unaccent(v_nome_existente), '\s+', ' ', 'g')));

    IF v_nome_norm_in <> v_nome_norm_db THEN
      -- Bloqueia o fluxo com erro estruturado para o front interpretar
      RAISE EXCEPTION 'CLIENTE_NOME_DIVERGENTE:%', v_nome_existente;
    END IF;
    -- Nome bate: NÃO atualiza nada do cliente existente.
  ELSE
    -- 2) Não existe: cria novo cliente
    INSERT INTO public.clientes (tenant_id, nome, telefone)
    VALUES (_tenant_id, _cliente_nome, _cliente_telefone)
    RETURNING id INTO v_cliente_id;
  END IF;

  -- 3) Cria agendamento
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, cliente_nome, cliente_telefone,
    profissional_id, data, hora, status
  )
  VALUES (
    _tenant_id, v_cliente_id, _cliente_nome, _cliente_telefone,
    _profissional_id, _data, _hora, 'agendado'
  )
  RETURNING id INTO v_agendamento_id;

  -- 4) Cria item de serviço do agendamento
  INSERT INTO public.agendamento_servicos (
    tenant_id, agendamento_id, servico_id, profissional_id, preco, duracao
  )
  VALUES (
    _tenant_id, v_agendamento_id, _servico_id, _profissional_id,
    COALESCE(_preco, 0), COALESCE(_duracao, 30)
  );

  RETURN v_agendamento_id;
END;
$$;


ALTER FUNCTION "public"."create_public_booking"("_tenant_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_servico_id" "uuid", "_profissional_id" "uuid", "_data" "date", "_hora" time without time zone, "_duracao" integer, "_preco" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_public_cliente"("_tenant_id" "uuid", "_nome" "text", "_telefone" "text", "_nascimento" "date" DEFAULT NULL::"date") RETURNS TABLE("id" "uuid", "nome" "text", "telefone" "text", "nascimento" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cliente_id uuid;
BEGIN
  SELECT c.id INTO v_cliente_id
  FROM public.clientes c
  WHERE c.tenant_id = _tenant_id
    AND regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = regexp_replace(coalesce(_telefone, ''), '\D', '', 'g')
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (tenant_id, nome, telefone, nascimento)
    VALUES (_tenant_id, trim(_nome), _telefone, _nascimento)
    RETURNING clientes.id INTO v_cliente_id;
  END IF;

  RETURN QUERY
  SELECT c.id, c.nome, c.telefone, c.nascimento
  FROM public.clientes c
  WHERE c.id = v_cliente_id;
END;
$$;


ALTER FUNCTION "public"."create_public_cliente"("_tenant_id" "uuid", "_nome" "text", "_telefone" "text", "_nascimento" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select tenant_id from public.usuarios where id = auth.uid() limit 1
$$;


ALTER FUNCTION "public"."current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_info"() RETURNS TABLE("user_id" "uuid", "tenant_id" "uuid", "profissional_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT u.id, u.tenant_id, u.profissional_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."current_user_info"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_profissional"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT u.profissional_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
    AND u.ativo IS TRUE
    AND u.profissional_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'colaborador'
        AND (r.tenant_id IS NULL OR r.tenant_id = u.tenant_id)
    )
  LIMIT 1;
$$;


ALTER FUNCTION "public"."current_user_profissional"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_profissional_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT profissional_id
  FROM public.usuarios
  WHERE id = auth.uid()
  LIMIT 1
$$;


ALTER FUNCTION "public"."current_user_profissional_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select u.tenant_id
  from public.usuarios u
  where u.id = auth.uid()
  limit 1
$$;


ALTER FUNCTION "public"."current_user_tenant_id"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agendamento_pagamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "agendamento_id" "uuid" NOT NULL,
    "forma_pagamento" "text" NOT NULL,
    "valor" numeric NOT NULL,
    "parcelas" integer DEFAULT 1 NOT NULL,
    "observacao" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "caixinha_valor" numeric(10,2) DEFAULT 0 NOT NULL,
    "desconto_valor" numeric(10,2) DEFAULT 0 NOT NULL,
    "acrescimo_valor" numeric(10,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "agendamento_pagamentos_forma_pagamento_check" CHECK (("forma_pagamento" = ANY (ARRAY['pix'::"text", 'dinheiro'::"text", 'debito'::"text", 'credito'::"text", 'credito_parcelado'::"text"]))),
    CONSTRAINT "agendamento_pagamentos_parcelas_check" CHECK ((("parcelas" >= 1) AND ("parcelas" <= 24))),
    CONSTRAINT "agendamento_pagamentos_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."agendamento_pagamentos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."agendamento_pagamentos"."caixinha_valor" IS 'Caixinha registrada nesta linha de pagamento. Substitui o marker "CAIXINHA:X.XX" na coluna observacao.';



COMMENT ON COLUMN "public"."agendamento_pagamentos"."desconto_valor" IS 'Desconto registrado nesta linha de pagamento. Substitui o marker "DESCONTO:X.XX" na coluna observacao.';



COMMENT ON COLUMN "public"."agendamento_pagamentos"."acrescimo_valor" IS 'Acréscimo registrado nesta linha de pagamento (uso futuro: taxa de serviço, etc.).';



CREATE TABLE IF NOT EXISTS "public"."agendamento_produtos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "agendamento_id" "uuid" NOT NULL,
    "produto_id" "uuid" NOT NULL,
    "quantidade" numeric NOT NULL,
    "preco_unitario" numeric NOT NULL,
    "observacao" "text",
    "estoque_movimentacao_id" "uuid",
    "cliente_levou" boolean,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "agendamento_produtos_preco_unitario_check" CHECK (("preco_unitario" >= (0)::numeric)),
    CONSTRAINT "agendamento_produtos_quantidade_check" CHECK (("quantidade" > (0)::numeric))
);


ALTER TABLE "public"."agendamento_produtos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agendamento_servicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agendamento_id" "uuid" NOT NULL,
    "servico_id" "uuid" NOT NULL,
    "preco" numeric(10,2) NOT NULL,
    "duracao" integer,
    "cor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    "profissional_id" "uuid" NOT NULL,
    "cliente_pacote_id" "uuid",
    "origem" "text" DEFAULT 'avulso'::"text" NOT NULL,
    "credito_consumido" boolean DEFAULT false NOT NULL,
    CONSTRAINT "agendamento_servicos_duracao_check" CHECK (("duracao" > 0)),
    CONSTRAINT "agendamento_servicos_origem_check" CHECK (("origem" = ANY (ARRAY['avulso'::"text", 'pacote_uso'::"text", 'pacote_venda'::"text"]))),
    CONSTRAINT "agendamento_servicos_origem_chk" CHECK (("origem" = ANY (ARRAY['avulso'::"text", 'pacote_uso'::"text", 'pacote_venda'::"text"]))),
    CONSTRAINT "agendamento_servicos_preco_check" CHECK (("preco" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."agendamento_servicos" REPLICA IDENTITY FULL;


ALTER TABLE "public"."agendamento_servicos" OWNER TO "postgres";


COMMENT ON TABLE "public"."agendamento_servicos" IS 'Serviços vinculados a cada agendamento (relacional)';



CREATE TABLE IF NOT EXISTS "public"."agendamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid",
    "cliente_nome" "text" NOT NULL,
    "cliente_telefone" "text",
    "profissional_id" "uuid",
    "data" "date" NOT NULL,
    "hora" time without time zone NOT NULL,
    "status" "public"."agendamento_status" DEFAULT 'agendado'::"public"."agendamento_status" NOT NULL,
    "observacoes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    "concluded_at" timestamp with time zone,
    "conclusion_type" "text",
    "origem" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status_pagamento" "text" DEFAULT 'pendente'::"text",
    "valor_total_pago" numeric DEFAULT 0,
    "possui_pagamento" boolean DEFAULT false,
    "reminder_24h_sent_at" timestamp with time zone,
    "reminder_2h_sent_at" timestamp with time zone,
    "prepaid" boolean DEFAULT false NOT NULL,
    "prepaid_origin_agendamento_id" "uuid",
    "prepaid_origin_payment_id" "uuid",
    "subtotal_servicos" numeric(10,2) DEFAULT 0 NOT NULL,
    "subtotal_produtos" numeric(10,2) DEFAULT 0 NOT NULL,
    "desconto_total" numeric(10,2) DEFAULT 0 NOT NULL,
    "acrescimo_total" numeric(10,2) DEFAULT 0 NOT NULL,
    "caixinha_total" numeric(10,2) DEFAULT 0 NOT NULL,
    "base_comissao" numeric(10,2) DEFAULT 0 NOT NULL,
    "total" numeric(10,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "agendamentos_conclusion_type_check" CHECK ((("conclusion_type" IS NULL) OR ("conclusion_type" = ANY (ARRAY['manual'::"text", 'automatic'::"text", 'cancelado_com_venda'::"text"])))),
    CONSTRAINT "agendamentos_origem_check" CHECK (("origem" = ANY (ARRAY['manual'::"text", 'externo'::"text"]))),
    CONSTRAINT "agendamentos_origem_chk" CHECK (("origem" = ANY (ARRAY['manual'::"text", 'externo'::"text", 'BALCAO'::"text"]))),
    CONSTRAINT "agendamentos_status_pagamento_check" CHECK (("status_pagamento" = ANY (ARRAY['pendente'::"text", 'parcial'::"text", 'pago'::"text"])))
);

ALTER TABLE ONLY "public"."agendamentos" REPLICA IDENTITY FULL;


ALTER TABLE "public"."agendamentos" OWNER TO "postgres";


COMMENT ON TABLE "public"."agendamentos" IS 'Agendamentos com referências relacionais';



COMMENT ON COLUMN "public"."agendamentos"."concluded_at" IS 'Timestamp em que o agendamento foi marcado como concluído (manual ou automático).';



COMMENT ON COLUMN "public"."agendamentos"."conclusion_type" IS 'manual = concluído pelo usuário no modal de edição; automatic = auto-concluído pelo sistema.';



COMMENT ON COLUMN "public"."agendamentos"."reminder_24h_sent_at" IS 'Timestamp em que o lembrete de 24h foi processado (sucesso, erro ou ignorado). NULL = ainda não processado.';



COMMENT ON COLUMN "public"."agendamentos"."reminder_2h_sent_at" IS 'Timestamp do envio do reminder 2h (anti-duplicidade). NULL = ainda não enviado/avaliado.';



COMMENT ON COLUMN "public"."agendamentos"."subtotal_servicos" IS 'Soma dos serviços do agendamento. Nunca inclui desconto, caixinha ou acréscimo. Fonte: agendamento_servicos.';



COMMENT ON COLUMN "public"."agendamentos"."subtotal_produtos" IS 'Soma dos produtos vendidos no agendamento (preco_unitario * quantidade). Fonte: agendamento_produtos.';



COMMENT ON COLUMN "public"."agendamentos"."desconto_total" IS 'Desconto aplicado no agendamento. Reduz total e base_comissao. Fonte: colunas de agendamento_pagamentos ou marker DESCONTO: legado.';



COMMENT ON COLUMN "public"."agendamentos"."acrescimo_total" IS 'Acréscimos financeiros (ex.: taxa de serviço). Aumenta total e base_comissao.';



COMMENT ON COLUMN "public"."agendamentos"."caixinha_total" IS 'Caixinha/gorjeta. 100% do profissional. NUNCA entra na base de comissão.';



COMMENT ON COLUMN "public"."agendamentos"."base_comissao" IS 'Base para cálculo de comissão: (subtotal_servicos + subtotal_produtos_comissionaveis) - desconto_total + acrescimo_total.';



COMMENT ON COLUMN "public"."agendamentos"."total" IS 'Valor efetivamente pago pelo cliente: subtotal_servicos + subtotal_produtos - desconto_total + acrescimo_total + caixinha_total.';



CREATE TABLE IF NOT EXISTS "public"."cliente_pacotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "pacote_id" "uuid" NOT NULL,
    "quantidade_total" integer NOT NULL,
    "quantidade_restante" integer NOT NULL,
    "preco_unitario" numeric NOT NULL,
    "preco_total" numeric NOT NULL,
    "data_inicio" "date" NOT NULL,
    "data_expiracao" "date" NOT NULL,
    "status" "text" DEFAULT 'ativo'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "cliente_pacotes_check" CHECK (("quantidade_restante" <= "quantidade_total")),
    CONSTRAINT "cliente_pacotes_check1" CHECK (("data_expiracao" >= "data_inicio")),
    CONSTRAINT "cliente_pacotes_preco_total_check" CHECK (("preco_total" >= (0)::numeric)),
    CONSTRAINT "cliente_pacotes_preco_unitario_check" CHECK (("preco_unitario" >= (0)::numeric)),
    CONSTRAINT "cliente_pacotes_quantidade_restante_check" CHECK (("quantidade_restante" >= 0)),
    CONSTRAINT "cliente_pacotes_quantidade_total_check" CHECK (("quantidade_total" > 0)),
    CONSTRAINT "cliente_pacotes_status_check" CHECK (("status" = ANY (ARRAY['ativo'::"text", 'expirado'::"text", 'concluido'::"text", 'cancelado'::"text"])))
);

ALTER TABLE ONLY "public"."cliente_pacotes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."cliente_pacotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "telefone" "text" NOT NULL,
    "nascimento" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


COMMENT ON TABLE "public"."clientes" IS 'Cadastro de clientes do estabelecimento';



CREATE TABLE IF NOT EXISTS "public"."comissoes_profissionais" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "percentual_estabelecimento" numeric(5,2) DEFAULT 50 NOT NULL,
    "percentual_profissional" numeric(5,2) DEFAULT 50 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comissoes_profissionais_percentual_estabelecimento_check" CHECK ((("percentual_estabelecimento" >= (0)::numeric) AND ("percentual_estabelecimento" <= (100)::numeric))),
    CONSTRAINT "comissoes_profissionais_percentual_profissional_check" CHECK ((("percentual_profissional" >= (0)::numeric) AND ("percentual_profissional" <= (100)::numeric))),
    CONSTRAINT "comissoes_profissionais_soma_100" CHECK ((("percentual_estabelecimento" + "percentual_profissional") = (100)::numeric))
);


ALTER TABLE "public"."comissoes_profissionais" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pacotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "servico_id" "uuid" NOT NULL,
    "quantidade_total" integer NOT NULL,
    "preco_original_unitario" numeric NOT NULL,
    "tipo_desconto" "text" NOT NULL,
    "valor_desconto" numeric DEFAULT 0 NOT NULL,
    "preco_unitario_final" numeric NOT NULL,
    "preco_total" numeric NOT NULL,
    "validade_dias" integer DEFAULT 30 NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "disponivel_agendamento_externo" boolean DEFAULT true NOT NULL,
    CONSTRAINT "pacotes_preco_original_unitario_check" CHECK (("preco_original_unitario" >= (0)::numeric)),
    CONSTRAINT "pacotes_preco_total_check" CHECK (("preco_total" >= (0)::numeric)),
    CONSTRAINT "pacotes_preco_unitario_final_check" CHECK (("preco_unitario_final" >= (0)::numeric)),
    CONSTRAINT "pacotes_quantidade_total_check" CHECK (("quantidade_total" > 0)),
    CONSTRAINT "pacotes_tipo_desconto_check" CHECK (("tipo_desconto" = ANY (ARRAY['percentual'::"text", 'valor'::"text"]))),
    CONSTRAINT "pacotes_validade_dias_check" CHECK (("validade_dias" > 0)),
    CONSTRAINT "pacotes_valor_desconto_check" CHECK (("valor_desconto" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."pacotes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pacotes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pacotes"."disponivel_agendamento_externo" IS 'Quando false, este pacote NÃO aparece no fluxo público (/agendar/{tenantId}). Continua disponível no agendamento interno (admin/profissionais).';



CREATE TABLE IF NOT EXISTS "public"."produtos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "descricao" "text",
    "tem_estoque" boolean DEFAULT false NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "foto_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "order_index" integer,
    "preco" numeric(10,2) DEFAULT 0,
    "custo" numeric,
    CONSTRAINT "produtos_custo_check" CHECK ((("custo" IS NULL) OR ("custo" >= (0)::numeric))),
    CONSTRAINT "produtos_valor_check" CHECK (("valor" >= (0)::numeric))
);


ALTER TABLE "public"."produtos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."produtos"."custo" IS 'Preço de custo do produto (opcional). Usado para futuras métricas de lucro/margem/CMV.';



CREATE TABLE IF NOT EXISTS "public"."profissionais" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "foto_url" "text" DEFAULT ''::"text",
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    "telefone" "text"
);


ALTER TABLE "public"."profissionais" OWNER TO "postgres";


COMMENT ON TABLE "public"."profissionais" IS 'Profissionais que prestam serviços';



COMMENT ON COLUMN "public"."profissionais"."telefone" IS 'Telefone WhatsApp do profissional (DDI+DDD+numero, somente dígitos). Usado pela Evolution API.';



CREATE TABLE IF NOT EXISTS "public"."servicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "preco" numeric(10,2) DEFAULT 0 NOT NULL,
    "duracao" integer DEFAULT 30 NOT NULL,
    "usa_cores" boolean DEFAULT false NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    "preco_variavel" boolean DEFAULT false NOT NULL,
    "valores_sugeridos" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "order_index" integer,
    CONSTRAINT "servicos_duracao_check" CHECK (("duracao" > 0)),
    CONSTRAINT "servicos_preco_check" CHECK (("preco" >= (0)::numeric)),
    CONSTRAINT "servicos_valores_sugeridos_array_chk" CHECK (("jsonb_typeof"("valores_sugeridos") = 'array'::"text"))
);


ALTER TABLE "public"."servicos" OWNER TO "postgres";


COMMENT ON TABLE "public"."servicos" IS 'Catálogo de serviços com preço e duração';



CREATE OR REPLACE VIEW "public"."dashboard_v2_eventos" AS
 WITH "servicos_base" AS (
         SELECT "ags"."id" AS "event_id",
            "ags"."tenant_id",
            "a"."data" AS "event_date",
            "a"."hora" AS "event_time",
            "a"."id" AS "agendamento_id",
            "a"."cliente_id",
            "a"."cliente_nome",
            "ags"."profissional_id",
            "p"."nome" AS "profissional_nome",
            "ags"."servico_id",
            "s"."nome" AS "servico_nome",
            "ags"."preco" AS "valor_bruto",
            "ags"."origem" AS "servico_origem",
            "a"."status" AS "agendamento_status",
            "a"."conclusion_type",
            COALESCE("cp"."percentual_profissional", (0)::numeric) AS "pct_comissao"
           FROM (((("public"."agendamento_servicos" "ags"
             JOIN "public"."agendamentos" "a" ON (("a"."id" = "ags"."agendamento_id")))
             LEFT JOIN "public"."servicos" "s" ON (("s"."id" = "ags"."servico_id")))
             LEFT JOIN "public"."profissionais" "p" ON (("p"."id" = "ags"."profissional_id")))
             LEFT JOIN "public"."comissoes_profissionais" "cp" ON ((("cp"."profissional_id" = "ags"."profissional_id") AND ("cp"."tenant_id" = "ags"."tenant_id"))))
        ), "ev_servico_venda" AS (
         SELECT 'servico_venda'::"text" AS "event_type",
            "servicos_base"."event_id",
            "servicos_base"."tenant_id",
            "servicos_base"."event_date",
            "servicos_base"."event_time",
            "servicos_base"."agendamento_id",
            "servicos_base"."cliente_id",
            "servicos_base"."cliente_nome",
            "servicos_base"."profissional_id",
            "servicos_base"."profissional_nome",
            "servicos_base"."servico_id",
            "servicos_base"."servico_nome",
            "servicos_base"."valor_bruto" AS "valor",
            ("servicos_base"."valor_bruto" * ("servicos_base"."pct_comissao" / 100.0)) AS "comissao_profissional",
            ("servicos_base"."valor_bruto" * (((100)::numeric - "servicos_base"."pct_comissao") / 100.0)) AS "comissao_estabelecimento",
            true AS "conta_faturamento",
            true AS "conta_atendimento",
            true AS "conta_top_servico",
            true AS "conta_comissao",
            NULL::"uuid" AS "produto_id",
            NULL::"uuid" AS "pacote_id",
            NULL::"text" AS "forma_pagamento"
           FROM "servicos_base"
          WHERE (("servicos_base"."servico_origem" = 'avulso'::"text") AND (("servicos_base"."agendamento_status" = 'concluido'::"public"."agendamento_status") OR ("servicos_base"."conclusion_type" = 'cancelado_com_venda'::"text")))
        ), "ev_pacote_uso" AS (
         SELECT 'servico_pacote_uso'::"text" AS "event_type",
            "servicos_base"."event_id",
            "servicos_base"."tenant_id",
            "servicos_base"."event_date",
            "servicos_base"."event_time",
            "servicos_base"."agendamento_id",
            "servicos_base"."cliente_id",
            "servicos_base"."cliente_nome",
            "servicos_base"."profissional_id",
            "servicos_base"."profissional_nome",
            "servicos_base"."servico_id",
            "servicos_base"."servico_nome",
            "servicos_base"."valor_bruto" AS "valor",
            ("servicos_base"."valor_bruto" * ("servicos_base"."pct_comissao" / 100.0)) AS "comissao_profissional",
            ("servicos_base"."valor_bruto" * (((100)::numeric - "servicos_base"."pct_comissao") / 100.0)) AS "comissao_estabelecimento",
            false AS "conta_faturamento",
            true AS "conta_atendimento",
            true AS "conta_top_servico",
            true AS "conta_comissao",
            NULL::"uuid" AS "produto_id",
            NULL::"uuid" AS "pacote_id",
            NULL::"text" AS "forma_pagamento"
           FROM "servicos_base"
          WHERE (("servicos_base"."servico_origem" = 'pacote_uso'::"text") AND ("servicos_base"."agendamento_status" = 'concluido'::"public"."agendamento_status"))
        ), "ev_pacote_venda" AS (
         SELECT 'pacote_venda'::"text" AS "event_type",
            "cp"."id" AS "event_id",
            "cp"."tenant_id",
            "cp"."data_inicio" AS "event_date",
            NULL::time without time zone AS "event_time",
            NULL::"uuid" AS "agendamento_id",
            "cp"."cliente_id",
            "cl"."nome" AS "cliente_nome",
            NULL::"uuid" AS "profissional_id",
            NULL::"text" AS "profissional_nome",
            "pk"."servico_id",
            "pk"."nome" AS "servico_nome",
            "cp"."preco_total" AS "valor",
            (0)::numeric AS "comissao_profissional",
            "cp"."preco_total" AS "comissao_estabelecimento",
            true AS "conta_faturamento",
            false AS "conta_atendimento",
            false AS "conta_top_servico",
            false AS "conta_comissao",
            NULL::"uuid" AS "produto_id",
            "cp"."pacote_id",
            NULL::"text" AS "forma_pagamento"
           FROM (("public"."cliente_pacotes" "cp"
             LEFT JOIN "public"."pacotes" "pk" ON (("pk"."id" = "cp"."pacote_id")))
             LEFT JOIN "public"."clientes" "cl" ON (("cl"."id" = "cp"."cliente_id")))
          WHERE ("cp"."status" <> 'cancelado'::"text")
        ), "ev_produto_venda" AS (
         SELECT 'produto_venda'::"text" AS "event_type",
            "ap"."id" AS "event_id",
            "ap"."tenant_id",
            "a"."data" AS "event_date",
            "a"."hora" AS "event_time",
            "a"."id" AS "agendamento_id",
            "a"."cliente_id",
            "a"."cliente_nome",
            "a"."profissional_id",
            "p"."nome" AS "profissional_nome",
            NULL::"uuid" AS "servico_id",
            "pr"."nome" AS "servico_nome",
            ("ap"."quantidade" * "ap"."preco_unitario") AS "valor",
            (0)::numeric AS "comissao_profissional",
            ("ap"."quantidade" * "ap"."preco_unitario") AS "comissao_estabelecimento",
            true AS "conta_faturamento",
            false AS "conta_atendimento",
            false AS "conta_top_servico",
            false AS "conta_comissao",
            "ap"."produto_id",
            NULL::"uuid" AS "pacote_id",
            NULL::"text" AS "forma_pagamento"
           FROM ((("public"."agendamento_produtos" "ap"
             JOIN "public"."agendamentos" "a" ON (("a"."id" = "ap"."agendamento_id")))
             LEFT JOIN "public"."profissionais" "p" ON (("p"."id" = "a"."profissional_id")))
             LEFT JOIN "public"."produtos" "pr" ON (("pr"."id" = "ap"."produto_id")))
          WHERE (("a"."status" = 'concluido'::"public"."agendamento_status") OR ("a"."conclusion_type" = 'cancelado_com_venda'::"text"))
        ), "ev_pagamento" AS (
         SELECT 'pagamento'::"text" AS "event_type",
            "pg"."id" AS "event_id",
            "pg"."tenant_id",
            "a"."data" AS "event_date",
            "a"."hora" AS "event_time",
            "a"."id" AS "agendamento_id",
            "a"."cliente_id",
            "a"."cliente_nome",
            "a"."profissional_id",
            "p"."nome" AS "profissional_nome",
            NULL::"uuid" AS "servico_id",
            NULL::"text" AS "servico_nome",
            "pg"."valor",
            (0)::numeric AS "comissao_profissional",
            (0)::numeric AS "comissao_estabelecimento",
            false AS "conta_faturamento",
            false AS "conta_atendimento",
            false AS "conta_top_servico",
            false AS "conta_comissao",
            NULL::"uuid" AS "produto_id",
            NULL::"uuid" AS "pacote_id",
            "pg"."forma_pagamento"
           FROM (("public"."agendamento_pagamentos" "pg"
             JOIN "public"."agendamentos" "a" ON (("a"."id" = "pg"."agendamento_id")))
             LEFT JOIN "public"."profissionais" "p" ON (("p"."id" = "a"."profissional_id")))
        ), "ev_cancelamento" AS (
         SELECT
                CASE
                    WHEN ("a"."conclusion_type" = 'cancelado_com_venda'::"text") THEN 'cancelado_c_venda'::"text"
                    ELSE 'cancelamento'::"text"
                END AS "event_type",
            "a"."id" AS "event_id",
            "a"."tenant_id",
            "a"."data" AS "event_date",
            "a"."hora" AS "event_time",
            "a"."id" AS "agendamento_id",
            "a"."cliente_id",
            "a"."cliente_nome",
            "a"."profissional_id",
            "p"."nome" AS "profissional_nome",
            NULL::"uuid" AS "servico_id",
            NULL::"text" AS "servico_nome",
            COALESCE(( SELECT "sum"("ags"."preco") AS "sum"
                   FROM "public"."agendamento_servicos" "ags"
                  WHERE ("ags"."agendamento_id" = "a"."id")), (0)::numeric) AS "valor",
            (0)::numeric AS "comissao_profissional",
            (0)::numeric AS "comissao_estabelecimento",
            false AS "conta_faturamento",
            false AS "conta_atendimento",
            false AS "conta_top_servico",
            false AS "conta_comissao",
            NULL::"uuid" AS "produto_id",
            NULL::"uuid" AS "pacote_id",
            NULL::"text" AS "forma_pagamento"
           FROM ("public"."agendamentos" "a"
             LEFT JOIN "public"."profissionais" "p" ON (("p"."id" = "a"."profissional_id")))
          WHERE (("a"."status" = 'cancelado'::"public"."agendamento_status") OR ("a"."conclusion_type" = 'cancelado_com_venda'::"text"))
        )
 SELECT "ev_servico_venda"."event_type",
    "ev_servico_venda"."event_id",
    "ev_servico_venda"."tenant_id",
    "ev_servico_venda"."event_date",
    "ev_servico_venda"."event_time",
    "ev_servico_venda"."agendamento_id",
    "ev_servico_venda"."cliente_id",
    "ev_servico_venda"."cliente_nome",
    "ev_servico_venda"."profissional_id",
    "ev_servico_venda"."profissional_nome",
    "ev_servico_venda"."servico_id",
    "ev_servico_venda"."servico_nome",
    "ev_servico_venda"."valor",
    "ev_servico_venda"."comissao_profissional",
    "ev_servico_venda"."comissao_estabelecimento",
    "ev_servico_venda"."conta_faturamento",
    "ev_servico_venda"."conta_atendimento",
    "ev_servico_venda"."conta_top_servico",
    "ev_servico_venda"."conta_comissao",
    "ev_servico_venda"."produto_id",
    "ev_servico_venda"."pacote_id",
    "ev_servico_venda"."forma_pagamento"
   FROM "ev_servico_venda"
UNION ALL
 SELECT "ev_pacote_uso"."event_type",
    "ev_pacote_uso"."event_id",
    "ev_pacote_uso"."tenant_id",
    "ev_pacote_uso"."event_date",
    "ev_pacote_uso"."event_time",
    "ev_pacote_uso"."agendamento_id",
    "ev_pacote_uso"."cliente_id",
    "ev_pacote_uso"."cliente_nome",
    "ev_pacote_uso"."profissional_id",
    "ev_pacote_uso"."profissional_nome",
    "ev_pacote_uso"."servico_id",
    "ev_pacote_uso"."servico_nome",
    "ev_pacote_uso"."valor",
    "ev_pacote_uso"."comissao_profissional",
    "ev_pacote_uso"."comissao_estabelecimento",
    "ev_pacote_uso"."conta_faturamento",
    "ev_pacote_uso"."conta_atendimento",
    "ev_pacote_uso"."conta_top_servico",
    "ev_pacote_uso"."conta_comissao",
    "ev_pacote_uso"."produto_id",
    "ev_pacote_uso"."pacote_id",
    "ev_pacote_uso"."forma_pagamento"
   FROM "ev_pacote_uso"
UNION ALL
 SELECT "ev_pacote_venda"."event_type",
    "ev_pacote_venda"."event_id",
    "ev_pacote_venda"."tenant_id",
    "ev_pacote_venda"."event_date",
    "ev_pacote_venda"."event_time",
    "ev_pacote_venda"."agendamento_id",
    "ev_pacote_venda"."cliente_id",
    "ev_pacote_venda"."cliente_nome",
    "ev_pacote_venda"."profissional_id",
    "ev_pacote_venda"."profissional_nome",
    "ev_pacote_venda"."servico_id",
    "ev_pacote_venda"."servico_nome",
    "ev_pacote_venda"."valor",
    "ev_pacote_venda"."comissao_profissional",
    "ev_pacote_venda"."comissao_estabelecimento",
    "ev_pacote_venda"."conta_faturamento",
    "ev_pacote_venda"."conta_atendimento",
    "ev_pacote_venda"."conta_top_servico",
    "ev_pacote_venda"."conta_comissao",
    "ev_pacote_venda"."produto_id",
    "ev_pacote_venda"."pacote_id",
    "ev_pacote_venda"."forma_pagamento"
   FROM "ev_pacote_venda"
UNION ALL
 SELECT "ev_produto_venda"."event_type",
    "ev_produto_venda"."event_id",
    "ev_produto_venda"."tenant_id",
    "ev_produto_venda"."event_date",
    "ev_produto_venda"."event_time",
    "ev_produto_venda"."agendamento_id",
    "ev_produto_venda"."cliente_id",
    "ev_produto_venda"."cliente_nome",
    "ev_produto_venda"."profissional_id",
    "ev_produto_venda"."profissional_nome",
    "ev_produto_venda"."servico_id",
    "ev_produto_venda"."servico_nome",
    "ev_produto_venda"."valor",
    "ev_produto_venda"."comissao_profissional",
    "ev_produto_venda"."comissao_estabelecimento",
    "ev_produto_venda"."conta_faturamento",
    "ev_produto_venda"."conta_atendimento",
    "ev_produto_venda"."conta_top_servico",
    "ev_produto_venda"."conta_comissao",
    "ev_produto_venda"."produto_id",
    "ev_produto_venda"."pacote_id",
    "ev_produto_venda"."forma_pagamento"
   FROM "ev_produto_venda"
UNION ALL
 SELECT "ev_pagamento"."event_type",
    "ev_pagamento"."event_id",
    "ev_pagamento"."tenant_id",
    "ev_pagamento"."event_date",
    "ev_pagamento"."event_time",
    "ev_pagamento"."agendamento_id",
    "ev_pagamento"."cliente_id",
    "ev_pagamento"."cliente_nome",
    "ev_pagamento"."profissional_id",
    "ev_pagamento"."profissional_nome",
    "ev_pagamento"."servico_id",
    "ev_pagamento"."servico_nome",
    "ev_pagamento"."valor",
    "ev_pagamento"."comissao_profissional",
    "ev_pagamento"."comissao_estabelecimento",
    "ev_pagamento"."conta_faturamento",
    "ev_pagamento"."conta_atendimento",
    "ev_pagamento"."conta_top_servico",
    "ev_pagamento"."conta_comissao",
    "ev_pagamento"."produto_id",
    "ev_pagamento"."pacote_id",
    "ev_pagamento"."forma_pagamento"
   FROM "ev_pagamento"
UNION ALL
 SELECT "ev_cancelamento"."event_type",
    "ev_cancelamento"."event_id",
    "ev_cancelamento"."tenant_id",
    "ev_cancelamento"."event_date",
    "ev_cancelamento"."event_time",
    "ev_cancelamento"."agendamento_id",
    "ev_cancelamento"."cliente_id",
    "ev_cancelamento"."cliente_nome",
    "ev_cancelamento"."profissional_id",
    "ev_cancelamento"."profissional_nome",
    "ev_cancelamento"."servico_id",
    "ev_cancelamento"."servico_nome",
    "ev_cancelamento"."valor",
    "ev_cancelamento"."comissao_profissional",
    "ev_cancelamento"."comissao_estabelecimento",
    "ev_cancelamento"."conta_faturamento",
    "ev_cancelamento"."conta_atendimento",
    "ev_cancelamento"."conta_top_servico",
    "ev_cancelamento"."conta_comissao",
    "ev_cancelamento"."produto_id",
    "ev_cancelamento"."pacote_id",
    "ev_cancelamento"."forma_pagamento"
   FROM "ev_cancelamento";


ALTER VIEW "public"."dashboard_v2_eventos" OWNER TO "postgres";


COMMENT ON VIEW "public"."dashboard_v2_eventos" IS 'Fonte única da verdade do Dashboard V2. Cada linha é um evento de negócio (venda/uso/pagamento/cancelamento). Todos os indicadores derivam desta view.';



CREATE OR REPLACE FUNCTION "public"."dashboard_v2_auditoria"("p_tenant" "uuid", "p_ini" "date", "p_fim" "date", "p_prof" "uuid" DEFAULT NULL::"uuid", "p_metrica" "text" DEFAULT 'faturamento'::"text") RETURNS SETOF "public"."dashboard_v2_eventos"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF v_uid IS NULL THEN
    IF COALESCE(v_role, current_user) <> 'service_role' THEN
      RAISE EXCEPTION 'not_authorized_for_tenant';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.get_user_tenant_ids(v_uid) AS t(tenant_id)
      WHERE t.tenant_id = p_tenant
    ) THEN
      RAISE EXCEPTION 'not_authorized_for_tenant';
    END IF;
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.dashboard_v2_eventos
    WHERE tenant_id = p_tenant
      AND event_date BETWEEN p_ini AND p_fim
      AND (p_prof IS NULL OR profissional_id = p_prof)
      AND CASE p_metrica
            WHEN 'faturamento'    THEN conta_faturamento
            WHEN 'atendimento'    THEN conta_atendimento
            WHEN 'comissao'       THEN conta_comissao
            WHEN 'produto'        THEN event_type = 'produto_venda'
            WHEN 'pacote'         THEN event_type = 'pacote_venda'
            WHEN 'cancelamento'   THEN event_type IN ('cancelamento','cancelado_c_venda')
            WHEN 'pagamento'      THEN event_type = 'pagamento'
            ELSE TRUE
          END
    ORDER BY event_date, event_time NULLS LAST;
END;
$$;


ALTER FUNCTION "public"."dashboard_v2_auditoria"("p_tenant" "uuid", "p_ini" "date", "p_fim" "date", "p_prof" "uuid", "p_metrica" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dashboard_v2_snapshot"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  j              jsonb;
  v_balcao       integer := 0;
  v_ag           numeric;
  v_fat_s        numeric;
  v_rows         jsonb;
  v_prod_total   numeric := 0;
BEGIN
  ------------------------------------------------------------------
  -- 0) Snapshot base (fonte única da verdade dos demais números)
  ------------------------------------------------------------------
  j := to_jsonb(public.dashboard_v2_snapshot_base(
         p_tenant_id, p_data_inicio, p_data_fim, p_profissional_id));

  ------------------------------------------------------------------
  -- 1) (mantido) Agendamentos de origem BALCAO não são atendimentos
  ------------------------------------------------------------------
  SELECT COUNT(*) INTO v_balcao
    FROM public.agendamentos a
   WHERE a.tenant_id = p_tenant_id
     AND a.origem = 'BALCAO'
     AND a.data BETWEEN p_data_inicio AND p_data_fim
     AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id);

  IF j ? 'kpis' AND v_balcao > 0 THEN
    v_ag    := GREATEST(COALESCE((j->'kpis'->>'agendamentos')::numeric, 0) - v_balcao, 0);
    v_fat_s := COALESCE((j->'kpis'->>'faturamentoServicos')::numeric,
                        (j->'kpis'->>'faturamento')::numeric, 0);
    j := jsonb_set(j, '{kpis,agendamentos}',  to_jsonb(v_ag));
    j := jsonb_set(j, '{kpis,ticketMedio}',
                   to_jsonb(CASE WHEN v_ag > 0 THEN round(v_fat_s / v_ag, 2) ELSE 0 END));
  END IF;

  ------------------------------------------------------------------
  -- 2) Produtos vendidos DENTRO do agendamento, por profissional.
  --    Cálculo set-based: nada é inferido do JSON serializado.
  ------------------------------------------------------------------
  IF jsonb_typeof(j->'profissionaisTable') = 'array' THEN

    WITH
    -- 2.1 linhas do JSON preservando a ordem original
    linhas AS (
      SELECT elem, ord
        FROM jsonb_array_elements(j->'profissionaisTable')
             WITH ORDINALITY AS t(elem, ord)
    ),
    -- 2.2 chave real do profissional (id do JSON, se houver; senão por nome)
    linhas_id AS (
      SELECT l.ord,
             l.elem,
             COALESCE(
               NULLIF(l.elem->>'profissionalId', '')::uuid,
               NULLIF(l.elem->>'profissional_id','')::uuid,
               NULLIF(l.elem->>'id','')::uuid,
               p.id
             ) AS profissional_id
        FROM linhas l
        LEFT JOIN public.profissionais p
               ON p.tenant_id = p_tenant_id
              AND lower(btrim(p.nome)) = lower(btrim(l.elem->>'nome'))
    ),
    -- 2.3 produtos do domínio agendamento, agregados por profissional
    prod AS (
      SELECT a.profissional_id,
             SUM(ap.quantidade * ap.preco_unitario) AS total,
             SUM(ap.quantidade)                     AS qtd
        FROM public.agendamento_produtos ap
        JOIN public.agendamentos a ON a.id = ap.agendamento_id
       WHERE a.tenant_id = p_tenant_id
         AND a.data BETWEEN p_data_inicio AND p_data_fim
         AND (a.status = 'concluido'::agendamento_status
              OR a.conclusion_type = 'cancelado_com_venda')
         AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
       GROUP BY a.profissional_id
    ),
    -- 2.4 recomposição da linha
    montado AS (
      SELECT li.ord,
             li.elem
               -- expõe a chave para o frontend e para patches futuros
               || jsonb_build_object('profissionalId', li.profissional_id)
               || jsonb_build_object(
                    'produtosVendidos',
                    round(COALESCE((li.elem->>'produtosVendidos')::numeric, 0)
                          + COALESCE(pr.total, 0), 2),
                    'produtosQtd',
                    COALESCE((li.elem->>'produtosQtd')::numeric, 0)
                          + COALESCE(pr.qtd, 0),
                    -- invariante: produtos nunca entram no repasse
                    'totalReceber',
                    round(COALESCE((li.elem->>'comissao')::numeric, 0)
                          + COALESCE((li.elem->>'caixinha')::numeric, 0), 2)
                  ) AS elem
        FROM linhas_id li
        LEFT JOIN prod pr ON pr.profissional_id = li.profissional_id
    )
    SELECT jsonb_agg(m.elem ORDER BY m.ord) INTO v_rows FROM montado m;

    j := jsonb_set(j, '{profissionaisTable}', COALESCE(v_rows, '[]'::jsonb));
  END IF;

  ------------------------------------------------------------------
  -- 3) KPI global de produtos = soma consolidada da tabela
  ------------------------------------------------------------------
  IF j ? 'kpis' AND jsonb_typeof(j->'profissionaisTable') = 'array' THEN
    SELECT COALESCE(SUM((e->>'produtosVendidos')::numeric), 0)
      INTO v_prod_total
      FROM jsonb_array_elements(j->'profissionaisTable') AS e;

    j := jsonb_set(j, '{kpis,produtosVendidos}', to_jsonb(round(v_prod_total, 2)), true);
  END IF;

  RETURN j::jsonb;
END;
$$;


ALTER FUNCTION "public"."dashboard_v2_snapshot"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dashboard_v2_snapshot"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") IS 'Dashboard V2 · wrapper do snapshot. Consolida agendamentos + vendas de balcão. Produtos (agendamento_produtos e venda_itens) alimentam apenas Faturamento e Produtos Vendidos; nunca comissão, caixinha ou Total a Receber. Expõe profissionalId em profissionaisTable.';



CREATE OR REPLACE FUNCTION "public"."dashboard_v2_snapshot_base"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_days     integer;
  v_prev_ini date;
  v_prev_fim date;

  cur_ag        integer := 0;
  cur_srv       integer := 0;
  cur_fat_serv  numeric := 0;   -- receita vinda de agendamentos
  cur_fat_vend  numeric := 0;   -- receita vinda do domínio de vendas
  cur_fat       numeric := 0;   -- total
  cur_tkt       numeric := 0;   -- ticket médio DE SERVIÇOS (não inclui vendas)

  prev_ag       integer := 0;
  prev_srv      integer := 0;
  prev_fat_serv numeric := 0;
  prev_fat_vend numeric := 0;
  prev_fat      numeric := 0;
  prev_tkt      numeric := 0;

  j_pagamentos   jsonb;
  j_profissionais jsonb;
  j_servicos     jsonb;
  j_pacotes      jsonb;
  j_clientes     jsonb;
  j_cancel       jsonb;
  j_produtos     jsonb;
BEGIN
  v_days     := (p_data_fim - p_data_inicio) + 1;
  v_prev_fim := p_data_inicio - 1;
  v_prev_ini := v_prev_fim - (v_days - 1);

  -- ==================================================================
  -- KPIs — período atual
  -- ==================================================================
  SELECT COUNT(*) INTO cur_ag
  FROM public.agendamentos a
  WHERE a.tenant_id = p_tenant_id
    AND a.status = 'concluido'
    AND a.data BETWEEN p_data_inicio AND p_data_fim
    AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id);

  SELECT COUNT(*) INTO cur_srv
  FROM public.agendamento_servicos s
  JOIN public.agendamentos a ON a.id = s.agendamento_id
  WHERE a.tenant_id = p_tenant_id
    AND a.status = 'concluido'
    AND a.data BETWEEN p_data_inicio AND p_data_fim
    AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
    AND s.origem IN ('avulso','pacote_uso');

  SELECT COALESCE(SUM(pg.valor), 0) INTO cur_fat_serv
  FROM public.agendamento_pagamentos pg
  JOIN public.agendamentos a ON a.id = pg.agendamento_id
  WHERE a.tenant_id = p_tenant_id
    AND a.status = 'concluido'
    AND a.data BETWEEN p_data_inicio AND p_data_fim
    AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id);

  -- Receita do domínio de VENDAS (Venda de Balcão) — entra só no faturamento
  SELECT COALESCE(SUM(vr.valor), 0) INTO cur_fat_vend
  FROM public.dv2_vendas_receita vr
  WHERE vr.tenant_id = p_tenant_id
    AND vr.data BETWEEN p_data_inicio AND p_data_fim
    AND (p_profissional_id IS NULL OR vr.profissional_id = p_profissional_id);

  cur_fat := cur_fat_serv + cur_fat_vend;
  -- Ticket médio permanece um indicador de ATENDIMENTO: usa só serviços.
  cur_tkt := CASE WHEN cur_ag > 0 THEN cur_fat_serv / cur_ag ELSE 0 END;

  -- ==================================================================
  -- KPIs — período anterior (para deltas)
  -- ==================================================================
  SELECT COUNT(*) INTO prev_ag
  FROM public.agendamentos a
  WHERE a.tenant_id = p_tenant_id
    AND a.status = 'concluido'
    AND a.data BETWEEN v_prev_ini AND v_prev_fim
    AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id);

  SELECT COUNT(*) INTO prev_srv
  FROM public.agendamento_servicos s
  JOIN public.agendamentos a ON a.id = s.agendamento_id
  WHERE a.tenant_id = p_tenant_id
    AND a.status = 'concluido'
    AND a.data BETWEEN v_prev_ini AND v_prev_fim
    AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
    AND s.origem IN ('avulso','pacote_uso');

  SELECT COALESCE(SUM(pg.valor), 0) INTO prev_fat_serv
  FROM public.agendamento_pagamentos pg
  JOIN public.agendamentos a ON a.id = pg.agendamento_id
  WHERE a.tenant_id = p_tenant_id
    AND a.status = 'concluido'
    AND a.data BETWEEN v_prev_ini AND v_prev_fim
    AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id);

  SELECT COALESCE(SUM(vr.valor), 0) INTO prev_fat_vend
  FROM public.dv2_vendas_receita vr
  WHERE vr.tenant_id = p_tenant_id
    AND vr.data BETWEEN v_prev_ini AND v_prev_fim
    AND (p_profissional_id IS NULL OR vr.profissional_id = p_profissional_id);

  prev_fat := prev_fat_serv + prev_fat_vend;
  prev_tkt := CASE WHEN prev_ag > 0 THEN prev_fat_serv / prev_ag ELSE 0 END;

  -- ==================================================================
  -- PAGAMENTOS
  -- (recebido / formas / por dia consideram agendamentos + vendas;
  --  pendências continuam exclusivas de agendamentos, pois venda de
  --  balcão é sempre paga no ato)
  -- ==================================================================
  WITH ag AS (
    SELECT a.*
    FROM public.agendamentos a
    WHERE a.tenant_id = p_tenant_id
      AND a.data BETWEEN p_data_inicio AND p_data_fim
      AND a.status::text NOT IN ('cancelado','excluido','deletado','removido')
      AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
  ),
  pg AS (
    SELECT p.forma_pagamento, p.valor, ag.data AS ag_data
    FROM public.agendamento_pagamentos p
    JOIN ag ON ag.id = p.agendamento_id
    UNION ALL
    SELECT vr.forma_pagamento, vr.valor, vr.data AS ag_data
    FROM public.dv2_vendas_receita vr
    WHERE vr.tenant_id = p_tenant_id
      AND vr.data BETWEEN p_data_inicio AND p_data_fim
      AND (p_profissional_id IS NULL OR vr.profissional_id = p_profissional_id)
  ),
  recebido AS (
    SELECT COALESCE(SUM(valor),0) AS v FROM pg
  ),
  -- ------------------------------------------------------------------
  -- PENDÊNCIAS FINANCEIRAS (receita futura ainda não recebida)
  -- ------------------------------------------------------------------
  pend AS (
    SELECT ag.id, ag.cliente_nome, ag.data, ag.hora, ag.profissional_id,
           ROUND(GREATEST(COALESCE(ag.total,0) - COALESCE(ag.valor_total_pago,0), 0), 2) AS restante
    FROM ag
    WHERE ag.status::text NOT IN ('cancelado','excluido','deletado','removido','nao_compareceu','no_show')
      AND COALESCE(ag.total,0) > 0.009
      AND GREATEST(COALESCE(ag.total,0) - COALESCE(ag.valor_total_pago,0), 0) > 0.009
  ),
  formas AS (
    SELECT forma_pagamento AS forma,
           SUM(valor)      AS valor,
           COUNT(*)        AS qtd
    FROM pg
    GROUP BY 1
  ),
  por_dia AS (
    SELECT ag_data AS dia, forma_pagamento AS forma, SUM(valor) AS valor
    FROM pg
    GROUP BY 1,2
  ),
  por_dia_json AS (
    SELECT dia,
           jsonb_object_agg(forma, ROUND(valor,2)) AS formas
    FROM por_dia
    GROUP BY dia
  )
  SELECT jsonb_build_object(
    'recebido',      (SELECT ROUND(v,2) FROM recebido),
    'pendente',      (SELECT COALESCE(ROUND(SUM(restante),2),0) FROM pend),
    'pendenciasQtd', (SELECT COUNT(*) FROM pend),
    'formas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'forma', forma, 'valor', ROUND(valor,2), 'qtd', qtd
             ) ORDER BY valor DESC) FROM formas
    ), '[]'::jsonb),
    'porDia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'data', dia, 'formas', formas
             ) ORDER BY dia) FROM por_dia_json
    ), '[]'::jsonb),
    'pendencias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'cliente',      pend.cliente_nome,
               'servico',      COALESCE((
                 SELECT string_agg(sv.nome, ' + ' ORDER BY sv.nome)
                 FROM public.agendamento_servicos asv
                 JOIN public.servicos sv ON sv.id = asv.servico_id
                 WHERE asv.agendamento_id = pend.id
               ), '—'),
               'servicos',     COALESCE((
                 SELECT string_agg(sv.nome, ' + ' ORDER BY sv.nome)
                 FROM public.agendamento_servicos asv
                 JOIN public.servicos sv ON sv.id = asv.servico_id
                 WHERE asv.agendamento_id = pend.id
               ), '—'),
               'profissional', COALESCE(pr.nome, '—'),
               'valor',        ROUND(pend.restante,2),
               'data',         pend.data,
               'hora',         to_char(pend.hora, 'HH24:MI')
             ) ORDER BY pend.data, pend.hora)
      FROM pend
      LEFT JOIN public.profissionais pr ON pr.id = pend.profissional_id
    ), '[]'::jsonb)
  ) INTO j_pagamentos;

  -- ==================================================================
  -- PROFISSIONAIS (performance individual)
  --   atendimentos / serviços / comissão / caixinha → SOMENTE serviços
  --   produtosVendidos                              → domínio de vendas
  --   faturamento                                   → serviços + produtos
  -- ==================================================================
  WITH ag AS (
    SELECT a.*
    FROM public.agendamentos a
    WHERE a.tenant_id = p_tenant_id
      AND a.status = 'concluido'
      AND a.data BETWEEN p_data_inicio AND p_data_fim
      AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
  ),
  base AS (
    SELECT ag.profissional_id,
           COUNT(*)                                            AS atendimentos,
           COALESCE(SUM(ag.caixinha_total),0)                   AS caixinha,
           COALESCE(SUM(ag.base_comissao
             * COALESCE(cp.percentual_profissional, 50) / 100.0),0) AS comissao,
           COALESCE((SELECT SUM(p.valor)
                     FROM public.agendamento_pagamentos p
                     WHERE p.agendamento_id = ANY(array_agg(ag.id))),0) AS faturamento_servicos,
           COALESCE((SELECT COUNT(*)
                     FROM public.agendamento_servicos s
                     WHERE s.agendamento_id = ANY(array_agg(ag.id))
                       AND s.origem IN ('avulso','pacote_uso')),0) AS servicos
    FROM ag
    LEFT JOIN LATERAL (
      SELECT cx.percentual_profissional
      FROM public.comissoes_profissionais cx
      WHERE cx.profissional_id = ag.profissional_id
        AND cx.tenant_id = p_tenant_id
      LIMIT 1
    ) cp ON TRUE
    GROUP BY ag.profissional_id
  ),
  vend AS (
    SELECT vi.profissional_id,
           COALESCE(SUM(vi.valor),0)      AS produtos_valor,
           COALESCE(SUM(vi.quantidade),0) AS produtos_qtd
    FROM public.dv2_vendas_itens vi
    WHERE vi.tenant_id = p_tenant_id
      AND vi.data BETWEEN p_data_inicio AND p_data_fim
      AND (p_profissional_id IS NULL OR vi.profissional_id = p_profissional_id)
    GROUP BY vi.profissional_id
  ),
  uni AS (
    SELECT COALESCE(base.profissional_id, vend.profissional_id) AS profissional_id,
           COALESCE(base.atendimentos, 0)          AS atendimentos,
           COALESCE(base.servicos, 0)              AS servicos,
           COALESCE(base.faturamento_servicos, 0)  AS faturamento_servicos,
           COALESCE(vend.produtos_valor, 0)        AS produtos_valor,
           COALESCE(vend.produtos_qtd, 0)          AS produtos_qtd,
           COALESCE(base.comissao, 0)              AS comissao,
           COALESCE(base.caixinha, 0)              AS caixinha
    FROM base
    FULL OUTER JOIN vend ON vend.profissional_id = base.profissional_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome',             COALESCE(pr.nome, '—'),
           'atendimentos',     uni.atendimentos,
           'servicos',         uni.servicos,
           'faturamentoServicos', ROUND(uni.faturamento_servicos,2),
           'produtosVendidos', ROUND(uni.produtos_valor,2),
           'produtosQtd',      uni.produtos_qtd,
           'faturamento',      ROUND(uni.faturamento_servicos + uni.produtos_valor,2),
           'comissao',         ROUND(uni.comissao,2),
           'caixinha',         ROUND(uni.caixinha,2),
           'total',            ROUND(uni.comissao + uni.caixinha,2)
         ) ORDER BY (uni.faturamento_servicos + uni.produtos_valor) DESC), '[]'::jsonb)
    INTO j_profissionais
  FROM uni
  LEFT JOIN public.profissionais pr ON pr.id = uni.profissional_id;

  -- ==================================================================
  -- SERVIÇOS (top 10) — inalterado (vendas não entram aqui)
  -- ==================================================================
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'qtd')::int DESC), '[]'::jsonb)
    INTO j_servicos
  FROM (
    SELECT jsonb_build_object(
             'nome',  COALESCE(sv.nome, '—'),
             'qtd',   COUNT(*),
             'valor', ROUND(COALESCE(SUM(s.preco),0),2),
             'pkg',   bool_or(s.origem = 'pacote_uso')
           ) AS x
    FROM public.agendamento_servicos s
    JOIN public.agendamentos a ON a.id = s.agendamento_id
    LEFT JOIN public.servicos sv ON sv.id = s.servico_id
    WHERE a.tenant_id = p_tenant_id
      AND a.status = 'concluido'
      AND a.data BETWEEN p_data_inicio AND p_data_fim
      AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
      AND s.origem IN ('avulso','pacote_uso')
    GROUP BY sv.nome
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  -- ==================================================================
  -- PACOTES vendidos no período
  -- FONTE DE VERDADE: agendamento_servicos.origem = 'pacote_venda'
  -- ==================================================================
  WITH vendas AS (
    SELECT
      cp.pacote_id                        AS pacote_id,
      COALESCE(asv.preco, 0)::numeric     AS preco_total
    FROM public.agendamento_servicos asv
    JOIN public.agendamentos a
      ON a.id = asv.agendamento_id
    LEFT JOIN public.cliente_pacotes cp
      ON cp.id = asv.cliente_pacote_id
    WHERE a.tenant_id = p_tenant_id
      AND COALESCE(asv.origem::text,'') = 'pacote_venda'
      AND a.data BETWEEN p_data_inicio AND p_data_fim
      AND a.status::text NOT IN ('cancelado','nao_compareceu','excluido','deletado','no_show')
      AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
      AND COALESCE(cp.status, 'ativo') <> 'cancelado'
  )
  SELECT jsonb_build_object(
    'qtd',     (SELECT COUNT(*) FROM vendas),
    'receita', (SELECT COALESCE(ROUND(SUM(preco_total),2),0) FROM vendas),
    'lista', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'pacote',  COALESCE(pk.nome,'—'),
               'qtd',     cnt,
               'receita', ROUND(rec,2)
             ) ORDER BY rec DESC)
      FROM (
        SELECT pacote_id, COUNT(*) AS cnt, SUM(preco_total) AS rec
        FROM vendas GROUP BY pacote_id
      ) g
      LEFT JOIN public.pacotes pk ON pk.id = g.pacote_id
    ), '[]'::jsonb)
  ) INTO j_pacotes;

  -- ==================================================================
  -- CLIENTES (top 10 por atendimentos) — inalterado
  -- ==================================================================
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'atendimentos')::int DESC), '[]'::jsonb)
    INTO j_clientes
  FROM (
    SELECT jsonb_build_object(
             'nome',         a.cliente_nome,
             'atendimentos', COUNT(*),
             'pkg',          bool_or(EXISTS (
                               SELECT 1 FROM public.agendamento_servicos s
                               WHERE s.agendamento_id = a.id AND s.origem = 'pacote_uso'
                             ))
           ) AS x
    FROM public.agendamentos a
    WHERE a.tenant_id = p_tenant_id
      AND a.status = 'concluido'
      AND a.data BETWEEN p_data_inicio AND p_data_fim
      AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
    GROUP BY a.cliente_nome
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  -- ==================================================================
  -- CANCELAMENTOS — inalterado
  -- ==================================================================
  WITH todos AS (
    SELECT a.*
    FROM public.agendamentos a
    WHERE a.tenant_id = p_tenant_id
      AND a.data BETWEEN p_data_inicio AND p_data_fim
      AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)
  ),
  canc AS (
    SELECT * FROM todos WHERE status = 'cancelado'
  ),
  com_venda AS (
    SELECT * FROM todos WHERE conclusion_type = 'cancelado_com_venda'
  )
  SELECT jsonb_build_object(
    'qtd',          (SELECT COUNT(*) FROM canc),
    'taxa',         CASE WHEN (SELECT COUNT(*) FROM todos) > 0
                         THEN ROUND((SELECT COUNT(*) FROM canc)::numeric
                                    / (SELECT COUNT(*) FROM todos), 4)
                         ELSE 0 END,
    'valorPerdido', (SELECT COALESCE(ROUND(SUM(COALESCE(total,0)),2),0) FROM canc),
    'comVenda',     (SELECT COUNT(*) FROM com_venda),
    'motivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'v', v) ORDER BY v DESC)
      FROM (
        SELECT COALESCE(NULLIF(cl.motivo_nome,''), 'Não informado') AS label,
               COUNT(*) AS v
        FROM public.cancelamento_log cl
        JOIN canc ON canc.id = cl.agendamento_id
        WHERE cl.tenant_id = p_tenant_id
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 10
      ) m
    ), '[]'::jsonb),
    'porProfissional', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'v', v) ORDER BY v DESC)
      FROM (
        SELECT COALESCE(pr.nome, '—') AS label, COUNT(*) AS v
        FROM canc
        LEFT JOIN public.profissionais pr ON pr.id = canc.profissional_id
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 10
      ) p
    ), '[]'::jsonb)
  ) INTO j_cancel;

  -- ==================================================================
  -- PRODUTOS (Analytics)
  --   Fonte 1: produtos lançados dentro de agendamentos
  --   Fonte 2: NOVO domínio de vendas (Venda de Balcão)
  -- ==================================================================
  WITH itens AS (
    SELECT ap.produto_id,
           COALESCE(pr.nome, '—')                      AS nome,
           ap.quantidade::numeric                      AS qtd,
           (ap.quantidade * ap.preco_unitario)::numeric AS receita,
           (ap.quantidade * COALESCE(pr.custo, 0))::numeric AS custo,
           (pr.custo IS NOT NULL)                      AS tem_custo,
           'agendamento'::text                         AS origem
    FROM public.agendamento_produtos ap
    JOIN public.agendamentos a ON a.id = ap.agendamento_id
    LEFT JOIN public.produtos pr ON pr.id = ap.produto_id
    WHERE a.tenant_id = p_tenant_id
      AND a.data BETWEEN p_data_inicio AND p_data_fim
      AND a.status <> 'cancelado'
      AND (p_profissional_id IS NULL OR a.profissional_id = p_profissional_id)

    UNION ALL

    SELECT vi.produto_id,
           COALESCE(pr.nome, vi.descricao, '—')        AS nome,
           vi.quantidade                               AS qtd,
           vi.valor                                    AS receita,
           (vi.quantidade * COALESCE(pr.custo, 0))     AS custo,
           (pr.custo IS NOT NULL)                      AS tem_custo,
           'venda'::text                               AS origem
    FROM public.dv2_vendas_itens vi
    LEFT JOIN public.produtos pr ON pr.id = vi.produto_id
    WHERE vi.tenant_id = p_tenant_id
      AND vi.data BETWEEN p_data_inicio AND p_data_fim
      AND (p_profissional_id IS NULL OR vi.profissional_id = p_profissional_id)
  ),
  agg AS (
    SELECT nome,
           SUM(qtd)                     AS qtd,
           SUM(receita)                 AS receita,
           SUM(custo)                   AS custo,
           bool_and(tem_custo)          AS tem_custo
    FROM itens GROUP BY nome
  ),
  tot AS (
    SELECT COALESCE(SUM(receita),0) AS receita,
           COALESCE(SUM(custo),0)   AS custo,
           COALESCE(SUM(qtd),0)     AS qtd,
           COALESCE(SUM(receita) FILTER (WHERE origem = 'venda'),0)       AS receita_balcao,
           COALESCE(SUM(receita) FILTER (WHERE origem = 'agendamento'),0) AS receita_atendimento
    FROM itens
  )
  SELECT jsonb_build_object(
    'faturamentoBruto',    (SELECT ROUND(receita,2) FROM tot),
    'cmv',                 (SELECT ROUND(custo,2)   FROM tot),
    'lucroBruto',          (SELECT ROUND(receita - custo,2) FROM tot),
    'margem',              (SELECT CASE WHEN receita > 0
                                        THEN ROUND((receita - custo)/receita, 4)
                                        ELSE 0 END FROM tot),
    'qtdVendida',          (SELECT ROUND(qtd,2) FROM tot),
    'receitaBalcao',       (SELECT ROUND(receita_balcao,2) FROM tot),
    'receitaAtendimento',  (SELECT ROUND(receita_atendimento,2) FROM tot),
    'maisVendidos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome',nome,'qtd',qtd,'valor',ROUND(receita,2)) ORDER BY qtd DESC)
      FROM (SELECT * FROM agg ORDER BY qtd DESC LIMIT 5) a1
    ), '[]'::jsonb),
    'maisLucrativos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome',nome,'qtd',qtd,'lucro',ROUND(receita - custo,2)) ORDER BY (receita - custo) DESC)
      FROM (SELECT * FROM agg WHERE tem_custo ORDER BY (receita - custo) DESC LIMIT 5) a2
    ), '[]'::jsonb),
    'menorMargem', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome',nome,'margem',ROUND((receita - custo)/NULLIF(receita,0),4)) ORDER BY (receita - custo)/NULLIF(receita,0) ASC)
      FROM (SELECT * FROM agg WHERE tem_custo AND receita > 0
            ORDER BY (receita - custo)/receita ASC LIMIT 5) a3
    ), '[]'::jsonb)
  ) INTO j_produtos;

  -- ==================================================================
  -- RETORNO
  -- ==================================================================
  RETURN jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio',          p_data_inicio,
      'fim',             p_data_fim,
      'inicio_anterior', v_prev_ini,
      'fim_anterior',    v_prev_fim,
      'dias',            v_days
    ),
    'kpis', jsonb_build_object(
      'agendamentos',        cur_ag,
      'servicos',            cur_srv,
      'faturamento',         ROUND(cur_fat,2),
      'faturamentoServicos', ROUND(cur_fat_serv,2),
      'faturamentoVendas',   ROUND(cur_fat_vend,2),
      'ticketMedio',         ROUND(cur_tkt,2),
      'delta', jsonb_build_object(
        'agendamentos', CASE WHEN prev_ag  > 0 THEN (cur_ag::numeric  - prev_ag)  / prev_ag  ELSE NULL END,
        'servicos',     CASE WHEN prev_srv > 0 THEN (cur_srv::numeric - prev_srv) / prev_srv ELSE NULL END,
        'faturamento',  CASE WHEN prev_fat > 0 THEN (cur_fat          - prev_fat) / prev_fat ELSE NULL END,
        'ticketMedio',  CASE WHEN prev_tkt > 0 THEN (cur_tkt          - prev_tkt) / prev_tkt ELSE NULL END
      )
    ),
    'anterior', jsonb_build_object(
      'agendamentos',        prev_ag,
      'servicos',            prev_srv,
      'faturamento',         ROUND(prev_fat,2),
      'faturamentoServicos', ROUND(prev_fat_serv,2),
      'faturamentoVendas',   ROUND(prev_fat_vend,2),
      'ticketMedio',         ROUND(prev_tkt,2)
    ),
    'valor_pendente_total',   COALESCE(j_pagamentos->'pendente', '0'::jsonb),
    'pendencias_financeiras', COALESCE(j_pagamentos->'pendencias', '[]'::jsonb),
    'pagamentos',        j_pagamentos,
    'profissionaisTable', j_profissionais,
    'topServicos',       j_servicos,
    'pacotes',           j_pacotes,
    'topClientes',       j_clientes,
    'cancelamentos',     j_cancel,
    'produtos',          j_produtos
  );
END;
$$;


ALTER FUNCTION "public"."dashboard_v2_snapshot_base"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dashboard_v2_snapshot_base"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") IS 'Dashboard V2 · Snapshot completo (v7): agendamentos + domínio de Vendas (Venda de Balcão). Vendas somam faturamento, analytics de produtos e "Produtos Vendidos" por profissional; não afetam atendimentos, serviços, ticket médio, comissão nem caixinha.';



CREATE OR REPLACE FUNCTION "public"."enforce_max_usuarios_ativos"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer;
  v_max   constant integer := 3;
BEGIN
  -- Só valida quando o registro resultante for ATIVO
  IF NEW.ativo IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  -- No UPDATE, se já estava ativo, não há mudança de contagem
  IF TG_OP = 'UPDATE' AND OLD.ativo = TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.usuarios
  WHERE tenant_id = NEW.tenant_id
    AND ativo = TRUE
    AND id <> NEW.id;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Limite de usuários ativos atingido (%). Inative um usuário antes de ativar outro.', v_max
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_max_usuarios_ativos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."excluir_agendamento_com_historico"("_agendamento_id" "uuid", "_status" "public"."agendamento_status" DEFAULT 'cancelado'::"public"."agendamento_status") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    _agendamento RECORD;
    _historico_id uuid;
    _profissional_nome text;
BEGIN
    -- Buscar agendamento
    SELECT * INTO _agendamento
    FROM public.agendamentos
    WHERE id = _agendamento_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento % não encontrado', _agendamento_id;
    END IF;

    -- Buscar nome do profissional
    SELECT nome INTO _profissional_nome
    FROM public.profissionais
    WHERE id = _agendamento.profissional_id;

    -- Inserir no histórico
    INSERT INTO public.historico_atendimentos (
        agendamento_id, cliente_id, cliente_nome, cliente_telefone,
        profissional_id, profissional_nome, status, data, hora, observacoes
    )
    VALUES (
        _agendamento.id, _agendamento.cliente_id, _agendamento.cliente_nome,
        _agendamento.cliente_telefone, _agendamento.profissional_id,
        COALESCE(_profissional_nome, 'Desconhecido'), _status,
        _agendamento.data, _agendamento.hora, _agendamento.observacoes
    )
    RETURNING id INTO _historico_id;

    -- Copiar serviços para histórico
    INSERT INTO public.historico_servicos (
        historico_atendimento_id, servico_nome, preco, duracao, cor_nome, cor_hex
    )
    SELECT
        _historico_id,
        s.nome,
        ags.preco,
        ags.duracao,
        c.nome,
        c.hex
    FROM public.agendamento_servicos ags
    JOIN public.servicos s ON s.id = ags.servico_id
    LEFT JOIN public.cores c ON c.id = ags.cor_id
    WHERE ags.agendamento_id = _agendamento_id;

    -- Deletar agendamento (cascade deleta agendamento_servicos)
    DELETE FROM public.agendamentos WHERE id = _agendamento_id;

    RETURN _historico_id;
END;
$$;


ALTER FUNCTION "public"."excluir_agendamento_com_historico"("_agendamento_id" "uuid", "_status" "public"."agendamento_status") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."excluir_agendamento_com_historico"("_agendamento_id" "uuid", "_status" "public"."agendamento_status") IS 'Exclui agendamento e salva snapshot completo no histórico (operação atômica)';



CREATE OR REPLACE FUNCTION "public"."fill_agendamento_concluded_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.status::text IN ('concluido', 'concluído', 'completed')
     AND NEW.concluded_at IS NULL THEN
    NEW.concluded_at := now();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fill_agendamento_concluded_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_agendamento_auto_end_at"("p_agendamento_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$
  SELECT ((a.data::timestamp + a.hora)
          + make_interval(mins => public.fn_agendamento_duracao_total_min(a.id) + 30)
         ) AT TIME ZONE 'America/Sao_Paulo'
  FROM public.agendamentos a
  WHERE a.id = p_agendamento_id;
$$;


ALTER FUNCTION "public"."fn_agendamento_auto_end_at"("p_agendamento_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_agendamento_auto_end_at"("p_agendamento_id" "uuid") IS 'Instante de auto-conclusão visual: data+hora+duração+30min (BRT).';



CREATE OR REPLACE FUNCTION "public"."fn_agendamento_duracao_total_min"("p_agendamento_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."fn_agendamento_duracao_total_min"("p_agendamento_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_agendamento_duracao_total_min"("p_agendamento_id" "uuid") IS 'Replica getAppointmentTotalDuration() do frontend. Fallback 30min.';



CREATE OR REPLACE FUNCTION "public"."fn_marcar_origem_externo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Se vier sem usuário autenticado → é link externo
  IF auth.uid() IS NULL THEN
    NEW.origem := 'externo';
  ELSE
    -- Respeita o que o frontend interno enviar (default 'manual')
    NEW.origem := COALESCE(NEW.origem, 'manual');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_marcar_origem_externo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_purge_expired_whatsapp_sessions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.whatsapp_sessions
   WHERE expires_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."fn_purge_expired_whatsapp_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_push_externo_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_url   text := current_setting('app.edge_url', true);
  v_token text := current_setting('app.edge_service_role', true);
BEGIN
  IF COALESCE(NEW.origem,'manual') <> 'externo' THEN
    RETURN NEW;
  END IF;
  IF v_url IS NULL OR v_url = '' THEN
    RETURN NEW; -- não configurado: silencia
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer '||COALESCE(v_token,'')
               ),
    body    := jsonb_build_object(
                 'agendamento_id', NEW.id,
                 'tenant_id',      NEW.tenant_id,
                 'profissional_id',NEW.profissional_id
               )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- nunca bloquear o insert
  RAISE WARNING 'push externo falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_push_externo_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_reconcile_auto_concluded_at"("p_limit" integer DEFAULT 5000) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."fn_reconcile_auto_concluded_at"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_reconcile_auto_concluded_at"("p_limit" integer) IS 'Popula concluded_at de agendamentos auto-concluídos visualmente. Não toca status.';



CREATE OR REPLACE FUNCTION "public"."fn_rodizio_externo_before_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prof uuid;
BEGIN
  -- ⚠️ ISOLAMENTO: só age em externo SEM profissional
  IF COALESCE(NEW.origem,'manual') <> 'externo' THEN
    RETURN NEW;
  END IF;
  IF NEW.profissional_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Pega o próximo profissional ativo do tenant (round-robin),
  -- com FOR UPDATE SKIP LOCKED para evitar duplicidade em concorrência.
  SELECT pq.profissional_id
    INTO v_prof
  FROM public.professional_queue pq
  WHERE pq.tenant_id = NEW.tenant_id
    AND pq.ativo = true
  ORDER BY pq.last_assigned_at ASC, pq.profissional_id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_prof IS NULL THEN
    -- Não há profissional disponível: deixa NULL (frontend cliente já valida)
    RETURN NEW;
  END IF;

  NEW.profissional_id := v_prof;

  UPDATE public.professional_queue
     SET last_assigned_at = now()
   WHERE tenant_id = NEW.tenant_id
     AND profissional_id = v_prof;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_rodizio_externo_before_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_comissoes_dashboard"("p_inicio" "date", "p_fim" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_prof_id        uuid;
  v_tenant_id      uuid;
  v_pct_prof       numeric := 50;
  v_atendimentos   int := 0;
  v_servicos       int := 0;
  v_faturamento    numeric := 0;
  v_comissao       numeric := 0;
  v_caixinha       numeric := 0;
  v_total_receber  numeric := 0;
  v_agenda         jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Usuário logado precisa estar vinculado a um profissional e tenant.
  SELECT u.profissional_id, u.tenant_id
    INTO v_prof_id, v_tenant_id
    FROM public.usuarios u
   WHERE u.id = v_user_id
     AND COALESCE(u.ativo, true) = true
   LIMIT 1;

  IF v_prof_id IS NULL OR v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'atendimentos', 0,
      'servicos', 0,
      'total_faturamento', 0,
      'total_comissao', 0,
      'total_caixinha', 0,
      'total_receber', 0,
      'percentual', 0,
      'agenda', '[]'::jsonb
    );
  END IF;

  -- Segurança: somente colaborador acessa o próprio painel.
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = v_user_id
       AND ur.tenant_id = v_tenant_id
       AND ur.role::text = 'colaborador'
  ) THEN
    RETURN jsonb_build_object(
      'atendimentos', 0,
      'servicos', 0,
      'total_faturamento', 0,
      'total_comissao', 0,
      'total_caixinha', 0,
      'total_receber', 0,
      'percentual', 0,
      'agenda', '[]'::jsonb
    );
  END IF;

  -- Percentual configurado; fallback 50%, igual ao frontend.
  SELECT COALESCE(cp.percentual_profissional, 50)
    INTO v_pct_prof
    FROM public.comissoes_profissionais cp
   WHERE cp.tenant_id = v_tenant_id
     AND cp.profissional_id = v_prof_id
   LIMIT 1;

  v_pct_prof := COALESCE(v_pct_prof, 50);

  -- ===================================================================
  -- Base única de cálculo.
  -- IMPORTANTE: status/conclusion_type são convertidos com ::text antes
  -- do COALESCE para não quebrar quando a coluna for ENUM.
  -- ===================================================================
  WITH ag_base AS (
    SELECT
      a.*,
      COALESCE((
        SELECT SUM(COALESCE(NULLIF(as2.duracao, 0), 30))
          FROM public.agendamento_servicos as2
         WHERE as2.agendamento_id = a.id
           AND COALESCE(as2.origem::text, '') <> 'pacote_venda'
      ), 30) AS dur_total,
      lower(trim(COALESCE(a.status::text, ''))) AS status_txt,
      lower(trim(COALESCE(a.conclusion_type::text, ''))) AS conclusion_type_txt
    FROM public.agendamentos a
    WHERE a.tenant_id = v_tenant_id
      AND a.data BETWEEN p_inicio AND p_fim
  ),
  ag_validos AS (
    SELECT *
      FROM ag_base
     WHERE status_txt NOT IN ('excluido','excluído','cancelado','desmarcado')
       AND conclusion_type_txt <> 'cancelado_com_venda'
  ),
  ag_concluidos AS (
    SELECT *
      FROM ag_validos
     WHERE status_txt IN ('concluido','concluído')
        OR (
             (data::timestamp
              + COALESCE(hora::time, '00:00'::time)
              + make_interval(mins => (COALESCE(dur_total, 30) + 30)::int)
             ) < now()
           )
  ),
  linhas_prof AS (
    SELECT
      ag.id AS agendamento_id,
      ag.data,
      ag.hora,
      ag.cliente_nome,
      ag.profissional_id AS ag_prof_id,
      asv.id AS linha_id,
      asv.created_at,
      asv.servico_id,
      COALESCE(asv.profissional_id, ag.profissional_id) AS linha_prof_id,
      COALESCE(asv.origem::text, CASE WHEN asv.cliente_pacote_id IS NOT NULL THEN 'pacote_uso' ELSE 'avulso' END) AS origem_txt,
      asv.cliente_pacote_id,
      COALESCE(s.nome, '') AS servico_nome,
      COALESCE(asv.preco, 0) AS preco_bruto,
      CASE
        WHEN COALESCE(asv.origem::text, '') = 'pacote_venda'
          THEN COALESCE(asv.preco, 0)
        WHEN COALESCE(asv.origem::text, '') = 'pacote_uso' OR asv.cliente_pacote_id IS NOT NULL
          THEN 0
        ELSE COALESCE(asv.preco, 0)
      END AS preco_efetivo,
      CASE
        WHEN COALESCE(asv.origem::text, '') = 'pacote_venda' THEN false
        ELSE true
      END AS conta_servico
    FROM ag_concluidos ag
    JOIN public.agendamento_servicos asv
      ON asv.agendamento_id = ag.id
    LEFT JOIN public.servicos s
      ON s.id = asv.servico_id
    WHERE COALESCE(asv.profissional_id, ag.profissional_id) = v_prof_id
  ),
  resumo AS (
    SELECT
      COUNT(DISTINCT agendamento_id) FILTER (WHERE conta_servico OR origem_txt = 'pacote_venda') AS atendimentos,
      COUNT(*) FILTER (WHERE conta_servico) AS servicos,
      COALESCE(SUM(preco_efetivo), 0) AS faturamento
    FROM linhas_prof
  )
  SELECT
    COALESCE(r.atendimentos, 0),
    COALESCE(r.servicos, 0),
    COALESCE(r.faturamento, 0)
  INTO v_atendimentos, v_servicos, v_faturamento
  FROM resumo r;

  v_comissao := ROUND((COALESCE(v_faturamento, 0) * COALESCE(v_pct_prof, 0) / 100.0)::numeric, 2);

  -- ===================================================================
  -- Caixinha: mesma abordagem do Dashboard atual em pagamentos.js:
  -- soma observações CAIXINHA:X.XX dos agendamentos válidos/concluídos e
  -- atribui ao profissional principal do agendamento.
  -- ===================================================================
  WITH ag_base AS (
    SELECT
      a.id,
      a.profissional_id,
      a.data,
      a.hora,
      COALESCE((
        SELECT SUM(COALESCE(NULLIF(as2.duracao, 0), 30))
          FROM public.agendamento_servicos as2
         WHERE as2.agendamento_id = a.id
           AND COALESCE(as2.origem::text, '') <> 'pacote_venda'
      ), 30) AS dur_total,
      lower(trim(COALESCE(a.status::text, ''))) AS status_txt,
      lower(trim(COALESCE(a.conclusion_type::text, ''))) AS conclusion_type_txt
    FROM public.agendamentos a
    WHERE a.tenant_id = v_tenant_id
      AND a.data BETWEEN p_inicio AND p_fim
      AND a.profissional_id = v_prof_id
  ),
  ag_concluidos AS (
    SELECT *
      FROM ag_base
     WHERE status_txt NOT IN ('excluido','excluído','cancelado','desmarcado')
       AND conclusion_type_txt <> 'cancelado_com_venda'
       AND (
            status_txt IN ('concluido','concluído')
            OR (
                 (data::timestamp
                  + COALESCE(hora::time, '00:00'::time)
                  + make_interval(mins => (COALESCE(dur_total, 30) + 30)::int)
                 ) < now()
               )
           )
  )
  SELECT COALESCE(SUM(
           (regexp_match(p.observacao, 'CAIXINHA:([0-9]+(?:\.[0-9]+)?)', 'i'))[1]::numeric
         ), 0)
    INTO v_caixinha
    FROM public.agendamento_pagamentos p
    JOIN ag_concluidos ag ON ag.id = p.agendamento_id
   WHERE p.tenant_id = v_tenant_id
     AND p.observacao ~* 'CAIXINHA:[0-9]';

  v_caixinha := ROUND(COALESCE(v_caixinha, 0)::numeric, 2);
  v_total_receber := ROUND((v_comissao + v_caixinha)::numeric, 2);

  -- ===================================================================
  -- Agenda detalhada para o painel:
  --   - mostra serviços executados;
  --   - mostra venda de pacote como linha financeira quando existir;
  --   - caixinha fica na primeira linha do agendamento do profissional
  --     principal, só para visualização.
  -- ===================================================================
  WITH ag_base AS (
    SELECT
      a.*,
      COALESCE((
        SELECT SUM(COALESCE(NULLIF(as2.duracao, 0), 30))
          FROM public.agendamento_servicos as2
         WHERE as2.agendamento_id = a.id
           AND COALESCE(as2.origem::text, '') <> 'pacote_venda'
      ), 30) AS dur_total,
      lower(trim(COALESCE(a.status::text, ''))) AS status_txt,
      lower(trim(COALESCE(a.conclusion_type::text, ''))) AS conclusion_type_txt
    FROM public.agendamentos a
    WHERE a.tenant_id = v_tenant_id
      AND a.data BETWEEN p_inicio AND p_fim
  ),
  ag_concluidos AS (
    SELECT *
      FROM ag_base
     WHERE status_txt NOT IN ('excluido','excluído','cancelado','desmarcado')
       AND conclusion_type_txt <> 'cancelado_com_venda'
       AND (
            status_txt IN ('concluido','concluído')
            OR (
                 (data::timestamp
                  + COALESCE(hora::time, '00:00'::time)
                  + make_interval(mins => (COALESCE(dur_total, 30) + 30)::int)
                 ) < now()
               )
           )
  ),
  linhas_prof AS (
    SELECT
      ag.id AS agendamento_id,
      ag.data,
      ag.hora,
      ag.cliente_nome,
      ag.profissional_id AS ag_prof_id,
      asv.id AS linha_id,
      asv.created_at,
      COALESCE(asv.profissional_id, ag.profissional_id) AS linha_prof_id,
      COALESCE(asv.origem::text, CASE WHEN asv.cliente_pacote_id IS NOT NULL THEN 'pacote_uso' ELSE 'avulso' END) AS origem_txt,
      asv.cliente_pacote_id,
      COALESCE(s.nome, CASE WHEN COALESCE(asv.origem::text, '') = 'pacote_venda' THEN 'Venda de pacote' ELSE 'Atendimento' END) AS servico_nome,
      CASE
        WHEN COALESCE(asv.origem::text, '') = 'pacote_venda'
          THEN COALESCE(asv.preco, 0)
        WHEN COALESCE(asv.origem::text, '') = 'pacote_uso' OR asv.cliente_pacote_id IS NOT NULL
          THEN 0
        ELSE COALESCE(asv.preco, 0)
      END AS preco_efetivo,
      CASE WHEN COALESCE(asv.origem::text, '') = 'pacote_venda' THEN false ELSE true END AS conta_servico,
      ROW_NUMBER() OVER (PARTITION BY ag.id ORDER BY asv.created_at, asv.id) AS rn
    FROM ag_concluidos ag
    JOIN public.agendamento_servicos asv
      ON asv.agendamento_id = ag.id
    LEFT JOIN public.servicos s
      ON s.id = asv.servico_id
    WHERE COALESCE(asv.profissional_id, ag.profissional_id) = v_prof_id
  ),
  caixinha_por_ag AS (
    SELECT p.agendamento_id,
           SUM((regexp_match(p.observacao, 'CAIXINHA:([0-9]+(?:\.[0-9]+)?)', 'i'))[1]::numeric) AS cx
      FROM public.agendamento_pagamentos p
     WHERE p.tenant_id = v_tenant_id
       AND p.observacao ~* 'CAIXINHA:[0-9]'
     GROUP BY p.agendamento_id
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'agendamento_id', sp.agendamento_id,
             'hora',           to_char(sp.hora::time, 'HH24:MI'),
             'cliente_nome',   sp.cliente_nome,
             'servico_nome',   CASE
                                 WHEN sp.origem_txt = 'pacote_venda' THEN 'Venda de pacote'
                                 ELSE sp.servico_nome
                               END,
             'origem',         sp.origem_txt,
             'valor_servico',  ROUND(sp.preco_efetivo::numeric, 2),
             'comissao_valor', ROUND((sp.preco_efetivo * v_pct_prof / 100.0)::numeric, 2),
             'caixinha',       CASE
                                 WHEN sp.rn = 1 AND sp.ag_prof_id = v_prof_id
                                   THEN ROUND(COALESCE(cx.cx, 0)::numeric, 2)
                                 ELSE 0
                               END
           )
           ORDER BY sp.data, sp.hora, sp.created_at, sp.linha_id
         ), '[]'::jsonb)
    INTO v_agenda
    FROM linhas_prof sp
    LEFT JOIN caixinha_por_ag cx ON cx.agendamento_id = sp.agendamento_id;

  RETURN jsonb_build_object(
    'atendimentos',      COALESCE(v_atendimentos, 0),
    'servicos',          COALESCE(v_servicos, 0),
    'total_faturamento', ROUND(COALESCE(v_faturamento, 0)::numeric, 2),
    'total_comissao',    ROUND(COALESCE(v_comissao, 0)::numeric, 2),
    'total_caixinha',    ROUND(COALESCE(v_caixinha, 0)::numeric, 2),
    'total_receber',     ROUND(COALESCE(v_total_receber, 0)::numeric, 2),
    'percentual',        COALESCE(v_pct_prof, 50),
    'agenda',            COALESCE(v_agenda, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."get_comissoes_dashboard"("p_inicio" "date", "p_fim" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT tenant_id FROM public.usuarios WHERE id = auth.uid() LIMIT 1
$$;


ALTER FUNCTION "public"."get_current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_agenda_bloqueios"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) RETURNS TABLE("profissional_id" "uuid", "hora_inicio" time without time zone, "hora_fim" time without time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT b.profissional_id, b.hora_inicio, b.hora_fim
  FROM public.agenda_bloqueios b
  WHERE b.tenant_id = _tenant_id
    AND b.data = _data
    AND b.profissional_id = ANY(_profissional_ids);
$$;


ALTER FUNCTION "public"."get_public_agenda_bloqueios"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agenda_themes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "gold" "text" DEFAULT '#c8a45a'::"text" NOT NULL,
    "gold_light" "text" DEFAULT '#e2c87d'::"text" NOT NULL,
    "gold_dark" "text" DEFAULT '#a88a3a'::"text" NOT NULL,
    "gold_bg" "text" DEFAULT 'rgba(200,164,90,0.12)'::"text" NOT NULL,
    "gold_border" "text" DEFAULT 'rgba(200,164,90,0.25)'::"text" NOT NULL,
    "bg" "text" DEFAULT '#0a0a0a'::"text" NOT NULL,
    "card" "text" DEFAULT '#141414'::"text" NOT NULL,
    "card_hover" "text" DEFAULT '#1a1a1a'::"text" NOT NULL,
    "sidebar_bg" "text" DEFAULT '#111111'::"text" NOT NULL,
    "font" "text" DEFAULT 'Inter'::"text" NOT NULL,
    "logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "text_color" "text" DEFAULT '#ffffff'::"text" NOT NULL,
    "cal_border" "text" DEFAULT '#333333'::"text" NOT NULL,
    "cal_text" "text" DEFAULT '#888888'::"text" NOT NULL,
    "cal_month" "text" DEFAULT '#ffffff'::"text" NOT NULL,
    "cal_selected_bg" "text" DEFAULT '#c8a45a'::"text" NOT NULL,
    "cal_selected_text" "text" DEFAULT '#000000'::"text" NOT NULL,
    "page_title_color" "text" DEFAULT '#1A1A2E'::"text" NOT NULL,
    "appt_border_color" "text" DEFAULT '#6C3AED'::"text" NOT NULL,
    "appt_time_color" "text" DEFAULT '#6C3AED'::"text" NOT NULL,
    "appt_client_color" "text" DEFAULT '#1A1A2E'::"text" NOT NULL,
    "appt_service_color" "text" DEFAULT '#6B7280'::"text" NOT NULL,
    "appt_bg_color" "text" DEFAULT 'rgba(108,58,237,0.08)'::"text" NOT NULL,
    "modal_bg" "text",
    "input_bg" "text",
    "text_muted_color" "text",
    "booking_theme" "jsonb" DEFAULT "jsonb_build_object"('page_bg', '#F8F8F6', 'text', '#1A1A2E', 'title', '#1A1A2E', 'subtitle', '#6B7280', 'border', '#E5E7EB', 'btn_primary_bg', '#6C3AED', 'btn_primary_text', '#FFFFFF', 'btn_primary_hover', '#5B21B6', 'btn_secondary_bg', '#FFFFFF', 'btn_secondary_text', '#1A1A2E', 'step_active', '#6C3AED', 'step_done', '#16A34A', 'step_inactive', '#E5E7EB', 'step_text', '#1A1A2E', 'card_bg', '#FFFFFF', 'card_hover', '#F0F0EE', 'card_title', '#1A1A2E', 'card_desc', '#6B7280', 'card_price', '#6C3AED', 'card_border', '#E5E7EB', 'input_bg', '#F9FAFB', 'input_text', '#1A1A2E', 'input_placeholder', '#9CA3AF', 'input_border', '#E5E7EB', 'input_focus', '#6C3AED', 'cal_bg', '#FFFFFF', 'cal_day', '#1A1A2E', 'cal_day_sel_bg', '#6C3AED', 'cal_day_sel_text', '#FFFFFF', 'cal_slot', '#1A1A2E', 'cal_slot_sel', '#6C3AED', 'modal_bg', '#FFFFFF', 'modal_text', '#1A1A2E', 'modal_highlight', '#6C3AED', 'success_icon', '#16A34A', 'success_text', '#1A1A2E', 'success_btn', '#6C3AED') NOT NULL,
    "gold_contrast" "text" DEFAULT '#FFFFFF'::"text"
);


ALTER TABLE "public"."agenda_themes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."agenda_themes"."booking_theme" IS 'Tema completo do link público de agendamento (fluxo cliente). Sobrescreve cores derivadas.';



CREATE OR REPLACE FUNCTION "public"."get_public_agenda_theme"("_tenant_id" "uuid") RETURNS SETOF "public"."agenda_themes"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT *
  FROM public.agenda_themes
  WHERE tenant_id = _tenant_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_public_agenda_theme"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_booking_professionals"("_tenant_id" "uuid", "_servico_id" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "foto_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select distinct
    p.id,
    p.nome,
    coalesce(p.foto_url, '') as foto_url
  from public.profissionais p
  inner join public.profissional_servicos ps
    on ps.profissional_id = p.id
   and ps.tenant_id = _tenant_id
   and ps.servico_id = _servico_id
  where p.tenant_id = _tenant_id
    and coalesce(p.ativo, true) = true
  order by p.nome asc
$$;


ALTER FUNCTION "public"."get_public_booking_professionals"("_tenant_id" "uuid", "_servico_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_booking_services"("_tenant_id" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "descricao" "text", "preco" numeric, "duracao" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    s.id,
    s.nome,
    ''::text as descricao,
    s.preco,
    coalesce(s.duracao, 30) as duracao
  from public.servicos s
  where s.tenant_id = _tenant_id
    and coalesce(s.ativo, true) = true
  order by s.nome asc
$$;


ALTER FUNCTION "public"."get_public_booking_services"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_booking_tenant"("_tenant_id" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "nome_fantasia" "text", "logo_url" "text", "cover_url" "text", "logradouro" "text", "numero" "text", "complemento" "text", "cep" "text", "bairro" "text", "cidade" "text", "estado" "text", "endereco" "text", "permitir_agendamento_cliente" boolean, "horario_inicio" time without time zone, "horario_fim" time without time zone, "slot_minutos" integer, "appointment_interval_minutes" integer, "horarios_semanais" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    t.id,
    t.nome,
    t.nome_fantasia,
    t.logo_url,
    NULL::text                              AS cover_url,
    t.logradouro,
    t.numero,
    t.complemento,
    t.cep,
    t.bairro,
    t.cidade,
    t.estado,
    NULL::text                              AS endereco,
    COALESCE(s.permitir_agendamento_cliente, false),
    COALESCE(s.horario_inicio, '09:00'::time),
    COALESCE(s.horario_fim,    '19:00'::time),
    COALESCE(s.slot_minutos, 15),
    COALESCE(s.appointment_interval_minutes, s.slot_minutos, 15),
    s.horarios_semanais
  FROM public.tenants t
  LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
  WHERE t.id = _tenant_id;
$$;


ALTER FUNCTION "public"."get_public_booking_tenant"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_busy_slots"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) RETURNS TABLE("profissional_id" "uuid", "hora" "text", "duracao_total" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    a.profissional_id,
    to_char(a.hora, 'HH24:MI') as hora,
    coalesce(sum(ags.duracao), 30)::integer as duracao_total
  from public.agendamentos a
  left join public.agendamento_servicos ags on ags.agendamento_id = a.id
  where a.tenant_id = _tenant_id
    and a.data = _data
    and a.profissional_id = any(_profissional_ids)
    and a.status::text <> 'cancelado'
  group by a.id, a.profissional_id, a.hora
$$;


ALTER FUNCTION "public"."get_public_busy_slots"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_client_agendamentos"("_tenant_id" "uuid", "_cliente_id" "uuid") RETURNS TABLE("id" "uuid", "data" "date", "hora" time without time zone, "servico_id" "uuid", "servico_nome" "text", "profissional_id" "uuid", "profissional_nome" "text", "duracao" integer, "status" "text", "origem" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH agora_br AS (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::timestamp AS ts
  )
  SELECT
    a.id,
    a.data,
    a.hora,
    -- Primeiro serviço da lista (o "principal"). Extras ficam nos servicos_extras.
    (SELECT s.id
       FROM public.agendamento_servicos asv
       JOIN public.servicos s ON s.id = asv.servico_id
      WHERE asv.agendamento_id = a.id
      ORDER BY asv.created_at ASC
      LIMIT 1) AS servico_id,
    (SELECT s.nome
       FROM public.agendamento_servicos asv
       JOIN public.servicos s ON s.id = asv.servico_id
      WHERE asv.agendamento_id = a.id
      ORDER BY asv.created_at ASC
      LIMIT 1) AS servico_nome,
    a.profissional_id,
    p.nome AS profissional_nome,
    -- Soma a duração total (principal + extras). Fallback para 30.
    COALESCE(
      (SELECT SUM(asv.duracao)::int
         FROM public.agendamento_servicos asv
        WHERE asv.agendamento_id = a.id),
      30
    ) AS duracao,
    a.status::text AS status,
    a.origem
  FROM public.agendamentos a
  LEFT JOIN public.profissionais p ON p.id = a.profissional_id
  CROSS JOIN agora_br
  WHERE a.tenant_id  = _tenant_id
    AND a.cliente_id = _cliente_id
    AND a.status::text NOT IN ('cancelado', 'excluido', 'excluído', 'desmarcado', 'nao_compareceu', 'concluido', 'concluído')
    -- Compara o timestamp do agendamento com o "agora" no fuso local Brasil
    AND ((a.data + a.hora)::timestamp) >= (SELECT ts FROM agora_br)
  ORDER BY a.data ASC, a.hora ASC;
$$;


ALTER FUNCTION "public"."get_public_client_agendamentos"("_tenant_id" "uuid", "_cliente_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_public_client_agendamentos"("_tenant_id" "uuid", "_cliente_id" "uuid") IS 'Fluxo público: retorna agendamentos futuros do cliente identificado no site externo. Compara sempre no fuso America/Sao_Paulo.';



CREATE OR REPLACE FUNCTION "public"."get_public_cliente_by_telefone"("_tenant_id" "uuid", "_telefone_digits" "text") RETURNS TABLE("id" "uuid", "nome" "text", "telefone" "text", "nascimento" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT c.id, c.nome, c.telefone, c.nascimento
  FROM public.clientes c
  WHERE c.tenant_id = _tenant_id
    AND regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = regexp_replace(coalesce(_telefone_digits, ''), '\D', '', 'g')
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_public_cliente_by_telefone"("_tenant_id" "uuid", "_telefone_digits" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_cliente_pacotes_ativos"("_tenant_id" "uuid", "_cliente_id" "uuid") RETURNS TABLE("id" "uuid", "pacote_id" "uuid", "quantidade_total" integer, "quantidade_restante" integer, "preco_unitario" numeric, "data_expiracao" "date", "status" "text", "pacotes" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    cp.id,
    cp.pacote_id,
    cp.quantidade_total,
    cp.quantidade_restante,
    cp.preco_unitario,
    cp.data_expiracao,
    cp.status,
    jsonb_build_object(
      'id', p.id,
      'nome', p.nome,
      'servico_id', p.servico_id,
      'ativo', p.ativo
    ) AS pacotes
  FROM public.cliente_pacotes cp
  JOIN public.pacotes p ON p.id = cp.pacote_id
  WHERE cp.tenant_id = _tenant_id
    AND cp.cliente_id = _cliente_id
    AND cp.status = 'ativo'
    AND cp.quantidade_restante > 0
    AND (cp.data_expiracao IS NULL OR cp.data_expiracao >= CURRENT_DATE)
    AND p.ativo = true
  ORDER BY cp.data_expiracao ASC NULLS LAST, cp.created_at ASC;
$$;


ALTER FUNCTION "public"."get_public_cliente_pacotes_ativos"("_tenant_id" "uuid", "_cliente_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_group_units"("_slug" "text") RETURNS TABLE("group_id" "uuid", "group_name" "text", "group_banner_url" "text", "tenant_id" "uuid", "nome" "text", "cidade" "text", "estado" "text", "logo_url" "text", "cover_image_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    g.id,
    g.name::text,
    g.banner_image_url::text,
    t.id,
    coalesce(t.nome_fantasia, t.nome)::text,
    t.cidade::text,
    t.estado::text,
    t.logo_url::text,
    (
      select ti.image_url::text
      from public.tenant_images ti
      where ti.tenant_id = t.id
      order by ti."order" asc nulls last, ti.id asc
      limit 1
    ) as cover_image_url
  from public.tenant_groups g
  join public.tenant_group_tenants tgt on tgt.group_id = g.id
  join public.tenants t                on t.id = tgt.tenant_id
  where g.active = true
    and lower(g.slug) = lower(_slug)
  order by coalesce(t.nome_fantasia, t.nome);
$$;


ALTER FUNCTION "public"."get_public_group_units"("_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_pacote_oferta"("_tenant_id" "uuid", "_servico_id" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "servico_id" "uuid", "quantidade_total" integer, "preco_unitario_final" numeric, "preco_total" numeric, "validade_dias" integer, "ativo" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p.id,
         p.nome,
         p.servico_id,
         p.quantidade_total,
         p.preco_unitario_final,
         p.preco_total,
         p.validade_dias,
         p.ativo
  FROM public.pacotes p
  WHERE p.tenant_id = _tenant_id
    AND p.servico_id = _servico_id
    AND p.ativo = true
    AND COALESCE(p.disponivel_agendamento_externo, true) = true
  ORDER BY p.created_at DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_public_pacote_oferta"("_tenant_id" "uuid", "_servico_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_service_recommendations"("_tenant_id" "uuid", "_servico_id" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "preco" numeric, "duracao" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT s.id, s.nome, s.preco, s.duracao
  FROM public.service_recommendations sr
  JOIN public.servicos s ON s.id = sr.recommended_service_id
  WHERE sr.tenant_id = _tenant_id
    AND sr.service_id = _servico_id
    AND s.ativo = true
  ORDER BY sr.prioridade ASC, s.nome ASC;
$$;


ALTER FUNCTION "public"."get_public_service_recommendations"("_tenant_id" "uuid", "_servico_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tenant_group"("_tenant_id" "uuid") RETURNS TABLE("group_id" "uuid", "group_name" "text", "slug" "text", "banner_image_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    g.id,
    g.name::text,
    g.slug::text,
    g.banner_image_url::text
  from public.tenant_groups g
  join public.tenant_group_tenants tgt on tgt.group_id = g.id
  where g.active = true
    and tgt.tenant_id = _tenant_id
  limit 1;
$$;


ALTER FUNCTION "public"."get_tenant_group"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tenant_settings"("p_tenant" "uuid") RETURNS TABLE("permitir_agendamento_cliente" boolean, "horario_inicio" time without time zone, "horario_fim" time without time zone, "horarios_semanais" "jsonb", "slot_minutos" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    coalesce(s.permitir_agendamento_cliente, false)        as permitir_agendamento_cliente,
    coalesce(s.horario_inicio, '07:00'::time)              as horario_inicio,
    coalesce(s.horario_fim,    '21:00'::time)              as horario_fim,
    s.horarios_semanais                                    as horarios_semanais,
    coalesce(s.slot_minutos, 15)                           as slot_minutos
  from public.tenant_settings s
  where s.tenant_id = p_tenant
  limit 1;
$$;


ALTER FUNCTION "public"."get_tenant_settings"("p_tenant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_accessible_tenants"("_user_id" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "nome_fantasia" "text", "logo_url" "text", "cidade" "text", "estado" "text", "display_id" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT t.id,
         t.nome,
         t.nome_fantasia,
         t.logo_url,
         t.cidade,
         t.estado,
         t.display_id
    FROM public.tenants t
   WHERE t.id IN (SELECT tenant_id FROM public.get_user_tenant_ids(_user_id))
   ORDER BY t.nome;
$$;


ALTER FUNCTION "public"."get_user_accessible_tenants"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"("_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role::text
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_user_role"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select u.tenant_id
  from public.usuarios u
  where u.id = auth.uid()
    and u.ativo = true
  limit 1
$$;


ALTER FUNCTION "public"."get_user_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tenant_id"("_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT tenant_id
  FROM public.usuarios
  WHERE id = _user_id
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_user_tenant_id"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tenant_ids"("_user_id" "uuid") RETURNS TABLE("tenant_id" "uuid")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_principal_tenant uuid;
  v_has_multi_access boolean;
BEGIN
  -- Tenant principal do usuário (cadastro)
  SELECT u.tenant_id
    INTO v_principal_tenant
  FROM public.usuarios u
  WHERE u.id = _user_id
  LIMIT 1;

  IF v_principal_tenant IS NULL THEN
    -- Fallback: tenta pelo user_roles, caso usuarios não esteja preenchido
    SELECT ur.tenant_id
      INTO v_principal_tenant
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
    ORDER BY ur.tenant_id
    LIMIT 1;
  END IF;

  IF v_principal_tenant IS NULL THEN
    RETURN; -- usuário sem tenant
  END IF;

  -- Permissão de múltiplas unidades?
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = _user_id
       AND ur.multi_unit_access = true
  ) INTO v_has_multi_access;

  IF NOT v_has_multi_access THEN
    -- Sem permissão -> retorna apenas o tenant principal
    RETURN QUERY SELECT v_principal_tenant;
    RETURN;
  END IF;

  -- Com permissão -> tenant principal + todos os tenants do(s) grupo(s)
  RETURN QUERY
    SELECT DISTINCT t_id FROM (
      SELECT v_principal_tenant AS t_id
      UNION
      SELECT tgt2.tenant_id
        FROM public.tenant_group_tenants tgt1
        JOIN public.tenant_group_tenants tgt2
          ON tgt2.group_id = tgt1.group_id
       WHERE tgt1.tenant_id = v_principal_tenant
    ) s;
END;
$$;


ALTER FUNCTION "public"."get_user_tenant_ids"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") IS 'Verifica role do usuário sem recursão RLS';



CREATE OR REPLACE FUNCTION "public"."has_role_in_tenant"("_user_id" "uuid", "_role" "text", "_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role::text = _role
      AND (ur.tenant_id = _tenant_id OR ur.role::text = 'master_admin')
  );
$$;


ALTER FUNCTION "public"."has_role_in_tenant"("_user_id" "uuid", "_role" "text", "_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT public.has_role(_user_id, 'admin')
$$;


ALTER FUNCTION "public"."is_admin"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_for_tenant"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'master_admin'
        OR (ur.role = 'admin' AND ur.tenant_id = _tenant_id)
      )
  )
$$;


ALTER FUNCTION "public"."is_admin_for_tenant"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_colaborador"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT public.has_role(_user_id, 'colaborador')
$$;


ALTER FUNCTION "public"."is_colaborador"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_current_user_colaborador_for_tenant"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text = 'colaborador'
      and (ur.tenant_id = _tenant_id or ur.tenant_id is null)
  )
  and not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text in ('admin', 'master_admin')
      and (ur.tenant_id = _tenant_id or ur.tenant_id is null)
  );
$$;


ALTER FUNCTION "public"."is_current_user_colaborador_for_tenant"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_master_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid()
      AND email = 'alesionb93@gmail.com'
  )
$$;


ALTER FUNCTION "public"."is_master_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_master_admin"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'master_admin'
  )
$$;


ALTER FUNCTION "public"."is_master_admin"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_report_admin"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('master_admin','admin')
  );
$$;


ALTER FUNCTION "public"."is_report_admin"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_tenant_admin"("_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (ur.tenant_id = _tenant_id OR ur.tenant_id IS NULL)
      AND ur.role::text IN (
        'admin',
        'administrador',
        'master',
        'master_admin',
        'super_admin',
        'owner',
        'dono'
      )
  );
$$;


ALTER FUNCTION "public"."is_tenant_admin"("_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."listar_clientes_inativos_para_campanha"("p_tenant_id" "uuid", "p_inactivity_days" integer DEFAULT 30, "p_cooldown_days" integer DEFAULT 30, "p_limit" integer DEFAULT 200) RETURNS TABLE("cliente_id" "uuid", "nome" "text", "telefone" "text", "ultima_visita" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH ult AS (
    -- Última conclusão por cliente (pega só clientes COM histórico)
    SELECT a.cliente_id, MAX(a.concluded_at) AS ultima
    FROM public.agendamentos a
    WHERE a.tenant_id = p_tenant_id
      AND a.concluded_at IS NOT NULL
    GROUP BY a.cliente_id
  ),
  ult_camp AS (
    -- Última campanha de reativação por cliente (cooldown)
    SELECT c.cliente_id, MAX(c.created_at) AS ultima
    FROM public.inactive_customer_campaigns c
    WHERE c.tenant_id = p_tenant_id
    GROUP BY c.cliente_id
  )
  SELECT
    cli.id              AS cliente_id,
    cli.nome,
    cli.telefone,
    ult.ultima          AS ultima_visita
  FROM ult
  JOIN public.clientes cli ON cli.id = ult.cliente_id
  LEFT JOIN ult_camp uc    ON uc.cliente_id = ult.cliente_id
  WHERE cli.tenant_id = p_tenant_id
    AND ult.ultima < (now() - make_interval(days => p_inactivity_days))
    AND (uc.ultima IS NULL OR uc.ultima < (now() - make_interval(days => p_cooldown_days)))
    AND cli.telefone IS NOT NULL
    AND length(regexp_replace(cli.telefone, '\D', '', 'g')) >= 10
  ORDER BY ult.ultima ASC   -- mais inativos primeiro
  LIMIT p_limit;
$$;


ALTER FUNCTION "public"."listar_clientes_inativos_para_campanha"("p_tenant_id" "uuid", "p_inactivity_days" integer, "p_cooldown_days" integer, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_agendamentos_dia"("p_tenant" "uuid", "p_data" "date", "p_profs" "uuid"[]) RETURNS TABLE("profissional_id" "uuid", "hora" time without time zone, "duracao_total" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT a.profissional_id, a.hora,
         COALESCE(SUM(asv.duracao), 30)::int AS duracao_total
  FROM public.agendamentos a
  LEFT JOIN public.agendamento_servicos asv ON asv.agendamento_id = a.id
  WHERE a.tenant_id = p_tenant
    AND a.data = p_data
    AND a.profissional_id = ANY(p_profs)
    AND a.status <> 'cancelado'
  GROUP BY a.id, a.profissional_id, a.hora;
$$;


ALTER FUNCTION "public"."public_agendamentos_dia"("p_tenant" "uuid", "p_data" "date", "p_profs" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_criar_agendamento"("p_tenant" "uuid", "p_cliente_nome" "text", "p_cliente_telefone" "text", "p_profissional" "uuid", "p_servico" "uuid", "p_data" "date", "p_hora" time without time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cliente uuid;
  v_agendamento uuid;
  v_servico record;
  v_flag boolean;
BEGIN
  -- Bloqueia se a flag estiver desligada
  SELECT permitir_agendamento_cliente INTO v_flag
  FROM public.tenant_settings WHERE tenant_id = p_tenant;
  IF NOT COALESCE(v_flag, false) THEN
    RAISE EXCEPTION 'Agendamento externo desativado para este estabelecimento';
  END IF;

  -- Carrega serviço (preço/duração)
  SELECT id, preco, duracao INTO v_servico
  FROM public.servicos WHERE id = p_servico AND tenant_id = p_tenant AND ativo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serviço inválido';
  END IF;

  -- Cria/recupera cliente pelo telefone
  SELECT id INTO v_cliente
  FROM public.clientes WHERE tenant_id = p_tenant AND telefone = p_cliente_telefone
  LIMIT 1;

  IF v_cliente IS NULL THEN
    INSERT INTO public.clientes (tenant_id, nome, telefone)
    VALUES (p_tenant, p_cliente_nome, p_cliente_telefone)
    RETURNING id INTO v_cliente;
  END IF;

  -- Cria o agendamento
  INSERT INTO public.agendamentos
    (tenant_id, cliente_id, cliente_nome, cliente_telefone,
     profissional_id, data, hora, status)
  VALUES
    (p_tenant, v_cliente, p_cliente_nome, p_cliente_telefone,
     p_profissional, p_data, p_hora, 'agendado')
  RETURNING id INTO v_agendamento;

  -- Vincula o serviço escolhido
  INSERT INTO public.agendamento_servicos
    (tenant_id, agendamento_id, servico_id, profissional_id, preco, duracao)
  VALUES
    (p_tenant, v_agendamento, p_servico, p_profissional, v_servico.preco, v_servico.duracao);

  RETURN v_agendamento;
END $$;


ALTER FUNCTION "public"."public_criar_agendamento"("p_tenant" "uuid", "p_cliente_nome" "text", "p_cliente_telefone" "text", "p_profissional" "uuid", "p_servico" "uuid", "p_data" "date", "p_hora" time without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_list_profissionais"("p_tenant" "uuid", "p_servico" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "foto_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT p.id, p.nome, p.foto_url
  FROM public.profissionais p
  JOIN public.profissional_servicos ps
    ON ps.profissional_id = p.id AND ps.servico_id = p_servico
  WHERE p.tenant_id = p_tenant
    AND p.ativo = true
    AND EXISTS (
      SELECT 1 FROM public.tenant_settings ts
      WHERE ts.tenant_id = p_tenant AND ts.permitir_agendamento_cliente = true
    )
  ORDER BY p.nome;
$$;


ALTER FUNCTION "public"."public_list_profissionais"("p_tenant" "uuid", "p_servico" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_list_servicos"("p_tenant" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "preco" numeric, "duracao" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT s.id, s.nome, s.preco, s.duracao
  FROM public.servicos s
  WHERE s.tenant_id = p_tenant
    AND s.ativo = true
    AND EXISTS (
      SELECT 1 FROM public.tenant_settings ts
      WHERE ts.tenant_id = p_tenant AND ts.permitir_agendamento_cliente = true
    )
  ORDER BY s.nome;
$$;


ALTER FUNCTION "public"."public_list_servicos"("p_tenant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalcular_status_pagamento_agendamento"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ag_id        uuid;
  v_total_pago   numeric;
  v_total_devido numeric;
  v_count        integer;
  v_status       text;
BEGIN
  v_ag_id := COALESCE(NEW.agendamento_id, OLD.agendamento_id);

  SELECT COALESCE(SUM(valor),0), COUNT(*)
    INTO v_total_pago, v_count
  FROM public.agendamento_pagamentos
  WHERE agendamento_id = v_ag_id;

  -- Total devido = soma de serviços (ag_servicos.preco) + produtos (qtd*preco_unitario)
  SELECT
    COALESCE((SELECT SUM(preco) FROM public.agendamento_servicos
              WHERE agendamento_id = v_ag_id), 0)
  + COALESCE((SELECT SUM(quantidade*preco_unitario) FROM public.agendamento_produtos
              WHERE agendamento_id = v_ag_id), 0)
    INTO v_total_devido;

  IF v_count = 0 OR v_total_pago = 0 THEN
    v_status := 'pendente';
  ELSIF v_total_pago + 0.01 < v_total_devido THEN
    v_status := 'parcial';
  ELSE
    v_status := 'pago';
  END IF;

  UPDATE public.agendamentos
     SET status_pagamento = v_status,
         valor_total_pago = v_total_pago,
         possui_pagamento = (v_count > 0),
         updated_at       = now()
   WHERE id = v_ag_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."recalcular_status_pagamento_agendamento"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_agendamento_financeiro"("p_agendamento_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_subtotal_servicos numeric(10,2) := 0;
  v_subtotal_produtos numeric(10,2) := 0;
  v_desconto_total    numeric(10,2) := 0;
  v_acrescimo_total   numeric(10,2) := 0;
  v_caixinha_total    numeric(10,2) := 0;
  v_base_comissao     numeric(10,2) := 0;
  v_total             numeric(10,2) := 0;
BEGIN
  IF p_agendamento_id IS NULL THEN
    RETURN;
  END IF;

  -- Serviços: apenas os que NÃO foram consumidos por crédito de pacote.
  SELECT COALESCE(SUM(preco), 0)
    INTO v_subtotal_servicos
    FROM public.agendamento_servicos
   WHERE agendamento_id = p_agendamento_id
     AND COALESCE(credito_consumido, false) = false;

  -- Produtos vendidos durante o atendimento (entram só em faturamento).
  SELECT COALESCE(SUM(preco_unitario * quantidade), 0)
    INTO v_subtotal_produtos
    FROM public.agendamento_produtos
   WHERE agendamento_id = p_agendamento_id;

  SELECT
    COALESCE(SUM(
      CASE WHEN desconto_valor > 0
           THEN desconto_valor
           ELSE public._fin_parse_marker(observacao, 'DESCONTO')
      END
    ), 0),
    COALESCE(SUM(
      CASE WHEN caixinha_valor > 0
           THEN caixinha_valor
           ELSE public._fin_parse_marker(observacao, 'CAIXINHA')
      END
    ), 0),
    COALESCE(SUM(
      CASE WHEN acrescimo_valor > 0
           THEN acrescimo_valor
           ELSE public._fin_parse_marker(observacao, 'ACRESCIMO')
      END
    ), 0)
  INTO v_desconto_total, v_caixinha_total, v_acrescimo_total
  FROM public.agendamento_pagamentos
  WHERE agendamento_id = p_agendamento_id;

  -- >>> CORREÇÃO <<<
  -- Base de comissão = SOMENTE SERVIÇOS (- desconto + acréscimo).
  -- Produtos e caixinha nunca entram.
  v_base_comissao := ROUND(
    v_subtotal_servicos - v_desconto_total + v_acrescimo_total
  , 2);

  -- Total (faturamento do atendimento) continua incluindo produtos.
  v_total := ROUND(
    v_subtotal_servicos + v_subtotal_produtos
    - v_desconto_total + v_acrescimo_total + v_caixinha_total
  , 2);

  UPDATE public.agendamentos
     SET subtotal_servicos = v_subtotal_servicos,
         subtotal_produtos = v_subtotal_produtos,
         desconto_total    = v_desconto_total,
         acrescimo_total   = v_acrescimo_total,
         caixinha_total    = v_caixinha_total,
         base_comissao     = GREATEST(v_base_comissao, 0),
         total             = GREATEST(v_total, 0),
         updated_at        = now()
   WHERE id = p_agendamento_id;
END;
$$;


ALTER FUNCTION "public"."recompute_agendamento_financeiro"("p_agendamento_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recompute_agendamento_financeiro"("p_agendamento_id" "uuid") IS 'Recalcula colunas financeiras do agendamento. base_comissao = SOMENTE serviços (- desconto + acréscimo). Produtos e caixinha nunca compõem comissão.';



CREATE OR REPLACE FUNCTION "public"."registrar_venda"("p_payload" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tenant     uuid := public.current_tenant_id();
  v_prof       uuid := nullif(p_payload->>'profissional_id','')::uuid;
  v_venda_id   uuid;
  v_subtotal   numeric(12,2) := 0;
  v_desconto   numeric(12,2) := round(coalesce((p_payload->>'desconto_valor')::numeric, 0), 2);
  v_caixinha   numeric(12,2) := round(coalesce((p_payload->>'caixinha_valor')::numeric, 0), 2);
  v_total      numeric(12,2) := 0;
  v_pago       numeric(12,2) := 0;
  v_item       jsonb;
  v_cliente_id uuid := nullif(p_payload->>'cliente_id','')::uuid;
begin
  if v_tenant is null then
    raise exception 'usuário sem tenant';
  end if;
  if v_prof is null then
    raise exception 'profissional_id obrigatório';
  end if;
  if not exists (select 1 from public.profissionais
                  where id = v_prof and tenant_id = v_tenant) then
    raise exception 'profissional inválido para este tenant';
  end if;
  if v_cliente_id is not null and not exists (
       select 1 from public.clientes where id = v_cliente_id and tenant_id = v_tenant) then
    raise exception 'cliente inválido para este tenant';
  end if;
  if jsonb_array_length(coalesce(p_payload->'itens','[]'::jsonb)) = 0 then
    raise exception 'venda sem itens';
  end if;
  if jsonb_array_length(coalesce(p_payload->'pagamentos','[]'::jsonb)) = 0 then
    raise exception 'venda sem pagamentos';
  end if;
  if v_desconto < 0 or v_caixinha < 0 then
    raise exception 'desconto e caixinha não podem ser negativos';
  end if;

  -- Totais SEMPRE calculados no servidor (o cliente não é fonte de verdade).
  for v_item in select * from jsonb_array_elements(p_payload->'itens') loop
    if coalesce((v_item->>'quantidade')::numeric, 0) <= 0 then
      raise exception 'item com quantidade inválida';
    end if;
    if nullif(v_item->>'produto_id','') is not null
       and not exists (select 1 from public.produtos
                        where id = (v_item->>'produto_id')::uuid
                          and tenant_id = v_tenant) then
      raise exception 'produto % não pertence a este tenant', v_item->>'produto_id';
    end if;
    v_subtotal := v_subtotal + round(
        coalesce((v_item->>'quantidade')::numeric,1)
      * coalesce((v_item->>'valor_unitario')::numeric,0)
      - coalesce((v_item->>'desconto_valor')::numeric,0), 2);
  end loop;

  v_total := round(v_subtotal - v_desconto, 2);
  if v_total < 0 then
    raise exception 'desconto maior que o subtotal da venda';
  end if;

  insert into public.vendas (
    tenant_id, profissional_id, cliente_id, cliente_nome, cliente_telefone,
    subtotal, desconto_valor, caixinha_valor, total, total_pago,
    status, observacoes
  ) values (
    v_tenant, v_prof, v_cliente_id,
    coalesce(nullif(p_payload->>'cliente_nome',''), 'Consumidor Final'),
    nullif(p_payload->>'cliente_telefone',''),
    v_subtotal, v_desconto, v_caixinha, v_total, 0,
    'concluida',
    nullif(p_payload->>'observacoes','')
  ) returning id into v_venda_id;

  -- Itens (snapshot imutável de descrição/valores)
  for v_item in select * from jsonb_array_elements(p_payload->'itens') loop
    insert into public.venda_itens (
      tenant_id, venda_id, produto_id, descricao,
      quantidade, valor_unitario, desconto_valor, total
    ) values (
      v_tenant, v_venda_id,
      nullif(v_item->>'produto_id','')::uuid,
      coalesce(nullif(v_item->>'descricao',''), 'Item'),
      coalesce((v_item->>'quantidade')::numeric, 1),
      coalesce((v_item->>'valor_unitario')::numeric, 0),
      coalesce((v_item->>'desconto_valor')::numeric, 0),
      round( coalesce((v_item->>'quantidade')::numeric,1)
           * coalesce((v_item->>'valor_unitario')::numeric,0)
           - coalesce((v_item->>'desconto_valor')::numeric,0), 2)
    );
  end loop;

  -- Pagamentos + validação da soma (reaproveita a RPC de substituição)
  v_pago := public.venda_substituir_pagamentos(v_venda_id, p_payload->'pagamentos');

  -- Baixa de estoque
  perform public._venda_mover_estoque(v_venda_id, 'saida'::estoque_mov_tipo);

  return v_venda_id;
end;
$$;


ALTER FUNCTION "public"."registrar_venda"("p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_custom_report"("_slug" "text", "_tenant_id" "uuid", "_filters" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_uid  uuid := auth.uid();
  v_data jsonb;
  v_cols jsonb;
  v_rows jsonb;
  v_prof uuid;
  v_ini  date;
  v_fim  date;
BEGIN
  -- Autorização
  IF v_uid IS NULL OR NOT public.is_report_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Garante que o admin pertence ao tenant solicitado (a menos que seja master_admin)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid
      AND (role = 'master_admin' OR tenant_id = _tenant_id)
  ) THEN
    RAISE EXCEPTION 'forbidden_tenant' USING ERRCODE = '42501';
  END IF;

  CASE _slug

    -- ============================================================
    -- Relatório: Comissão dos profissionais
    -- ============================================================
    WHEN 'commission-professionals' THEN
      v_prof := NULLIF(_filters->>'professional_id','')::uuid;
      v_ini  := NULLIF(_filters->>'date_start','')::date;
      v_fim  := NULLIF(_filters->>'date_end','')::date;

      v_cols := '[
        {"key":"data_agendamento","label":"Data Agendamento"},
        {"key":"data_conclusao","label":"Data Conclusão"},
        {"key":"nome_cliente","label":"Nome Cliente"},
        {"key":"nome_profissional","label":"Profissional"},
        {"key":"status_agendamento","label":"Status Agendamento"},
        {"key":"status_pagamento","label":"Status Pagamento"},
        {"key":"forma_pagamento","label":"Forma Pagamento"},
        {"key":"valor_pago","label":"Valor Pago (R$)"},
        {"key":"porcentagem_profissional","label":"% Profissional"},
        {"key":"valor_a_pagar","label":"Valor a Pagar (R$)"}
      ]'::jsonb;

      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        INTO v_rows
      FROM (
        SELECT
          TO_CHAR(a.data, 'DD/MM/YYYY') AS data_agendamento,
          TO_CHAR(a.concluded_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') AS data_conclusao,
          a.cliente_nome AS nome_cliente,
          p.nome         AS nome_profissional,
          a.status       AS status_agendamento,
          a.status_pagamento,
          ap.forma_pagamento,
          COALESCE(a.valor_total_pago, 0)::numeric(12,2) AS valor_pago,
          TO_CHAR(c.percentual_profissional, 'FM999990') || '%' AS porcentagem_profissional,
          ROUND(COALESCE(a.valor_total_pago,0) * (c.percentual_profissional / 100.0), 2) AS valor_a_pagar
        FROM public.agendamentos a
        JOIN public.profissionais p           ON p.id = a.profissional_id
        LEFT JOIN public.agendamento_pagamentos ap ON ap.agendamento_id = a.id
        JOIN public.comissoes_profissionais  c    ON c.profissional_id = a.profissional_id
                                                 AND c.tenant_id       = a.tenant_id
        WHERE a.tenant_id = _tenant_id
          AND (v_prof IS NULL OR a.profissional_id = v_prof)
          AND (v_ini  IS NULL OR a.data >= v_ini)
          AND (v_fim  IS NULL OR a.data <= v_fim)
        ORDER BY a.data DESC, a.hora DESC
      ) t;

      v_data := jsonb_build_object('columns', v_cols, 'rows', v_rows);

    ELSE
      RAISE EXCEPTION 'unknown_report_slug: %', _slug USING ERRCODE = '22023';
  END CASE;

  RETURN v_data;
END;
$_$;


ALTER FUNCTION "public"."run_custom_report"("_slug" "text", "_tenant_id" "uuid", "_filters" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_service_recommendations"("p_service_id" "uuid", "p_recommended_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tenant_id uuid;
  v_clean_ids uuid[];
  v_invalid_count integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select s.tenant_id
    into v_tenant_id
  from public.servicos s
  where s.id = p_service_id;

  if v_tenant_id is null then
    raise exception 'Serviço principal não encontrado.' using errcode = 'P0002';
  end if;

  if not public.can_manage_service_recommendations(v_tenant_id) then
    raise exception 'Você não tem permissão para salvar recomendações deste serviço.' using errcode = '42501';
  end if;

  v_clean_ids := coalesce(
    array(
      select distinct rec_id
      from unnest(coalesce(p_recommended_ids, '{}'::uuid[])) as rec_id
      where rec_id is not null
        and rec_id <> p_service_id
    ),
    '{}'::uuid[]
  );

  select count(*)
    into v_invalid_count
  from unnest(v_clean_ids) as rec_id
  left join public.servicos s
    on s.id = rec_id
   and s.tenant_id = v_tenant_id
  where s.id is null;

  if v_invalid_count > 0 then
    raise exception 'Há recomendações inválidas para este tenant.' using errcode = '23514';
  end if;

  delete from public.service_recommendations sr
  where sr.tenant_id = v_tenant_id
    and sr.service_id = p_service_id
    and not (sr.recommended_service_id = any(v_clean_ids));

  insert into public.service_recommendations (service_id, recommended_service_id, tenant_id)
  select p_service_id, rec_id, v_tenant_id
  from unnest(v_clean_ids) as rec_id
  where not exists (
    select 1
    from public.service_recommendations sr
    where sr.tenant_id = v_tenant_id
      and sr.service_id = p_service_id
      and sr.recommended_service_id = rec_id
  );

  return jsonb_build_object(
    'ok', true,
    'service_id', p_service_id,
    'tenant_id', v_tenant_id,
    'total', coalesce(array_length(v_clean_ids, 1), 0)
  );
end;
$$;


ALTER FUNCTION "public"."save_service_recommendations"("p_service_id" "uuid", "p_recommended_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_comissoes_profissionais_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_comissoes_profissionais_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_permitir_agendamento_cliente"("p_tenant" "uuid", "p_value" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.tenant_settings (tenant_id, permitir_agendamento_cliente)
  values (p_tenant, p_value)
  on conflict (tenant_id)
  do update set
    permitir_agendamento_cliente = excluded.permitir_agendamento_cliente,
    updated_at = now();
end;
$$;


ALTER FUNCTION "public"."set_permitir_agendamento_cliente"("p_tenant" "uuid", "p_value" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tenant_horario_comercial"("p_tenant" "uuid", "p_inicio" time without time zone, "p_fim" time without time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pode boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_fim <= p_inicio THEN
    RAISE EXCEPTION 'A hora de fechamento deve ser maior que a de abertura';
  END IF;

  -- Permissão: master_admin OU admin do tenant
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND (
        ur.role = 'master_admin'
        OR (ur.role = 'admin' AND ur.tenant_id = p_tenant)
      )
  ) INTO v_pode;

  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para alterar horário comercial deste tenant'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tenant_settings (tenant_id, horario_inicio, horario_fim)
  VALUES (p_tenant, p_inicio, p_fim)
  ON CONFLICT (tenant_id) DO UPDATE
    SET horario_inicio = EXCLUDED.horario_inicio,
        horario_fim    = EXCLUDED.horario_fim,
        updated_at     = now();
END;
$$;


ALTER FUNCTION "public"."set_tenant_horario_comercial"("p_tenant" "uuid", "p_inicio" time without time zone, "p_fim" time without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tenant_horario_semanal"("p_tenant" "uuid", "p_horarios" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_min text;
  v_max text;
begin
  -- Valida permissão: apenas admin do tenant ou master_admin
  if not (
    exists (select 1 from public.user_roles ur
             where ur.user_id = auth.uid()
               and ur.role    = 'master_admin')
    or exists (select 1 from public.user_roles ur
                where ur.user_id = auth.uid()
                  and ur.tenant_id = p_tenant
                  and ur.role = 'admin')
  ) then
    raise exception 'Sem permissão para alterar configurações deste tenant.'
      using errcode = '42501';
  end if;

  -- Calcula envelope min(inicio) e max(fim) entre dias ativos para
  -- manter colunas legadas sincronizadas (links externos antigos).
  select min((d.value->>'inicio')),
         max((d.value->>'fim'))
    into v_min, v_max
    from jsonb_each(p_horarios) as d
   where (d.value->>'ativo')::boolean is true;

  insert into public.tenant_settings (tenant_id, horarios_semanais, horario_inicio, horario_fim)
  values (
    p_tenant,
    p_horarios,
    coalesce(v_min, '07:00')::time,
    coalesce(v_max, '21:00')::time
  )
  on conflict (tenant_id)
  do update set
    horarios_semanais = excluded.horarios_semanais,
    horario_inicio    = excluded.horario_inicio,
    horario_fim       = excluded.horario_fim;
end;
$$;


ALTER FUNCTION "public"."set_tenant_horario_semanal"("p_tenant" "uuid", "p_horarios" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tenant_images_limit_10"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF (SELECT count(*) FROM public.tenant_images WHERE tenant_id = NEW.tenant_id) >= 10 THEN
    RAISE EXCEPTION 'Máximo de 10 imagens por tenant atingido.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tenant_images_limit_10"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tenant_images_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."tenant_images_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tenant_settings_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."tenant_settings_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_group_banner"("_group_id" "uuid", "_banner_url" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- valida que o grupo existe
  if not exists (select 1 from public.tenant_groups g where g.id = _group_id) then
    raise exception 'group not found';
  end if;

  -- valida que o usuário consegue enxergar pelo menos um tenant do grupo
  -- (essa SELECT roda com as RLS do usuário porque usamos um sub-select
  --  via security invoker auxiliar — aqui simulamos via EXISTS direto;
  --  como a função é SECURITY DEFINER, fazemos a checagem por
  --  tenant_group_tenants apenas; ajuste se quiser regra mais estrita)
  select exists (
    select 1
    from public.tenant_group_tenants tgt
    where tgt.group_id = _group_id
  ) into v_ok;

  if not v_ok then
    raise exception 'group has no tenants';
  end if;

  update public.tenant_groups
     set banner_image_url = _banner_url
   where id = _group_id;

  return true;
end;
$$;


ALTER FUNCTION "public"."update_group_banner"("_group_id" "uuid", "_banner_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."venda_limpar_pagamentos"("p_venda_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._venda_assert_tenant(p_venda_id);
  delete from public.venda_pagamentos where venda_id = p_venda_id;
  perform public.venda_recalcular_totais(p_venda_id);
end;
$$;


ALTER FUNCTION "public"."venda_limpar_pagamentos"("p_venda_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."venda_recalcular_totais"("p_venda_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sub  numeric(12,2);
  v_pago numeric(12,2);
begin
  perform public._venda_assert_tenant(p_venda_id);

  select coalesce(sum(total),0) into v_sub
    from public.venda_itens where venda_id = p_venda_id;
  select coalesce(sum(valor),0) into v_pago
    from public.venda_pagamentos where venda_id = p_venda_id;

  update public.vendas
     set subtotal   = v_sub,
         total      = round(v_sub - desconto_valor, 2),
         total_pago = v_pago
   where id = p_venda_id;
end;
$$;


ALTER FUNCTION "public"."venda_recalcular_totais"("p_venda_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."venda_substituir_pagamentos"("p_venda_id" "uuid", "p_pagamentos" "jsonb") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tenant   uuid := public._venda_assert_tenant(p_venda_id);
  v_venda    public.vendas%rowtype;
  v_pag      jsonb;
  v_idx      int := 0;
  v_pago     numeric(12,2) := 0;
begin
  select * into v_venda from public.vendas where id = p_venda_id;
  if v_venda.status <> 'concluida' then
    raise exception 'venda cancelada não aceita alteração de pagamentos';
  end if;
  if jsonb_array_length(coalesce(p_pagamentos,'[]'::jsonb)) = 0 then
    raise exception 'venda sem pagamentos';
  end if;

  for v_pag in select * from jsonb_array_elements(p_pagamentos) loop
    v_pago := v_pago + round(coalesce((v_pag->>'valor')::numeric,0), 2);
  end loop;

  -- Regra do modal: pagamentos cobrem total + caixinha.
  if abs(v_pago - round(v_venda.total + v_venda.caixinha_valor, 2)) >= 0.01 then
    raise exception 'soma dos pagamentos (%) difere do total esperado (%)',
      v_pago, round(v_venda.total + v_venda.caixinha_valor, 2);
  end if;

  delete from public.venda_pagamentos where venda_id = p_venda_id;

  for v_pag in select * from jsonb_array_elements(p_pagamentos) loop
    insert into public.venda_pagamentos (
      tenant_id, venda_id, forma_pagamento, valor, parcelas,
      caixinha_valor, desconto_valor, observacao
    ) values (
      v_tenant, p_venda_id,
      coalesce(nullif(v_pag->>'forma_pagamento',''), 'pix'),
      round(coalesce((v_pag->>'valor')::numeric,0), 2),
      greatest(coalesce((v_pag->>'parcelas')::int, 1), 1),
      case when v_idx = 0 then v_venda.caixinha_valor else 0 end,
      case when v_idx = 0 then v_venda.desconto_valor else 0 end,
      nullif(v_pag->>'observacao','')
    );
    v_idx := v_idx + 1;
  end loop;

  perform public.venda_recalcular_totais(p_venda_id);
  return v_pago;
end;
$$;


ALTER FUNCTION "public"."venda_substituir_pagamentos"("p_venda_id" "uuid", "p_pagamentos" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wa_session_lookup"("p_token" "text") RETURNS TABLE("tenant_id" "uuid", "telefone" "text", "nome" "text", "expires_at" timestamp with time zone, "used_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT s.tenant_id, s.telefone, s.nome, s.expires_at, s.used_at
    FROM public.whatsapp_sessions s
   WHERE s.token = p_token
     AND s.expires_at > now()
   LIMIT 1;
$$;


ALTER FUNCTION "public"."wa_session_lookup"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wa_session_mark_used"("p_token" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  UPDATE public.whatsapp_sessions
     SET used_at = COALESCE(used_at, now())
   WHERE token = p_token
     AND expires_at > now();
$$;


ALTER FUNCTION "public"."wa_session_mark_used"("p_token" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agenda_bloqueios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "data" "date" NOT NULL,
    "hora_inicio" time without time zone NOT NULL,
    "hora_fim" time without time zone NOT NULL,
    "motivo" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agenda_bloqueios_horario_chk" CHECK (("hora_fim" > "hora_inicio"))
);

ALTER TABLE ONLY "public"."agenda_bloqueios" REPLICA IDENTITY FULL;


ALTER TABLE "public"."agenda_bloqueios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agendamento_servico_cores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agendamento_servico_id" "uuid" NOT NULL,
    "cor_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "quantidade" integer DEFAULT 0,
    "tenant_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agendamento_servico_cores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backfill_balcao_map" (
    "agendamento_id" "uuid" NOT NULL,
    "venda_id" "uuid" NOT NULL,
    "migrado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."backfill_balcao_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_agendamento_pagamentos_balcao" (
    "id" "uuid",
    "tenant_id" "uuid",
    "agendamento_id" "uuid",
    "forma_pagamento" "text",
    "valor" numeric,
    "parcelas" integer,
    "observacao" "text",
    "created_at" timestamp with time zone,
    "created_by" "uuid",
    "caixinha_valor" numeric(10,2),
    "desconto_valor" numeric(10,2),
    "acrescimo_valor" numeric(10,2)
);


ALTER TABLE "public"."backup_agendamento_pagamentos_balcao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_agendamento_pagamentos_observacao_desconto" (
    "backup_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pagamento_id" "uuid",
    "agendamento_id" "uuid",
    "observacao" "text"
);


ALTER TABLE "public"."backup_agendamento_pagamentos_observacao_desconto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_agendamento_produtos_balcao" (
    "id" "uuid",
    "tenant_id" "uuid",
    "agendamento_id" "uuid",
    "produto_id" "uuid",
    "quantidade" numeric,
    "preco_unitario" numeric,
    "observacao" "text",
    "estoque_movimentacao_id" "uuid",
    "cliente_levou" boolean,
    "created_at" timestamp with time zone,
    "created_by" "uuid"
);


ALTER TABLE "public"."backup_agendamento_produtos_balcao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_agendamentos_balcao" (
    "id" "uuid",
    "cliente_id" "uuid",
    "cliente_nome" "text",
    "cliente_telefone" "text",
    "profissional_id" "uuid",
    "data" "date",
    "hora" time without time zone,
    "status" "public"."agendamento_status",
    "observacoes" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "tenant_id" "uuid",
    "concluded_at" timestamp with time zone,
    "conclusion_type" "text",
    "origem" "text",
    "status_pagamento" "text",
    "valor_total_pago" numeric,
    "possui_pagamento" boolean,
    "reminder_24h_sent_at" timestamp with time zone,
    "reminder_2h_sent_at" timestamp with time zone,
    "prepaid" boolean,
    "prepaid_origin_agendamento_id" "uuid",
    "prepaid_origin_payment_id" "uuid",
    "subtotal_servicos" numeric(10,2),
    "subtotal_produtos" numeric(10,2),
    "desconto_total" numeric(10,2),
    "acrescimo_total" numeric(10,2),
    "caixinha_total" numeric(10,2),
    "base_comissao" numeric(10,2),
    "total" numeric(10,2)
);


ALTER TABLE "public"."backup_agendamentos_balcao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_comissoes_desconto_retroativo_agendamentos" (
    "backup_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "agendamento_id" "uuid" NOT NULL,
    "observacoes" "text"
);


ALTER TABLE "public"."backup_comissoes_desconto_retroativo_agendamentos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_comissoes_desconto_retroativo_pagamentos" (
    "backup_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "pagamento_id" "uuid" NOT NULL,
    "agendamento_id" "uuid" NOT NULL,
    "observacao" "text"
);


ALTER TABLE "public"."backup_comissoes_desconto_retroativo_pagamentos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cancelamento_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "agendamento_id" "uuid" NOT NULL,
    "cancelado_por_user_id" "uuid",
    "cancelado_por_nome" "text",
    "cancelado_por_email" "text",
    "cancelado_por_role" "text",
    "motivo_id" "uuid",
    "motivo_slug" "text",
    "motivo_nome" "text",
    "descricao_outro" "text",
    "status_anterior" "text",
    "ip" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cancelamento_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cancelamento_motivos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "nome" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "exige_descricao" boolean DEFAULT false NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "ordem" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cancelamento_motivos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "email" "text" NOT NULL,
    "profissional_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    "ativo" boolean DEFAULT true NOT NULL,
    "login" "text"
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


COMMENT ON TABLE "public"."usuarios" IS 'Usuários do sistema vinculados ao auth.users';



COMMENT ON COLUMN "public"."usuarios"."login" IS 'Username amigável usado no login (lowercase). Auth do Supabase continua usando email. Sem NOT NULL/UNIQUE durante migração — adicionar em etapa futura após backfill.';



CREATE OR REPLACE VIEW "public"."comissoes_v2_eventos" WITH ("security_invoker"='true') AS
 WITH "pct" AS (
         SELECT "cp"."tenant_id",
            "cp"."profissional_id",
            COALESCE("cp"."percentual_profissional", (50)::numeric) AS "pct_prof"
           FROM "public"."comissoes_profissionais" "cp"
        ), "ag_ok" AS (
         SELECT "a"."id",
            "a"."cliente_id",
            "a"."cliente_nome",
            "a"."cliente_telefone",
            "a"."profissional_id",
            "a"."data",
            "a"."hora",
            "a"."status",
            "a"."observacoes",
            "a"."created_at",
            "a"."updated_at",
            "a"."tenant_id",
            "a"."concluded_at",
            "a"."conclusion_type",
            "a"."origem",
            "a"."status_pagamento",
            "a"."valor_total_pago",
            "a"."possui_pagamento",
            "a"."reminder_24h_sent_at",
            "a"."reminder_2h_sent_at",
            "a"."prepaid",
            "a"."prepaid_origin_agendamento_id",
            "a"."prepaid_origin_payment_id",
            "a"."subtotal_servicos",
            "a"."subtotal_produtos",
            "a"."desconto_total",
            "a"."acrescimo_total",
            "a"."caixinha_total",
            "a"."base_comissao",
            "a"."total"
           FROM "public"."agendamentos" "a"
          WHERE (("a"."status" = 'concluido'::"public"."agendamento_status") OR ("a"."conclusion_type" = 'cancelado_com_venda'::"text"))
        ), "linhas" AS (
         SELECT "ags"."id" AS "linha_id",
            "ags"."tenant_id",
            "a"."id" AS "agendamento_id",
            "a"."data" AS "event_date",
            "a"."hora" AS "event_time",
            "a"."cliente_id",
            "a"."cliente_nome",
            COALESCE("ags"."profissional_id", "a"."profissional_id") AS "profissional_id",
            "ags"."servico_id",
            "s"."nome" AS "servico_nome",
            COALESCE("ags"."preco", (0)::numeric) AS "preco",
            COALESCE("ags"."origem", 'avulso'::"text") AS "origem",
            "ags"."cliente_pacote_id",
            "ags"."created_at"
           FROM (("public"."agendamento_servicos" "ags"
             JOIN "ag_ok" "a" ON (("a"."id" = "ags"."agendamento_id")))
             LEFT JOIN "public"."servicos" "s" ON (("s"."id" = "ags"."servico_id")))
        ), "ev_servico" AS (
         SELECT 'servico'::"text" AS "event_type",
            "l"."linha_id" AS "event_id",
            "l"."tenant_id",
            "l"."event_date",
            "l"."event_time",
            "l"."agendamento_id",
            "l"."cliente_id",
            "l"."cliente_nome",
            "l"."profissional_id",
            COALESCE("l"."servico_nome", 'Atendimento'::"text") AS "titulo",
            "l"."preco" AS "valor",
            "round"((("l"."preco" * COALESCE("p"."pct_prof", (50)::numeric)) / 100.0), 2) AS "comissao",
            true AS "conta_atendimento",
            "l"."created_at",
            1 AS "ord_evento"
           FROM ("linhas" "l"
             LEFT JOIN "pct" "p" ON ((("p"."tenant_id" = "l"."tenant_id") AND ("p"."profissional_id" = "l"."profissional_id"))))
          WHERE ("l"."origem" = 'avulso'::"text")
        ), "ev_pacote_uso" AS (
         SELECT 'pacote_uso'::"text" AS "event_type",
            "l"."linha_id" AS "event_id",
            "l"."tenant_id",
            "l"."event_date",
            "l"."event_time",
            "l"."agendamento_id",
            "l"."cliente_id",
            "l"."cliente_nome",
            "l"."profissional_id",
            COALESCE("l"."servico_nome", 'Atendimento'::"text") AS "titulo",
            (0)::numeric AS "valor",
            (0)::numeric AS "comissao",
            true AS "conta_atendimento",
            "l"."created_at",
            2 AS "ord_evento"
           FROM "linhas" "l"
          WHERE (("l"."origem" = 'pacote_uso'::"text") OR (("l"."origem" <> 'pacote_venda'::"text") AND ("l"."cliente_pacote_id" IS NOT NULL)))
        ), "venda_link" AS (
         SELECT DISTINCT ON ("ags"."cliente_pacote_id") "ags"."cliente_pacote_id",
            "a"."id" AS "agendamento_id",
            "a"."data" AS "event_date",
            "a"."hora" AS "event_time",
            COALESCE("ags"."profissional_id", "a"."profissional_id") AS "profissional_id",
            "ags"."created_at"
           FROM ("public"."agendamento_servicos" "ags"
             JOIN "ag_ok" "a" ON (("a"."id" = "ags"."agendamento_id")))
          WHERE ("ags"."cliente_pacote_id" IS NOT NULL)
          ORDER BY "ags"."cliente_pacote_id", ("ags"."origem" = 'pacote_venda'::"text") DESC, "a"."data", "a"."hora", "ags"."created_at"
        ), "ev_pacote_venda" AS (
         SELECT 'pacote_venda'::"text" AS "event_type",
            "cp"."id" AS "event_id",
            "cp"."tenant_id",
            COALESCE("vl"."event_date", "cp"."data_inicio") AS "event_date",
            "vl"."event_time",
            "vl"."agendamento_id",
            "cp"."cliente_id",
            COALESCE("cl"."nome", 'Cliente'::"text") AS "cliente_nome",
            COALESCE("vl"."profissional_id", "u"."profissional_id") AS "profissional_id",
            COALESCE("pk"."nome", 'Pacote'::"text") AS "titulo",
            COALESCE("cp"."preco_total", (0)::numeric) AS "valor",
            "round"(((COALESCE("cp"."preco_total", (0)::numeric) * COALESCE("pr"."pct_prof", (50)::numeric)) / 100.0), 2) AS "comissao",
            false AS "conta_atendimento",
            "cp"."created_at",
            0 AS "ord_evento"
           FROM ((((("public"."cliente_pacotes" "cp"
             LEFT JOIN "venda_link" "vl" ON (("vl"."cliente_pacote_id" = "cp"."id")))
             LEFT JOIN "public"."pacotes" "pk" ON (("pk"."id" = "cp"."pacote_id")))
             LEFT JOIN "public"."clientes" "cl" ON (("cl"."id" = "cp"."cliente_id")))
             LEFT JOIN "public"."usuarios" "u" ON (("u"."id" = "cp"."user_id")))
             LEFT JOIN "pct" "pr" ON ((("pr"."tenant_id" = "cp"."tenant_id") AND ("pr"."profissional_id" = COALESCE("vl"."profissional_id", "u"."profissional_id")))))
          WHERE ("cp"."status" <> 'cancelado'::"text")
        ), "ev_produto" AS (
         SELECT 'produto'::"text" AS "event_type",
            "ap"."id" AS "event_id",
            "ap"."tenant_id",
            "a"."data" AS "event_date",
            "a"."hora" AS "event_time",
            "a"."id" AS "agendamento_id",
            "a"."cliente_id",
            "a"."cliente_nome",
            "a"."profissional_id",
            COALESCE("pr"."nome", 'Produto'::"text") AS "titulo",
            (COALESCE("ap"."quantidade", (0)::numeric) * COALESCE("ap"."preco_unitario", (0)::numeric)) AS "valor",
            (0)::numeric AS "comissao",
            false AS "conta_atendimento",
            "ap"."created_at",
            3 AS "ord_evento"
           FROM (("public"."agendamento_produtos" "ap"
             JOIN "ag_ok" "a" ON (("a"."id" = "ap"."agendamento_id")))
             LEFT JOIN "public"."produtos" "pr" ON (("pr"."id" = "ap"."produto_id")))
        )
 SELECT "ev_pacote_venda"."event_type",
    "ev_pacote_venda"."event_id",
    "ev_pacote_venda"."tenant_id",
    "ev_pacote_venda"."event_date",
    "ev_pacote_venda"."event_time",
    "ev_pacote_venda"."agendamento_id",
    "ev_pacote_venda"."cliente_id",
    "ev_pacote_venda"."cliente_nome",
    "ev_pacote_venda"."profissional_id",
    "ev_pacote_venda"."titulo",
    "ev_pacote_venda"."valor",
    "ev_pacote_venda"."comissao",
    "ev_pacote_venda"."conta_atendimento",
    "ev_pacote_venda"."created_at",
    "ev_pacote_venda"."ord_evento"
   FROM "ev_pacote_venda"
UNION ALL
 SELECT "ev_servico"."event_type",
    "ev_servico"."event_id",
    "ev_servico"."tenant_id",
    "ev_servico"."event_date",
    "ev_servico"."event_time",
    "ev_servico"."agendamento_id",
    "ev_servico"."cliente_id",
    "ev_servico"."cliente_nome",
    "ev_servico"."profissional_id",
    "ev_servico"."titulo",
    "ev_servico"."valor",
    "ev_servico"."comissao",
    "ev_servico"."conta_atendimento",
    "ev_servico"."created_at",
    "ev_servico"."ord_evento"
   FROM "ev_servico"
UNION ALL
 SELECT "ev_pacote_uso"."event_type",
    "ev_pacote_uso"."event_id",
    "ev_pacote_uso"."tenant_id",
    "ev_pacote_uso"."event_date",
    "ev_pacote_uso"."event_time",
    "ev_pacote_uso"."agendamento_id",
    "ev_pacote_uso"."cliente_id",
    "ev_pacote_uso"."cliente_nome",
    "ev_pacote_uso"."profissional_id",
    "ev_pacote_uso"."titulo",
    "ev_pacote_uso"."valor",
    "ev_pacote_uso"."comissao",
    "ev_pacote_uso"."conta_atendimento",
    "ev_pacote_uso"."created_at",
    "ev_pacote_uso"."ord_evento"
   FROM "ev_pacote_uso"
UNION ALL
 SELECT "ev_produto"."event_type",
    "ev_produto"."event_id",
    "ev_produto"."tenant_id",
    "ev_produto"."event_date",
    "ev_produto"."event_time",
    "ev_produto"."agendamento_id",
    "ev_produto"."cliente_id",
    "ev_produto"."cliente_nome",
    "ev_produto"."profissional_id",
    "ev_produto"."titulo",
    "ev_produto"."valor",
    "ev_produto"."comissao",
    "ev_produto"."conta_atendimento",
    "ev_produto"."created_at",
    "ev_produto"."ord_evento"
   FROM "ev_produto";


ALTER VIEW "public"."comissoes_v2_eventos" OWNER TO "postgres";


COMMENT ON VIEW "public"."comissoes_v2_eventos" IS 'Grão = evento de comissão (não agendamento). Um agendamento com venda de pacote + 1º uso gera 2 linhas. Fonte única do histórico do módulo Comissões V2.';



CREATE TABLE IF NOT EXISTS "public"."cores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "hex" "text" NOT NULL,
    "tipo" "public"."cor_tipo" NOT NULL,
    "servico_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."cores" OWNER TO "postgres";


COMMENT ON TABLE "public"."cores" IS 'Cores (bases/pigmentos) vinculadas a serviços';



CREATE TABLE IF NOT EXISTS "public"."custom_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "icon" "text" DEFAULT '📈'::"text",
    "filters" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "export_formats" "jsonb" DEFAULT '["csv"]'::"jsonb" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."custom_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venda_itens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "venda_id" "uuid" NOT NULL,
    "produto_id" "uuid",
    "descricao" "text" NOT NULL,
    "quantidade" numeric(12,3) DEFAULT 1 NOT NULL,
    "valor_unitario" numeric(12,2) DEFAULT 0 NOT NULL,
    "desconto_valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "venda_itens_desconto_valor_check" CHECK (("desconto_valor" >= (0)::numeric)),
    CONSTRAINT "venda_itens_quantidade_check" CHECK (("quantidade" > (0)::numeric)),
    CONSTRAINT "venda_itens_valor_unitario_check" CHECK (("valor_unitario" >= (0)::numeric))
);


ALTER TABLE "public"."venda_itens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "cliente_id" "uuid",
    "cliente_nome" "text" DEFAULT 'Consumidor Final'::"text" NOT NULL,
    "cliente_telefone" "text",
    "data_venda" "date" DEFAULT (("now"() AT TIME ZONE 'America/Sao_Paulo'::"text"))::"date" NOT NULL,
    "hora_venda" time without time zone DEFAULT (("now"() AT TIME ZONE 'America/Sao_Paulo'::"text"))::time without time zone NOT NULL,
    "vendida_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "desconto_valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "caixinha_valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_pago" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'concluida'::"text" NOT NULL,
    "observacoes" "text",
    "cancelada_em" timestamp with time zone,
    "cancelada_por" "uuid",
    "motivo_cancelamento" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "vendas_status_check" CHECK (("status" = ANY (ARRAY['concluida'::"text", 'cancelada'::"text"])))
);


ALTER TABLE "public"."vendas" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dv2_vendas_itens" AS
 SELECT "v"."tenant_id",
    "v"."id" AS "venda_id",
    "i"."id" AS "item_id",
    "v"."data_venda" AS "data",
    "v"."profissional_id",
    "i"."produto_id",
    COALESCE("i"."descricao", "pr"."nome", '—'::"text") AS "descricao",
    COALESCE("i"."quantidade", (0)::numeric) AS "quantidade",
    COALESCE("i"."total", (0)::numeric) AS "valor"
   FROM (("public"."venda_itens" "i"
     JOIN "public"."vendas" "v" ON (("v"."id" = "i"."venda_id")))
     LEFT JOIN "public"."produtos" "pr" ON (("pr"."id" = "i"."produto_id")))
  WHERE (true AND (COALESCE("v"."status", ''::"text") <> ALL (ARRAY['cancelada'::"text", 'cancelado'::"text", 'estornada'::"text", 'estornado'::"text", 'excluida'::"text", 'excluido'::"text", 'rascunho'::"text"])));


ALTER VIEW "public"."dv2_vendas_itens" OWNER TO "postgres";


COMMENT ON VIEW "public"."dv2_vendas_itens" IS 'Dashboard V2 · itens do domínio de Vendas (Venda de Balcão) normalizados.';



CREATE TABLE IF NOT EXISTS "public"."venda_pagamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "venda_id" "uuid" NOT NULL,
    "forma_pagamento" "text" NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "parcelas" integer DEFAULT 1 NOT NULL,
    "caixinha_valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "desconto_valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "observacao" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "venda_pagamentos_forma_pagamento_check" CHECK (("forma_pagamento" = ANY (ARRAY['pix'::"text", 'dinheiro'::"text", 'debito'::"text", 'credito'::"text", 'credito_parcelado'::"text"]))),
    CONSTRAINT "venda_pagamentos_parcelas_check" CHECK ((("parcelas" >= 1) AND ("parcelas" <= 24))),
    CONSTRAINT "venda_pagamentos_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."venda_pagamentos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dv2_vendas_receita" AS
 SELECT "v"."tenant_id",
    "v"."id" AS "venda_id",
    "v"."data_venda" AS "data",
    "v"."profissional_id",
    COALESCE("p"."forma_pagamento", 'Não informado'::"text") AS "forma_pagamento",
    COALESCE("p"."valor", (0)::numeric) AS "valor"
   FROM ("public"."venda_pagamentos" "p"
     JOIN "public"."vendas" "v" ON (("v"."id" = "p"."venda_id")))
  WHERE (true AND (COALESCE("v"."status", ''::"text") <> ALL (ARRAY['cancelada'::"text", 'cancelado'::"text", 'estornada'::"text", 'estornado'::"text", 'excluida'::"text", 'excluido'::"text", 'rascunho'::"text"])));


ALTER VIEW "public"."dv2_vendas_receita" OWNER TO "postgres";


COMMENT ON VIEW "public"."dv2_vendas_receita" IS 'Dashboard V2 · receita (pagamentos) do domínio de Vendas normalizada.';



CREATE TABLE IF NOT EXISTS "public"."estoque_movimentacoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "produto_id" "uuid" NOT NULL,
    "tipo" "public"."estoque_mov_tipo" NOT NULL,
    "quantidade" numeric NOT NULL,
    "observacao" "text",
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "estoque_movimentacoes_quantidade_check" CHECK (("quantidade" > (0)::numeric))
);


ALTER TABLE "public"."estoque_movimentacoes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."evolution_settings" (
    "tenant_id" "uuid" NOT NULL,
    "base_url" "text" NOT NULL,
    "instance" "text" NOT NULL,
    "api_key" "text" NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."evolution_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."historico_atendimentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agendamento_id" "uuid",
    "cliente_id" "uuid",
    "cliente_nome" "text" NOT NULL,
    "cliente_telefone" "text" NOT NULL,
    "profissional_id" "uuid",
    "profissional_nome" "text" NOT NULL,
    "status" "public"."agendamento_status" NOT NULL,
    "data" "date" NOT NULL,
    "hora" time without time zone NOT NULL,
    "observacoes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."historico_atendimentos" OWNER TO "postgres";


COMMENT ON TABLE "public"."historico_atendimentos" IS 'Histórico imutável de atendimentos';



CREATE TABLE IF NOT EXISTS "public"."historico_servicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "historico_atendimento_id" "uuid" NOT NULL,
    "servico_nome" "text" NOT NULL,
    "preco" numeric(10,2) NOT NULL,
    "duracao" integer NOT NULL,
    "cor_nome" "text",
    "cor_hex" "text",
    "tenant_id" "uuid",
    "cores_detalhes" "jsonb"
);


ALTER TABLE "public"."historico_servicos" OWNER TO "postgres";


COMMENT ON TABLE "public"."historico_servicos" IS 'Snapshot dos serviços realizados em cada atendimento histórico';



COMMENT ON COLUMN "public"."historico_servicos"."cores_detalhes" IS 'JSON array com detalhes das cores usadas: [{tipo:"base",cor:"8-0",qtd:60,hex:"#xxx"}, ...]';



CREATE TABLE IF NOT EXISTS "public"."inactive_customer_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "telefone" "text",
    "mensagem" "text",
    "status" "text" NOT NULL,
    "erro" "text",
    "response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inactive_customer_campaigns_status_check" CHECK (("status" = ANY (ARRAY['enviado'::"text", 'erro'::"text", 'ignorado'::"text"])))
);


ALTER TABLE "public"."inactive_customer_campaigns" OWNER TO "postgres";


COMMENT ON TABLE "public"."inactive_customer_campaigns" IS 'Histórico das campanhas de reativação. Usada para auditoria e como fonte de verdade do cooldown anti-spam (30 dias).';



CREATE TABLE IF NOT EXISTS "public"."master_tenant_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "accessed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."master_tenant_history" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."produtos_estoque_saldo" AS
 SELECT "p"."id" AS "produto_id",
    "p"."tenant_id",
    COALESCE("sum"(
        CASE "m"."tipo"
            WHEN 'entrada'::"public"."estoque_mov_tipo" THEN "m"."quantidade"
            WHEN 'saida'::"public"."estoque_mov_tipo" THEN (- "m"."quantidade")
            WHEN 'ajuste'::"public"."estoque_mov_tipo" THEN "m"."quantidade"
            ELSE NULL::numeric
        END), (0)::numeric) AS "saldo"
   FROM ("public"."produtos" "p"
     LEFT JOIN "public"."estoque_movimentacoes" "m" ON (("m"."produto_id" = "p"."id")))
  GROUP BY "p"."id", "p"."tenant_id";


ALTER VIEW "public"."produtos_estoque_saldo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."produtos_estoque_ultima_mov" AS
 SELECT DISTINCT ON ("produto_id") "produto_id",
    "tenant_id",
    "tipo",
    "quantidade",
    "created_at"
   FROM "public"."estoque_movimentacoes" "m"
  ORDER BY "produto_id", "created_at" DESC;


ALTER VIEW "public"."produtos_estoque_ultima_mov" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."professional_queue" (
    "tenant_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "last_assigned_at" timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL
);


ALTER TABLE "public"."professional_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profissional_servicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "servico_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."profissional_servicos" OWNER TO "postgres";


COMMENT ON TABLE "public"."profissional_servicos" IS 'Serviços que cada profissional realiza';



CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "profissional_id" "uuid",
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_recommendations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "uuid" NOT NULL,
    "recommended_service_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "prioridade" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_recommendations_no_self" CHECK (("service_id" <> "recommended_service_id"))
);


ALTER TABLE "public"."service_recommendations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."servico_cor_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "servico_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "tipo_quantidade" "text" DEFAULT 'intervalo'::"text" NOT NULL,
    "qtd_min" integer DEFAULT 5,
    "qtd_max" integer DEFAULT 120,
    "qtd_step" integer DEFAULT 5,
    "qtd_lista" "jsonb" DEFAULT '[]'::"jsonb",
    "unidade" "text" DEFAULT 'g'::"text" NOT NULL,
    "tenant_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "servico_cor_config_tipo_check" CHECK (("tipo" = ANY (ARRAY['base'::"text", 'pigmento'::"text"]))),
    CONSTRAINT "servico_cor_config_tipo_quantidade_check" CHECK (("tipo_quantidade" = ANY (ARRAY['intervalo'::"text", 'lista'::"text", 'livre'::"text"])))
);


ALTER TABLE "public"."servico_cor_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_group_tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tenant_group_tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "slug" character varying(255) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "banner_image_url" "text"
);


ALTER TABLE "public"."tenant_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "image_url" "text" NOT NULL,
    "storage_path" "text",
    "order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tenant_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "permitir_agendamento_cliente" boolean DEFAULT false NOT NULL,
    "horario_inicio" time without time zone DEFAULT '07:00:00'::time without time zone NOT NULL,
    "horario_fim" time without time zone DEFAULT '21:00:00'::time without time zone NOT NULL,
    "slot_minutos" integer DEFAULT 15 NOT NULL,
    "rodizio_queue" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "horarios_semanais" "jsonb" DEFAULT "jsonb_build_object"('segunda', "jsonb_build_object"('ativo', true, 'inicio', '07:00', 'fim', '21:00'), 'terca', "jsonb_build_object"('ativo', true, 'inicio', '07:00', 'fim', '21:00'), 'quarta', "jsonb_build_object"('ativo', true, 'inicio', '07:00', 'fim', '21:00'), 'quinta', "jsonb_build_object"('ativo', true, 'inicio', '07:00', 'fim', '21:00'), 'sexta', "jsonb_build_object"('ativo', true, 'inicio', '07:00', 'fim', '21:00'), 'sabado', "jsonb_build_object"('ativo', true, 'inicio', '07:00', 'fim', '21:00'), 'domingo', "jsonb_build_object"('ativo', true, 'inicio', '07:00', 'fim', '21:00')),
    "destacar_clientes_inativos" boolean DEFAULT false NOT NULL,
    "dias_inatividade_clientes" integer DEFAULT 30 NOT NULL,
    "inactive_customer_automation_enabled" boolean DEFAULT false NOT NULL,
    "whatsapp_magic_link_enabled" boolean DEFAULT false NOT NULL,
    "exigir_senha_cancelamento" boolean DEFAULT true NOT NULL,
    "exigir_senha_desconto" boolean DEFAULT false NOT NULL,
    "modulo_comissoes_ativo" boolean DEFAULT false NOT NULL,
    "appointment_interval_minutes" integer DEFAULT 15 NOT NULL,
    CONSTRAINT "tenant_settings_appointment_interval_minutes_chk" CHECK (("appointment_interval_minutes" = ANY (ARRAY[15, 30]))),
    CONSTRAINT "tenant_settings_dias_inatividade_clientes_check" CHECK ((("dias_inatividade_clientes" >= 1) AND ("dias_inatividade_clientes" <= 3650))),
    CONSTRAINT "tenant_settings_slot_minutos_check" CHECK (("slot_minutos" > 0))
);


ALTER TABLE "public"."tenant_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenant_settings"."inactive_customer_automation_enabled" IS 'Liga/desliga automação notify-inactive-customers. Período de inatividade é FIXO em 30 dias (não configurável).';



COMMENT ON COLUMN "public"."tenant_settings"."whatsapp_magic_link_enabled" IS 'Quando true, mensagens recebidas no WhatsApp via Evolution disparam o fluxo mágico (create-whatsapp-session gera token + envia link de agendamento). Quando false, o webhook ignora silenciosamente.';



COMMENT ON COLUMN "public"."tenant_settings"."exigir_senha_cancelamento" IS 'Quando TRUE, a edge function cancelar-agendamento exige e-mail+senha do admin. Quando FALSE, dispensa a autenticação administrativa por e-mail, senha, JWT e role. Default TRUE para retro-compatibilidade.';



COMMENT ON COLUMN "public"."tenant_settings"."exigir_senha_desconto" IS 'Quando true, aplicar desconto em pagamentos exige autenticação administrativa (Edge Function authorize-admin).';



COMMENT ON COLUMN "public"."tenant_settings"."modulo_comissoes_ativo" IS 'Feature flag — exibe coluna/módulo de Comissões no Dashboard. Default false.';



COMMENT ON COLUMN "public"."tenant_settings"."appointment_interval_minutes" IS 'Intervalo (em minutos) para geração da grade de horários de agendamento. Valores aceitos: 15 (padrão) ou 30. Fonte única para agendamento interno e externo.';



CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "razao_social" "text",
    "nome_fantasia" "text",
    "cpf_cnpj" "text",
    "email" "text",
    "telefone" "text",
    "logo_url" "text",
    "display_id" integer NOT NULL,
    "cep" "text",
    "logradouro" "text",
    "numero" "text",
    "complemento" "text",
    "bairro" "text",
    "cidade" "text",
    "estado" "text",
    "max_active_users" integer DEFAULT 3 NOT NULL,
    CONSTRAINT "tenants_cep_digits_chk" CHECK ((("cep" IS NULL) OR ("cep" ~ '^[0-9]{8}$'::"text"))),
    CONSTRAINT "tenants_max_active_users_positive" CHECK (("max_active_users" >= 1))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenants"."max_active_users" IS 'Limite de usuários ATIVOS do tenant (master_admin não conta). Administrado exclusivamente via banco.';



CREATE OR REPLACE VIEW "public"."tenant_public_booking" WITH ("security_invoker"='on') AS
 SELECT "t"."id" AS "tenant_id",
    "t"."nome",
    "t"."nome_fantasia",
    "t"."logo_url",
    "ts"."permitir_agendamento_cliente" AS "habilitado",
    "ts"."horario_inicio",
    "ts"."horario_fim",
    "ts"."slot_minutos"
   FROM ("public"."tenants" "t"
     LEFT JOIN "public"."tenant_settings" "ts" ON (("ts"."tenant_id" = "t"."id")));


ALTER VIEW "public"."tenant_public_booking" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tenants_display_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tenants_display_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tenants_display_id_seq" OWNED BY "public"."tenants"."display_id";



CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "tenant_id" "uuid",
    "multi_unit_access" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_roles" IS 'Roles de usuários — tabela separada por segurança';



COMMENT ON COLUMN "public"."user_roles"."multi_unit_access" IS 'Quando true, permite que o usuário acesse e alterne entre todas as unidades do grupo do seu tenant principal. Quando false (padrão), o usuário entra direto no tenant cadastrado.';



CREATE TABLE IF NOT EXISTS "public"."whatsapp_inbound_seen" (
    "message_id" "text" NOT NULL,
    "tenant_id" "uuid",
    "instance" "text",
    "remote_jid" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_inbound_seen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_notifications_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "agendamento_id" "uuid",
    "profissional_id" "uuid",
    "telefone" "text",
    "status" "text" NOT NULL,
    "http_status" integer,
    "payload" "jsonb",
    "response" "jsonb",
    "erro" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_notifications_log_status_check" CHECK (("status" = ANY (ARRAY['enviado'::"text", 'erro'::"text", 'ignorado'::"text"])))
);


ALTER TABLE "public"."whatsapp_notifications_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "telefone" "text" NOT NULL,
    "nome" "text",
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip" "text",
    "user_agent" "text"
);


ALTER TABLE "public"."whatsapp_sessions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."tenants" ALTER COLUMN "display_id" SET DEFAULT "nextval"('"public"."tenants_display_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agenda_bloqueios"
    ADD CONSTRAINT "agenda_bloqueios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agenda_themes"
    ADD CONSTRAINT "agenda_themes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agenda_themes"
    ADD CONSTRAINT "agenda_themes_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."agendamento_pagamentos"
    ADD CONSTRAINT "agendamento_pagamentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agendamento_produtos"
    ADD CONSTRAINT "agendamento_produtos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agendamento_servico_cores"
    ADD CONSTRAINT "agendamento_servico_cores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agendamento_servicos"
    ADD CONSTRAINT "agendamento_servicos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agendamentos"
    ADD CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backfill_balcao_map"
    ADD CONSTRAINT "backfill_balcao_map_pkey" PRIMARY KEY ("agendamento_id");



ALTER TABLE ONLY "public"."cancelamento_log"
    ADD CONSTRAINT "cancelamento_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cancelamento_motivos"
    ADD CONSTRAINT "cancelamento_motivos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cancelamento_motivos"
    ADD CONSTRAINT "cancelamento_motivos_slug_tenant_uq" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."cliente_pacotes"
    ADD CONSTRAINT "cliente_pacotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comissoes_profissionais"
    ADD CONSTRAINT "comissoes_profissionais_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comissoes_profissionais"
    ADD CONSTRAINT "comissoes_profissionais_unique_prof" UNIQUE ("tenant_id", "profissional_id");



ALTER TABLE ONLY "public"."cores"
    ADD CONSTRAINT "cores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_reports"
    ADD CONSTRAINT "custom_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_reports"
    ADD CONSTRAINT "custom_reports_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."estoque_movimentacoes"
    ADD CONSTRAINT "estoque_movimentacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."evolution_settings"
    ADD CONSTRAINT "evolution_settings_pkey" PRIMARY KEY ("tenant_id");



ALTER TABLE ONLY "public"."historico_atendimentos"
    ADD CONSTRAINT "historico_atendimentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."historico_servicos"
    ADD CONSTRAINT "historico_servicos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inactive_customer_campaigns"
    ADD CONSTRAINT "inactive_customer_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_tenant_history"
    ADD CONSTRAINT "master_tenant_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_tenant_history"
    ADD CONSTRAINT "master_tenant_history_unique" UNIQUE ("user_id", "tenant_id");



ALTER TABLE ONLY "public"."pacotes"
    ADD CONSTRAINT "pacotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."produtos"
    ADD CONSTRAINT "produtos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."professional_queue"
    ADD CONSTRAINT "professional_queue_pkey" PRIMARY KEY ("tenant_id", "profissional_id");



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_nome_tenant_id_unique" UNIQUE ("nome", "tenant_id");



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profissional_servicos"
    ADD CONSTRAINT "profissional_servicos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profissional_servicos"
    ADD CONSTRAINT "profissional_servicos_prof_svc_unique" UNIQUE ("profissional_id", "servico_id", "tenant_id");



ALTER TABLE ONLY "public"."profissional_servicos"
    ADD CONSTRAINT "profissional_servicos_profissional_id_servico_id_key" UNIQUE ("profissional_id", "servico_id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_recommendations"
    ADD CONSTRAINT "service_recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_recommendations"
    ADD CONSTRAINT "service_recommendations_unique" UNIQUE ("service_id", "recommended_service_id");



ALTER TABLE ONLY "public"."servico_cor_config"
    ADD CONSTRAINT "servico_cor_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."servico_cor_config"
    ADD CONSTRAINT "servico_cor_config_unique" UNIQUE ("servico_id", "tipo", "tenant_id");



ALTER TABLE ONLY "public"."servicos"
    ADD CONSTRAINT "servicos_nome_tenant_id_unique" UNIQUE ("nome", "tenant_id");



ALTER TABLE ONLY "public"."servicos"
    ADD CONSTRAINT "servicos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_group_tenants"
    ADD CONSTRAINT "tenant_group_tenants_group_id_tenant_id_key" UNIQUE ("group_id", "tenant_id");



ALTER TABLE ONLY "public"."tenant_group_tenants"
    ADD CONSTRAINT "tenant_group_tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_groups"
    ADD CONSTRAINT "tenant_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_groups"
    ADD CONSTRAINT "tenant_groups_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."tenant_images"
    ADD CONSTRAINT "tenant_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_settings"
    ADD CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_settings"
    ADD CONSTRAINT "tenant_settings_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_tenant_role_uniq" UNIQUE ("user_id", "tenant_id", "role");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venda_itens"
    ADD CONSTRAINT "venda_itens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venda_pagamentos"
    ADD CONSTRAINT "venda_pagamentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendas"
    ADD CONSTRAINT "vendas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_inbound_seen"
    ADD CONSTRAINT "whatsapp_inbound_seen_pkey" PRIMARY KEY ("message_id");



ALTER TABLE ONLY "public"."whatsapp_notifications_log"
    ADD CONSTRAINT "whatsapp_notifications_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_token_key" UNIQUE ("token");



CREATE INDEX "agenda_bloqueios_prof_data_idx" ON "public"."agenda_bloqueios" USING "btree" ("profissional_id", "data");



CREATE INDEX "agenda_bloqueios_tenant_data_idx" ON "public"."agenda_bloqueios" USING "btree" ("tenant_id", "data");



CREATE INDEX "idx_ag_pag_agendamento" ON "public"."agendamento_pagamentos" USING "btree" ("agendamento_id");



CREATE INDEX "idx_ag_pag_forma" ON "public"."agendamento_pagamentos" USING "btree" ("tenant_id", "forma_pagamento");



CREATE INDEX "idx_ag_pag_tenant_data" ON "public"."agendamento_pagamentos" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_agendamento_produtos_agendamento" ON "public"."agendamento_produtos" USING "btree" ("agendamento_id");



CREATE INDEX "idx_agendamento_produtos_produto" ON "public"."agendamento_produtos" USING "btree" ("produto_id");



CREATE INDEX "idx_agendamento_produtos_tenant" ON "public"."agendamento_produtos" USING "btree" ("tenant_id");



CREATE INDEX "idx_agendamento_servicos_cliente_pacote" ON "public"."agendamento_servicos" USING "btree" ("cliente_pacote_id");



CREATE INDEX "idx_agendamento_servicos_origem" ON "public"."agendamento_servicos" USING "btree" ("origem");



CREATE INDEX "idx_agendamento_servicos_profissional" ON "public"."agendamento_servicos" USING "btree" ("profissional_id");



CREATE INDEX "idx_agendamento_servicos_tenant_prof" ON "public"."agendamento_servicos" USING "btree" ("tenant_id", "profissional_id");



CREATE INDEX "idx_agendamentos_cliente" ON "public"."agendamentos" USING "btree" ("cliente_id");



CREATE INDEX "idx_agendamentos_data" ON "public"."agendamentos" USING "btree" ("data");



CREATE INDEX "idx_agendamentos_origem" ON "public"."agendamentos" USING "btree" ("origem");



CREATE INDEX "idx_agendamentos_origem_balcao" ON "public"."agendamentos" USING "btree" ("tenant_id", "data") WHERE ("origem" = 'BALCAO'::"text");



CREATE INDEX "idx_agendamentos_pending_concluded_at" ON "public"."agendamentos" USING "btree" ("data", "hora") WHERE ("concluded_at" IS NULL);



CREATE INDEX "idx_agendamentos_prepaid" ON "public"."agendamentos" USING "btree" ("prepaid") WHERE ("prepaid" = true);



CREATE INDEX "idx_agendamentos_prepaid_origin" ON "public"."agendamentos" USING "btree" ("prepaid_origin_agendamento_id");



CREATE INDEX "idx_agendamentos_prof_data" ON "public"."agendamentos" USING "btree" ("profissional_id", "data") WHERE ("status" <> 'cancelado'::"public"."agendamento_status");



CREATE INDEX "idx_agendamentos_profissional" ON "public"."agendamentos" USING "btree" ("profissional_id");



CREATE INDEX "idx_agendamentos_reminder_24h_pending" ON "public"."agendamentos" USING "btree" ("data", "hora") WHERE ("reminder_24h_sent_at" IS NULL);



CREATE INDEX "idx_agendamentos_reminder_2h_pending" ON "public"."agendamentos" USING "btree" ("data", "hora") WHERE ("reminder_2h_sent_at" IS NULL);



CREATE INDEX "idx_agendamentos_reminder_pending" ON "public"."agendamentos" USING "btree" ("data", "hora") WHERE ("reminder_24h_sent_at" IS NULL);



CREATE INDEX "idx_agendamentos_status" ON "public"."agendamentos" USING "btree" ("status");



CREATE INDEX "idx_agendamentos_status_concluded" ON "public"."agendamentos" USING "btree" ("status", "concluded_at");



CREATE INDEX "idx_agendamentos_tenant_cliente_concluded" ON "public"."agendamentos" USING "btree" ("tenant_id", "cliente_id", "concluded_at" DESC) WHERE ("concluded_at" IS NOT NULL);



CREATE INDEX "idx_agendamentos_tenant_id" ON "public"."agendamentos" USING "btree" ("tenant_id");



CREATE INDEX "idx_cancelamento_log_agendamento" ON "public"."cancelamento_log" USING "btree" ("agendamento_id");



CREATE INDEX "idx_cancelamento_log_tenant_data" ON "public"."cancelamento_log" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_cancelamento_motivos_tenant" ON "public"."cancelamento_motivos" USING "btree" ("tenant_id") WHERE ("ativo" = true);



CREATE INDEX "idx_cliente_pacotes_lookup" ON "public"."cliente_pacotes" USING "btree" ("tenant_id", "cliente_id", "status", "data_expiracao");



CREATE INDEX "idx_cliente_pacotes_user_id" ON "public"."cliente_pacotes" USING "btree" ("user_id");



CREATE INDEX "idx_cliente_pacotes_validos" ON "public"."cliente_pacotes" USING "btree" ("tenant_id", "cliente_id", "status", "data_expiracao", "quantidade_restante");



CREATE INDEX "idx_clientes_tenant" ON "public"."clientes" USING "btree" ("tenant_id");



CREATE INDEX "idx_clientes_tenant_id" ON "public"."clientes" USING "btree" ("tenant_id");



CREATE INDEX "idx_comissoes_prof_profissional" ON "public"."comissoes_profissionais" USING "btree" ("profissional_id");



CREATE INDEX "idx_comissoes_prof_tenant" ON "public"."comissoes_profissionais" USING "btree" ("tenant_id");



CREATE INDEX "idx_cores_tenant_id" ON "public"."cores" USING "btree" ("tenant_id");



CREATE INDEX "idx_estoque_mov_produto" ON "public"."estoque_movimentacoes" USING "btree" ("produto_id", "created_at" DESC);



CREATE INDEX "idx_estoque_mov_tenant" ON "public"."estoque_movimentacoes" USING "btree" ("tenant_id");



CREATE INDEX "idx_icc_tenant_cliente_created" ON "public"."inactive_customer_campaigns" USING "btree" ("tenant_id", "cliente_id", "created_at" DESC);



CREATE INDEX "idx_icc_tenant_created" ON "public"."inactive_customer_campaigns" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_master_tenant_history_user" ON "public"."master_tenant_history" USING "btree" ("user_id", "accessed_at" DESC);



CREATE INDEX "idx_pacotes_tenant_ativo_created" ON "public"."pacotes" USING "btree" ("tenant_id", "ativo", "created_at" DESC);



CREATE INDEX "idx_pacotes_tenant_servico_ativo" ON "public"."pacotes" USING "btree" ("tenant_id", "servico_id", "ativo");



CREATE INDEX "idx_pacotes_user_id" ON "public"."pacotes" USING "btree" ("user_id");



CREATE INDEX "idx_produtos_tenant" ON "public"."produtos" USING "btree" ("tenant_id");



CREATE INDEX "idx_produtos_tenant_ativo" ON "public"."produtos" USING "btree" ("tenant_id", "ativo");



CREATE INDEX "idx_produtos_tenant_order" ON "public"."produtos" USING "btree" ("tenant_id", "order_index", "nome");



CREATE INDEX "idx_prof_queue_pick" ON "public"."professional_queue" USING "btree" ("tenant_id", "ativo", "last_assigned_at");



CREATE INDEX "idx_profissionais_tenant_id" ON "public"."profissionais" USING "btree" ("tenant_id");



CREATE INDEX "idx_push_subs_prof" ON "public"."push_subscriptions" USING "btree" ("profissional_id");



CREATE INDEX "idx_push_subs_tenant" ON "public"."push_subscriptions" USING "btree" ("tenant_id");



CREATE INDEX "idx_service_recommendations_service" ON "public"."service_recommendations" USING "btree" ("service_id");



CREATE INDEX "idx_service_recommendations_tenant" ON "public"."service_recommendations" USING "btree" ("tenant_id");



CREATE INDEX "idx_servico_cor_config_servico" ON "public"."servico_cor_config" USING "btree" ("servico_id");



CREATE INDEX "idx_servico_cor_config_tenant" ON "public"."servico_cor_config" USING "btree" ("tenant_id");



CREATE INDEX "idx_servicos_tenant_id" ON "public"."servicos" USING "btree" ("tenant_id");



CREATE INDEX "idx_servicos_tenant_order" ON "public"."servicos" USING "btree" ("tenant_id", "order_index", "nome");



CREATE INDEX "idx_tenant_images_order" ON "public"."tenant_images" USING "btree" ("tenant_id", "order");



CREATE INDEX "idx_tenant_images_tenant" ON "public"."tenant_images" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_tenants_display_id" ON "public"."tenants" USING "btree" ("display_id");



CREATE INDEX "idx_tgt_group" ON "public"."tenant_group_tenants" USING "btree" ("group_id");



CREATE INDEX "idx_tgt_group_id" ON "public"."tenant_group_tenants" USING "btree" ("group_id");



CREATE INDEX "idx_tgt_tenant" ON "public"."tenant_group_tenants" USING "btree" ("tenant_id");



CREATE INDEX "idx_tgt_tenant_id" ON "public"."tenant_group_tenants" USING "btree" ("tenant_id");



CREATE INDEX "idx_user_roles_tenant_id" ON "public"."user_roles" USING "btree" ("tenant_id");



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_user_roles_user_multi_access" ON "public"."user_roles" USING "btree" ("user_id") WHERE ("multi_unit_access" = true);



CREATE INDEX "idx_user_roles_user_tenant" ON "public"."user_roles" USING "btree" ("user_id", "tenant_id");



CREATE INDEX "idx_usuarios_ativo" ON "public"."usuarios" USING "btree" ("ativo");



CREATE UNIQUE INDEX "idx_usuarios_login_unique" ON "public"."usuarios" USING "btree" ("lower"("login"));



CREATE INDEX "idx_usuarios_tenant_ativo" ON "public"."usuarios" USING "btree" ("tenant_id", "ativo");



CREATE INDEX "idx_usuarios_tenant_id" ON "public"."usuarios" USING "btree" ("tenant_id");



CREATE INDEX "idx_venda_itens_produto" ON "public"."venda_itens" USING "btree" ("tenant_id", "produto_id");



CREATE INDEX "idx_venda_itens_venda" ON "public"."venda_itens" USING "btree" ("venda_id");



CREATE INDEX "idx_venda_pagamentos_venda" ON "public"."venda_pagamentos" USING "btree" ("venda_id");



CREATE INDEX "idx_vendas_cliente" ON "public"."vendas" USING "btree" ("tenant_id", "cliente_id");



CREATE INDEX "idx_vendas_profissional" ON "public"."vendas" USING "btree" ("tenant_id", "profissional_id");



CREATE INDEX "idx_vendas_status" ON "public"."vendas" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_vendas_tenant_data" ON "public"."vendas" USING "btree" ("tenant_id", "data_venda" DESC);



CREATE INDEX "idx_whatsapp_inbound_seen_received_at" ON "public"."whatsapp_inbound_seen" USING "btree" ("received_at");



CREATE INDEX "idx_whatsapp_sessions_expires_at" ON "public"."whatsapp_sessions" USING "btree" ("expires_at");



CREATE INDEX "idx_whatsapp_sessions_tenant_phone" ON "public"."whatsapp_sessions" USING "btree" ("tenant_id", "telefone", "created_at" DESC);



CREATE UNIQUE INDEX "idx_whatsapp_sessions_token" ON "public"."whatsapp_sessions" USING "btree" ("token");



CREATE UNIQUE INDEX "unique_telefone_tenant" ON "public"."clientes" USING "btree" ("tenant_id", "telefone");



CREATE UNIQUE INDEX "unique_usuario_profissional" ON "public"."usuarios" USING "btree" ("profissional_id") WHERE ("profissional_id" IS NOT NULL);



CREATE UNIQUE INDEX "user_roles_unique_master_admin" ON "public"."user_roles" USING "btree" ("user_id", "role") WHERE ("role" = 'master_admin'::"public"."app_role");



CREATE UNIQUE INDEX "user_roles_unique_per_tenant" ON "public"."user_roles" USING "btree" ("user_id", "tenant_id") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "usuarios_login_lower_idx" ON "public"."usuarios" USING "btree" ("lower"("login"));



CREATE OR REPLACE TRIGGER "trg_agendamentos_updated_at" BEFORE UPDATE ON "public"."agendamentos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_auto_insert_user_role" AFTER INSERT ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."auto_insert_user_role"();



CREATE OR REPLACE TRIGGER "trg_clientes_updated_at" BEFORE UPDATE ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_comissoes_profissionais_updated_at" BEFORE UPDATE ON "public"."comissoes_profissionais" FOR EACH ROW EXECUTE FUNCTION "public"."set_comissoes_profissionais_updated_at"();



CREATE OR REPLACE TRIGGER "trg_fill_agendamento_concluded_at" BEFORE INSERT OR UPDATE OF "status" ON "public"."agendamentos" FOR EACH ROW EXECUTE FUNCTION "public"."fill_agendamento_concluded_at"();



CREATE OR REPLACE TRIGGER "trg_fin_recalc_pagamentos" AFTER INSERT OR DELETE OR UPDATE ON "public"."agendamento_pagamentos" FOR EACH ROW EXECUTE FUNCTION "public"."_trg_recompute_financeiro"();



CREATE OR REPLACE TRIGGER "trg_fin_recalc_produtos" AFTER INSERT OR DELETE OR UPDATE ON "public"."agendamento_produtos" FOR EACH ROW EXECUTE FUNCTION "public"."_trg_recompute_financeiro"();



CREATE OR REPLACE TRIGGER "trg_fin_recalc_servicos" AFTER INSERT OR DELETE OR UPDATE ON "public"."agendamento_servicos" FOR EACH ROW EXECUTE FUNCTION "public"."_trg_recompute_financeiro"();



CREATE OR REPLACE TRIGGER "trg_marcar_origem_externo" BEFORE INSERT ON "public"."agendamentos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_marcar_origem_externo"();



CREATE OR REPLACE TRIGGER "trg_produtos_updated_at" BEFORE UPDATE ON "public"."produtos" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profissionais_updated_at" BEFORE UPDATE ON "public"."profissionais" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_push_externo_after_insert" AFTER INSERT ON "public"."agendamentos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_push_externo_after_insert"();



CREATE OR REPLACE TRIGGER "trg_recalc_pag_del" AFTER DELETE ON "public"."agendamento_pagamentos" FOR EACH ROW EXECUTE FUNCTION "public"."recalcular_status_pagamento_agendamento"();



CREATE OR REPLACE TRIGGER "trg_recalc_pag_ins" AFTER INSERT ON "public"."agendamento_pagamentos" FOR EACH ROW EXECUTE FUNCTION "public"."recalcular_status_pagamento_agendamento"();



CREATE OR REPLACE TRIGGER "trg_recalc_pag_upd" AFTER UPDATE ON "public"."agendamento_pagamentos" FOR EACH ROW EXECUTE FUNCTION "public"."recalcular_status_pagamento_agendamento"();



CREATE OR REPLACE TRIGGER "trg_rodizio_externo_before_insert" BEFORE INSERT ON "public"."agendamentos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_rodizio_externo_before_insert"();



CREATE OR REPLACE TRIGGER "trg_servicos_updated_at" BEFORE UPDATE ON "public"."servicos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tenant_images_limit_10" BEFORE INSERT ON "public"."tenant_images" FOR EACH ROW EXECUTE FUNCTION "public"."tenant_images_limit_10"();



CREATE OR REPLACE TRIGGER "trg_tenant_images_touch" BEFORE UPDATE ON "public"."tenant_images" FOR EACH ROW EXECUTE FUNCTION "public"."tenant_images_touch"();



CREATE OR REPLACE TRIGGER "trg_tenant_settings_updated_at" BEFORE UPDATE ON "public"."tenant_settings" FOR EACH ROW EXECUTE FUNCTION "public"."tenant_settings_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_usuarios_limite_ativos" BEFORE INSERT OR UPDATE OF "ativo", "tenant_id" ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."check_tenant_active_users_limit"();



CREATE OR REPLACE TRIGGER "trg_usuarios_updated_at" BEFORE UPDATE ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."agenda_bloqueios"
    ADD CONSTRAINT "agenda_bloqueios_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agenda_bloqueios"
    ADD CONSTRAINT "agenda_bloqueios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agenda_themes"
    ADD CONSTRAINT "agenda_themes_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendamento_pagamentos"
    ADD CONSTRAINT "agendamento_pagamentos_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "public"."agendamentos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendamento_pagamentos"
    ADD CONSTRAINT "agendamento_pagamentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendamento_produtos"
    ADD CONSTRAINT "agendamento_produtos_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "public"."agendamentos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendamento_produtos"
    ADD CONSTRAINT "agendamento_produtos_estoque_movimentacao_id_fkey" FOREIGN KEY ("estoque_movimentacao_id") REFERENCES "public"."estoque_movimentacoes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendamento_produtos"
    ADD CONSTRAINT "agendamento_produtos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."agendamento_servico_cores"
    ADD CONSTRAINT "agendamento_servico_cores_as_fkey" FOREIGN KEY ("agendamento_servico_id") REFERENCES "public"."agendamento_servicos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendamento_servico_cores"
    ADD CONSTRAINT "agendamento_servico_cores_cor_fkey" FOREIGN KEY ("cor_id") REFERENCES "public"."cores"("id");



ALTER TABLE ONLY "public"."agendamento_servico_cores"
    ADD CONSTRAINT "agendamento_servico_cores_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."agendamento_servicos"
    ADD CONSTRAINT "agendamento_servicos_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "public"."agendamentos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendamento_servicos"
    ADD CONSTRAINT "agendamento_servicos_cliente_pacote_id_fkey" FOREIGN KEY ("cliente_pacote_id") REFERENCES "public"."cliente_pacotes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendamento_servicos"
    ADD CONSTRAINT "agendamento_servicos_cor_id_fkey" FOREIGN KEY ("cor_id") REFERENCES "public"."cores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendamento_servicos"
    ADD CONSTRAINT "agendamento_servicos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."agendamento_servicos"
    ADD CONSTRAINT "agendamento_servicos_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "public"."servicos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."agendamento_servicos"
    ADD CONSTRAINT "agendamento_servicos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."agendamentos"
    ADD CONSTRAINT "agendamentos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."agendamentos"
    ADD CONSTRAINT "agendamentos_prepaid_origin_agendamento_id_fkey" FOREIGN KEY ("prepaid_origin_agendamento_id") REFERENCES "public"."agendamentos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendamentos"
    ADD CONSTRAINT "agendamentos_prepaid_origin_payment_id_fkey" FOREIGN KEY ("prepaid_origin_payment_id") REFERENCES "public"."agendamento_pagamentos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendamentos"
    ADD CONSTRAINT "agendamentos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."agendamentos"
    ADD CONSTRAINT "agendamentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."cancelamento_log"
    ADD CONSTRAINT "cancelamento_log_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "public"."agendamentos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cancelamento_log"
    ADD CONSTRAINT "cancelamento_log_cancelado_por_user_id_fkey" FOREIGN KEY ("cancelado_por_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cancelamento_log"
    ADD CONSTRAINT "cancelamento_log_motivo_id_fkey" FOREIGN KEY ("motivo_id") REFERENCES "public"."cancelamento_motivos"("id");



ALTER TABLE ONLY "public"."cancelamento_log"
    ADD CONSTRAINT "cancelamento_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cancelamento_motivos"
    ADD CONSTRAINT "cancelamento_motivos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_pacotes"
    ADD CONSTRAINT "cliente_pacotes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_pacotes"
    ADD CONSTRAINT "cliente_pacotes_pacote_id_fkey" FOREIGN KEY ("pacote_id") REFERENCES "public"."pacotes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cliente_pacotes"
    ADD CONSTRAINT "cliente_pacotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_pacotes"
    ADD CONSTRAINT "cliente_pacotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."comissoes_profissionais"
    ADD CONSTRAINT "comissoes_profissionais_profissional_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comissoes_profissionais"
    ADD CONSTRAINT "comissoes_profissionais_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cores"
    ADD CONSTRAINT "cores_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "public"."servicos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cores"
    ADD CONSTRAINT "cores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."estoque_movimentacoes"
    ADD CONSTRAINT "estoque_movimentacoes_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."estoque_movimentacoes"
    ADD CONSTRAINT "estoque_movimentacoes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evolution_settings"
    ADD CONSTRAINT "evolution_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historico_atendimentos"
    ADD CONSTRAINT "historico_atendimentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."historico_servicos"
    ADD CONSTRAINT "historico_servicos_historico_id_fkey" FOREIGN KEY ("historico_atendimento_id") REFERENCES "public"."historico_atendimentos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historico_servicos"
    ADD CONSTRAINT "historico_servicos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."inactive_customer_campaigns"
    ADD CONSTRAINT "inactive_customer_campaigns_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inactive_customer_campaigns"
    ADD CONSTRAINT "inactive_customer_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."master_tenant_history"
    ADD CONSTRAINT "master_tenant_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."master_tenant_history"
    ADD CONSTRAINT "master_tenant_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pacotes"
    ADD CONSTRAINT "pacotes_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "public"."servicos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pacotes"
    ADD CONSTRAINT "pacotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pacotes"
    ADD CONSTRAINT "pacotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."produtos"
    ADD CONSTRAINT "produtos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."professional_queue"
    ADD CONSTRAINT "professional_queue_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."professional_queue"
    ADD CONSTRAINT "professional_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."profissional_servicos"
    ADD CONSTRAINT "profissional_servicos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profissional_servicos"
    ADD CONSTRAINT "profissional_servicos_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "public"."servicos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profissional_servicos"
    ADD CONSTRAINT "profissional_servicos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_recommendations"
    ADD CONSTRAINT "service_recommendations_rec_service_fkey" FOREIGN KEY ("recommended_service_id") REFERENCES "public"."servicos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_recommendations"
    ADD CONSTRAINT "service_recommendations_service_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."servicos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_recommendations"
    ADD CONSTRAINT "service_recommendations_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."servico_cor_config"
    ADD CONSTRAINT "servico_cor_config_servico_fkey" FOREIGN KEY ("servico_id") REFERENCES "public"."servicos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."servico_cor_config"
    ADD CONSTRAINT "servico_cor_config_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."servicos"
    ADD CONSTRAINT "servicos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."tenant_group_tenants"
    ADD CONSTRAINT "tenant_group_tenants_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."tenant_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_group_tenants"
    ADD CONSTRAINT "tenant_group_tenants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_images"
    ADD CONSTRAINT "tenant_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_settings"
    ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."venda_itens"
    ADD CONSTRAINT "venda_itens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."venda_itens"
    ADD CONSTRAINT "venda_itens_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venda_pagamentos"
    ADD CONSTRAINT "venda_pagamentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."venda_pagamentos"
    ADD CONSTRAINT "venda_pagamentos_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendas"
    ADD CONSTRAINT "vendas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."vendas"
    ADD CONSTRAINT "vendas_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."vendas"
    ADD CONSTRAINT "vendas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."whatsapp_notifications_log"
    ADD CONSTRAINT "whatsapp_notifications_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



CREATE POLICY "Admins podem atualizar usuarios do mesmo tenant" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING (("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") AND ("tenant_id" IN ( SELECT "ur"."tenant_id"
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'admin'::"public"."app_role")))))) WITH CHECK (("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") AND ("tenant_id" IN ( SELECT "ur"."tenant_id"
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'admin'::"public"."app_role"))))));



CREATE POLICY "Authenticated users can delete servico_cor_config" ON "public"."servico_cor_config" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can insert servico_cor_config" ON "public"."servico_cor_config" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can read servico_cor_config" ON "public"."servico_cor_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can update servico_cor_config" ON "public"."servico_cor_config" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Cliente pacotes por tenant" ON "public"."cliente_pacotes" TO "authenticated" USING (("tenant_id" = "public"."get_user_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_user_tenant_id"()));



CREATE POLICY "Master admin full access to themes" ON "public"."agenda_themes" TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'master_admin'::"public"."app_role")) WITH CHECK ("public"."has_role"("auth"."uid"(), 'master_admin'::"public"."app_role"));



CREATE POLICY "Master admin pode atualizar qualquer usuario" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'master_admin'::"public"."app_role")) WITH CHECK ("public"."has_role"("auth"."uid"(), 'master_admin'::"public"."app_role"));



CREATE POLICY "Pacotes por tenant" ON "public"."pacotes" TO "authenticated" USING (("tenant_id" = "public"."get_user_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_user_tenant_id"()));



CREATE POLICY "Permitir delete para usuários autenticados" ON "public"."agendamento_servico_cores" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Permitir insert para usuários autenticados" ON "public"."agendamento_servico_cores" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Permitir select para usuários autenticados" ON "public"."agendamento_servico_cores" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir update para usuários autenticados" ON "public"."agendamento_servico_cores" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Tenant users can manage their theme" ON "public"."agenda_themes" TO "authenticated" USING (("tenant_id" IN ( SELECT "usuarios"."tenant_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT "usuarios"."tenant_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))));



CREATE POLICY "Usuario pode ler o proprio registro" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "admin_agendamento_servicos_all" ON "public"."agendamento_servicos" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_agendamentos_all" ON "public"."agendamentos" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_clientes_all" ON "public"."clientes" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_cores_all" ON "public"."cores" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_historico_all" ON "public"."historico_atendimentos" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_historico_servicos_all" ON "public"."historico_servicos" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_profissionais_all" ON "public"."profissionais" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_profissional_servicos_all" ON "public"."profissional_servicos" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_servicos_all" ON "public"."servicos" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_user_roles_all" ON "public"."user_roles" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admin_usuarios_all" ON "public"."usuarios" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "admins can manage pacotes" ON "public"."pacotes" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "pacotes"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'master_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'master_admin'::"public"."app_role")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "pacotes"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'master_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'master_admin'::"public"."app_role"))))));



CREATE POLICY "ag_pag_delete_via_agendamento" ON "public"."agendamento_pagamentos" FOR DELETE TO "authenticated" USING (("agendamento_id" IN ( SELECT "agendamentos"."id"
   FROM "public"."agendamentos")));



CREATE POLICY "ag_pag_insert_via_agendamento" ON "public"."agendamento_pagamentos" FOR INSERT TO "authenticated" WITH CHECK (("agendamento_id" IN ( SELECT "a"."id"
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_pagamentos"."agendamento_id") AND ("a"."tenant_id" = "agendamento_pagamentos"."tenant_id")))));



CREATE POLICY "ag_pag_select_via_agendamento" ON "public"."agendamento_pagamentos" FOR SELECT TO "authenticated" USING (("agendamento_id" IN ( SELECT "agendamentos"."id"
   FROM "public"."agendamentos")));



CREATE POLICY "ag_pag_update_via_agendamento" ON "public"."agendamento_pagamentos" FOR UPDATE TO "authenticated" USING (("agendamento_id" IN ( SELECT "agendamentos"."id"
   FROM "public"."agendamentos"))) WITH CHECK (("agendamento_id" IN ( SELECT "a"."id"
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_pagamentos"."agendamento_id") AND ("a"."tenant_id" = "agendamento_pagamentos"."tenant_id")))));



ALTER TABLE "public"."agenda_bloqueios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agenda_bloqueios_delete_v7" ON "public"."agenda_bloqueios" FOR DELETE USING ((("auth"."uid"() IS NOT NULL) AND ("public"."agenda_is_admin_tenant_v7"("tenant_id") OR "public"."agenda_is_profissional_atual_v7"("tenant_id", "profissional_id"))));



CREATE POLICY "agenda_bloqueios_insert_v7" ON "public"."agenda_bloqueios" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("public"."agenda_is_admin_tenant_v7"("tenant_id") OR "public"."agenda_is_profissional_atual_v7"("tenant_id", "profissional_id"))));



CREATE POLICY "agenda_bloqueios_select_v7" ON "public"."agenda_bloqueios" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("public"."agenda_is_admin_tenant_v7"("tenant_id") OR "public"."agenda_is_profissional_atual_v7"("tenant_id", "profissional_id"))));



CREATE POLICY "agenda_bloqueios_update_v7" ON "public"."agenda_bloqueios" FOR UPDATE USING ((("auth"."uid"() IS NOT NULL) AND ("public"."agenda_is_admin_tenant_v7"("tenant_id") OR "public"."agenda_is_profissional_atual_v7"("tenant_id", "profissional_id")))) WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("public"."agenda_is_admin_tenant_v7"("tenant_id") OR "public"."agenda_is_profissional_atual_v7"("tenant_id", "profissional_id"))));



ALTER TABLE "public"."agenda_themes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agenda_themes_public_read" ON "public"."agenda_themes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."agendamento_pagamentos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agendamento_produtos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agendamento_produtos_delete" ON "public"."agendamento_produtos" FOR DELETE TO "authenticated" USING ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "agendamento_produtos_insert" ON "public"."agendamento_produtos" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "agendamento_produtos_select" ON "public"."agendamento_produtos" FOR SELECT TO "authenticated" USING ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "agendamento_produtos_update" ON "public"."agendamento_produtos" FOR UPDATE TO "authenticated" USING ("public"."can_access_tenant"("tenant_id")) WITH CHECK ("public"."can_access_tenant"("tenant_id"));



ALTER TABLE "public"."agendamento_servico_cores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agendamento_servicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agendamento_servicos_select_role_aware" ON "public"."agendamento_servicos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_servicos"."agendamento_id") AND "public"."can_read_profissional"("a"."tenant_id", "a"."profissional_id")))));



CREATE POLICY "agendamento_servicos_select_role_based" ON "public"."agendamento_servicos" FOR SELECT TO "authenticated" USING (("public"."is_admin_for_tenant"("tenant_id") OR ("profissional_id" = "public"."current_user_profissional_id"())));



CREATE POLICY "agendamento_servicos_tenant_isolation" ON "public"."agendamento_servicos" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "agendamento_servicos_write_role_based" ON "public"."agendamento_servicos" TO "authenticated" USING (("public"."is_admin_for_tenant"("tenant_id") OR ("profissional_id" = "public"."current_user_profissional_id"()))) WITH CHECK (("public"."is_admin_for_tenant"("tenant_id") OR ("profissional_id" = "public"."current_user_profissional_id"())));



ALTER TABLE "public"."agendamentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agendamentos_select_role_aware" ON "public"."agendamentos" FOR SELECT TO "authenticated" USING ("public"."can_read_profissional"("tenant_id", "profissional_id"));



CREATE POLICY "agendamentos_tenant_isolation" ON "public"."agendamentos" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "agendamentos_write_role_aware" ON "public"."agendamentos" TO "authenticated" USING ("public"."can_read_profissional"("tenant_id", "profissional_id")) WITH CHECK ("public"."can_read_profissional"("tenant_id", "profissional_id"));



CREATE POLICY "allow insert push subscriptions" ON "public"."push_subscriptions" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."backfill_balcao_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_agendamento_pagamentos_balcao" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_agendamento_pagamentos_observacao_desconto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_agendamento_produtos_balcao" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_agendamentos_balcao" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_comissoes_desconto_retroativo_agendamentos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_comissoes_desconto_retroativo_pagamentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bloq_colab_concluido_del_agendamento_pagamentos_v4" ON "public"."agendamento_pagamentos" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_pagamentos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"])))))));



CREATE POLICY "bloq_colab_concluido_del_agendamento_produtos_v4" ON "public"."agendamento_produtos" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_produtos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"])))))));



CREATE POLICY "bloq_colab_concluido_del_agendamento_servicos_v4" ON "public"."agendamento_servicos" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_servicos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"])))))));



CREATE POLICY "bloq_colab_concluido_ins_agendamento_pagamentos_v4" ON "public"."agendamento_pagamentos" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_pagamentos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"])))))));



CREATE POLICY "bloq_colab_concluido_ins_agendamento_produtos_v4" ON "public"."agendamento_produtos" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_produtos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"])))))));



CREATE POLICY "bloq_colab_concluido_ins_agendamento_servicos_v4" ON "public"."agendamento_servicos" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_servicos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"])))))));



CREATE POLICY "bloq_colab_concluido_upd_agendamento_pagamentos_v4" ON "public"."agendamento_pagamentos" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_pagamentos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"]))))))) WITH CHECK (true);



CREATE POLICY "bloq_colab_concluido_upd_agendamento_produtos_v4" ON "public"."agendamento_produtos" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_produtos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"]))))))) WITH CHECK (true);



CREATE POLICY "bloq_colab_concluido_upd_agendamento_servicos_v4" ON "public"."agendamento_servicos" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((NOT (EXISTS ( SELECT 1
   FROM "public"."agendamentos" "a"
  WHERE (("a"."id" = "agendamento_servicos"."agendamento_id") AND "public"."is_current_user_colaborador_for_tenant"("a"."tenant_id") AND ("lower"(COALESCE(("a"."status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"]))))))) WITH CHECK (true);



CREATE POLICY "bloq_colab_concluido_update_agendamentos_v4" ON "public"."agendamentos" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((NOT ("public"."is_current_user_colaborador_for_tenant"("tenant_id") AND ("lower"(COALESCE(("status")::"text", ''::"text")) = ANY (ARRAY['concluido'::"text", 'concluído'::"text", 'finalizado'::"text"]))))) WITH CHECK (true);



ALTER TABLE "public"."cancelamento_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cancelamento_motivos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cliente_pacotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cliente_pacotes_delete_own" ON "public"."cliente_pacotes" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "cliente_pacotes_insert_own" ON "public"."cliente_pacotes" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "cliente_pacotes_select_own" ON "public"."cliente_pacotes" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "cliente_pacotes_update_own" ON "public"."cliente_pacotes" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_tenant_isolation" ON "public"."clientes" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "colaborador_agendamento_servicos_insert" ON "public"."agendamento_servicos" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_agendamento_servicos_select" ON "public"."agendamento_servicos" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_agendamento_servicos_update" ON "public"."agendamento_servicos" FOR UPDATE TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"())) WITH CHECK ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_agendamentos_insert" ON "public"."agendamentos" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_agendamentos_select" ON "public"."agendamentos" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_agendamentos_update" ON "public"."agendamentos" FOR UPDATE TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"())) WITH CHECK ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_clientes_select" ON "public"."clientes" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_cores_select" ON "public"."cores" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_historico_select" ON "public"."historico_atendimentos" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_historico_servicos_select" ON "public"."historico_servicos" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_profissionais_select" ON "public"."profissionais" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_profissional_servicos_select" ON "public"."profissional_servicos" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "colaborador_servicos_select" ON "public"."servicos" FOR SELECT TO "authenticated" USING ("public"."is_colaborador"("auth"."uid"()));



CREATE POLICY "comissoes_delete" ON "public"."comissoes_profissionais" FOR DELETE TO "authenticated" USING (("public"."is_master_admin"() OR ("tenant_id" = "public"."get_current_tenant_id"())));



CREATE POLICY "comissoes_delete_tenant" ON "public"."comissoes_profissionais" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "comissoes_insert" ON "public"."comissoes_profissionais" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_master_admin"() OR ("tenant_id" = "public"."get_current_tenant_id"())));



CREATE POLICY "comissoes_insert_tenant" ON "public"."comissoes_profissionais" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."comissoes_profissionais" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comissoes_profissionais_delete" ON "public"."comissoes_profissionais" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "comissoes_profissionais_insert" ON "public"."comissoes_profissionais" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "comissoes_profissionais_select" ON "public"."comissoes_profissionais" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "comissoes_profissionais_update" ON "public"."comissoes_profissionais" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "comissoes_select" ON "public"."comissoes_profissionais" FOR SELECT TO "authenticated" USING (("public"."is_master_admin"() OR ("tenant_id" = "public"."get_current_tenant_id"())));



CREATE POLICY "comissoes_select_tenant" ON "public"."comissoes_profissionais" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "comissoes_update" ON "public"."comissoes_profissionais" FOR UPDATE TO "authenticated" USING (("public"."is_master_admin"() OR ("tenant_id" = "public"."get_current_tenant_id"()))) WITH CHECK (("public"."is_master_admin"() OR ("tenant_id" = "public"."get_current_tenant_id"())));



CREATE POLICY "comissoes_update_tenant" ON "public"."comissoes_profissionais" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."cores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cores_tenant_isolation" ON "public"."cores" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



ALTER TABLE "public"."custom_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_reports_read_admins" ON "public"."custom_reports" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['master_admin'::"public"."app_role", 'admin'::"public"."app_role"]))))));



CREATE POLICY "estoque_delete_tenant" ON "public"."estoque_movimentacoes" FOR DELETE TO "authenticated" USING ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "estoque_insert_tenant" ON "public"."estoque_movimentacoes" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_access_tenant"("tenant_id"));



ALTER TABLE "public"."estoque_movimentacoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "estoque_select_tenant" ON "public"."estoque_movimentacoes" FOR SELECT TO "authenticated" USING ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "estoque_update_tenant" ON "public"."estoque_movimentacoes" FOR UPDATE TO "authenticated" USING ("public"."can_access_tenant"("tenant_id")) WITH CHECK ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "evo_settings_rw" ON "public"."evolution_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "evolution_settings"."tenant_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "evolution_settings"."tenant_id")))));



ALTER TABLE "public"."evolution_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."historico_atendimentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "historico_atendimentos_tenant_isolation" ON "public"."historico_atendimentos" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "historico_select_role_aware" ON "public"."historico_atendimentos" FOR SELECT TO "authenticated" USING ("public"."can_read_profissional"("tenant_id", "profissional_id"));



ALTER TABLE "public"."historico_servicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "historico_servicos_select_role_aware" ON "public"."historico_servicos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."historico_atendimentos" "h"
  WHERE (("h"."id" = "historico_servicos"."historico_atendimento_id") AND "public"."can_read_profissional"("h"."tenant_id", "h"."profissional_id")))));



CREATE POLICY "historico_servicos_tenant_isolation" ON "public"."historico_servicos" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "icc_select_own_tenant" ON "public"."inactive_customer_campaigns" FOR SELECT TO "authenticated" USING (("tenant_id" IN ( SELECT "ur"."tenant_id"
   FROM "public"."user_roles" "ur"
  WHERE ("ur"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."inactive_customer_campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "log_select_admin" ON "public"."cancelamento_log" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND (("user_roles"."role")::"text" = 'master_admin'::"text")))) OR "public"."has_role_in_tenant"("auth"."uid"(), 'admin'::"text", "tenant_id")));



CREATE POLICY "master_admin full access tenants" ON "public"."tenants" TO "authenticated" USING ("public"."is_master_admin"("auth"."uid"())) WITH CHECK ("public"."is_master_admin"("auth"."uid"()));



ALTER TABLE "public"."master_tenant_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_tenant_history_policy" ON "public"."master_tenant_history" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "motivos_admin_write" ON "public"."cancelamento_motivos" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND (("user_roles"."role")::"text" = 'master_admin'::"text")))) OR (("tenant_id" IS NOT NULL) AND "public"."has_role_in_tenant"("auth"."uid"(), 'admin'::"text", "tenant_id")))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND (("user_roles"."role")::"text" = 'master_admin'::"text")))) OR (("tenant_id" IS NOT NULL) AND "public"."has_role_in_tenant"("auth"."uid"(), 'admin'::"text", "tenant_id"))));



CREATE POLICY "motivos_select" ON "public"."cancelamento_motivos" FOR SELECT TO "authenticated" USING ((("tenant_id" IS NULL) OR ("tenant_id" IN ( SELECT "usuarios"."tenant_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND (("user_roles"."role")::"text" = 'master_admin'::"text"))))));



CREATE POLICY "mth_insert_self" ON "public"."master_tenant_history" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "mth_select_self" ON "public"."master_tenant_history" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."pacotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pacotes_delete_own" ON "public"."pacotes" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "pacotes_insert_own" ON "public"."pacotes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "pacotes_select_own" ON "public"."pacotes" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "pacotes_update_own" ON "public"."pacotes" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."produtos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "produtos_insert_same_tenant" ON "public"."produtos" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "produtos_select_same_tenant" ON "public"."produtos" FOR SELECT TO "authenticated" USING ("public"."can_access_tenant"("tenant_id"));



CREATE POLICY "produtos_update_same_tenant" ON "public"."produtos" FOR UPDATE TO "authenticated" USING ("public"."can_access_tenant"("tenant_id")) WITH CHECK ("public"."can_access_tenant"("tenant_id"));



ALTER TABLE "public"."professional_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profissionais" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profissionais_tenant_isolation" ON "public"."profissionais" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



ALTER TABLE "public"."profissional_servicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profissional_servicos_tenant_isolation" ON "public"."profissional_servicos" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "push_subs_delete_own" ON "public"."push_subscriptions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "push_subs_insert_own" ON "public"."push_subscriptions" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "push_subs_select_own" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_recommendations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_recommendations delete tenant" ON "public"."service_recommendations" FOR DELETE TO "authenticated" USING (("tenant_id" IN ( SELECT "ur"."tenant_id"
   FROM "public"."user_roles" "ur"
  WHERE ("ur"."user_id" = "auth"."uid"()))));



CREATE POLICY "service_recommendations insert tenant" ON "public"."service_recommendations" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" IN ( SELECT "ur"."tenant_id"
   FROM "public"."user_roles" "ur"
  WHERE ("ur"."user_id" = "auth"."uid"()))));



CREATE POLICY "service_recommendations select tenant" ON "public"."service_recommendations" FOR SELECT TO "authenticated" USING (("tenant_id" IN ( SELECT "ur"."tenant_id"
   FROM "public"."user_roles" "ur"
  WHERE ("ur"."user_id" = "auth"."uid"()))));



CREATE POLICY "service_recommendations update tenant" ON "public"."service_recommendations" FOR UPDATE TO "authenticated" USING (("tenant_id" IN ( SELECT "ur"."tenant_id"
   FROM "public"."user_roles" "ur"
  WHERE ("ur"."user_id" = "auth"."uid"()))));



CREATE POLICY "service_recommendations_delete" ON "public"."service_recommendations" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."current_user_tenant_id"()));



CREATE POLICY "service_recommendations_delete_authenticated" ON "public"."service_recommendations" FOR DELETE TO "authenticated" USING ("public"."can_manage_service_recommendations"("tenant_id"));



CREATE POLICY "service_recommendations_insert" ON "public"."service_recommendations" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."current_user_tenant_id"()));



CREATE POLICY "service_recommendations_insert_authenticated" ON "public"."service_recommendations" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_manage_service_recommendations"("tenant_id") AND (EXISTS ( SELECT 1
   FROM "public"."servicos" "s"
  WHERE (("s"."id" = "service_recommendations"."service_id") AND ("s"."tenant_id" = "service_recommendations"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."servicos" "s"
  WHERE (("s"."id" = "service_recommendations"."recommended_service_id") AND ("s"."tenant_id" = "service_recommendations"."tenant_id"))))));



CREATE POLICY "service_recommendations_public_read" ON "public"."service_recommendations" FOR SELECT TO "anon" USING (true);



CREATE POLICY "service_recommendations_select" ON "public"."service_recommendations" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_user_tenant_id"()));



CREATE POLICY "service_recommendations_select_authenticated" ON "public"."service_recommendations" FOR SELECT TO "authenticated" USING ((("tenant_id" = "public"."current_user_tenant_id"()) OR "public"."can_manage_service_recommendations"("tenant_id")));



CREATE POLICY "service_recommendations_update" ON "public"."service_recommendations" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."current_user_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_user_tenant_id"()));



CREATE POLICY "service_recommendations_update_authenticated" ON "public"."service_recommendations" FOR UPDATE TO "authenticated" USING ("public"."can_manage_service_recommendations"("tenant_id")) WITH CHECK (("public"."can_manage_service_recommendations"("tenant_id") AND (EXISTS ( SELECT 1
   FROM "public"."servicos" "s"
  WHERE (("s"."id" = "service_recommendations"."service_id") AND ("s"."tenant_id" = "service_recommendations"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."servicos" "s"
  WHERE (("s"."id" = "service_recommendations"."recommended_service_id") AND ("s"."tenant_id" = "service_recommendations"."tenant_id"))))));



ALTER TABLE "public"."servico_cor_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."servicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "servicos_tenant_isolation" ON "public"."servicos" TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "tenant members can create cliente_pacotes" ON "public"."cliente_pacotes" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "cliente_pacotes"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role", 'master_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'master_admin'::"public"."app_role"))))));



CREATE POLICY "tenant members can read cliente_pacotes" ON "public"."cliente_pacotes" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "cliente_pacotes"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role", 'master_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'master_admin'::"public"."app_role"))))));



CREATE POLICY "tenant members can read pacotes" ON "public"."pacotes" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "pacotes"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role", 'master_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'master_admin'::"public"."app_role"))))));



CREATE POLICY "tenant members can update cliente_pacotes" ON "public"."cliente_pacotes" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "cliente_pacotes"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role", 'master_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'master_admin'::"public"."app_role")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "cliente_pacotes"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role", 'master_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'master_admin'::"public"."app_role"))))));



ALTER TABLE "public"."tenant_group_tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_images" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_images_admin_delete" ON "public"."tenant_images" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND (("ur"."role" = 'master_admin'::"public"."app_role") OR (("ur"."tenant_id" = "tenant_images"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role"]))))))));



CREATE POLICY "tenant_images_admin_insert" ON "public"."tenant_images" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND (("ur"."role" = 'master_admin'::"public"."app_role") OR (("ur"."tenant_id" = "tenant_images"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role"]))))))));



CREATE POLICY "tenant_images_admin_update" ON "public"."tenant_images" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND (("ur"."role" = 'master_admin'::"public"."app_role") OR (("ur"."tenant_id" = "tenant_images"."tenant_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'colaborador'::"public"."app_role"]))))))));



CREATE POLICY "tenant_images_public_read" ON "public"."tenant_images" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."tenant_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_settings_delete" ON "public"."tenant_settings" FOR DELETE TO "authenticated" USING ("public"."can_manage_tenant_settings"("tenant_id"));



CREATE POLICY "tenant_settings_insert" ON "public"."tenant_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_tenant_settings"("tenant_id"));



CREATE POLICY "tenant_settings_select" ON "public"."tenant_settings" FOR SELECT TO "authenticated" USING ("public"."can_read_tenant_settings"("tenant_id"));



CREATE POLICY "tenant_settings_update" ON "public"."tenant_settings" FOR UPDATE TO "authenticated" USING ("public"."can_manage_tenant_settings"("tenant_id")) WITH CHECK ("public"."can_manage_tenant_settings"("tenant_id"));



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenants_select_for_member" ON "public"."tenants" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND (("ur"."tenant_id" = "tenants"."id") OR ("ur"."role" = 'master_admin'::"public"."app_role"))))));



CREATE POLICY "tenants_select_own" ON "public"."tenants" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."tenant_id" = "tenants"."id")))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND (("r"."role" = 'master_admin'::"public"."app_role") OR ("r"."tenant_id" = "tenants"."id")))))));



CREATE POLICY "tg_select_public" ON "public"."tenant_groups" FOR SELECT TO "authenticated", "anon" USING (("active" = true));



CREATE POLICY "tgt_select_public" ON "public"."tenant_group_tenants" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."tenant_groups" "g"
  WHERE (("g"."id" = "tenant_group_tenants"."group_id") AND ("g"."active" = true)))));



CREATE POLICY "user_own_profile_select" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "user_own_profile_update" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "user_own_roles_select" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_insert" ON "public"."user_roles" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR (("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())) AND "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"))));



CREATE POLICY "user_roles_select" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_master_admin"("auth"."uid"()) OR (("tenant_id" IS NOT NULL) AND ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())) AND "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"))));



CREATE POLICY "user_roles_select_self" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_roles_update" ON "public"."user_roles" FOR UPDATE TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR (("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())) AND "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role")))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR (("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"())) AND "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"))));



CREATE POLICY "users can read own tenant" ON "public"."tenants" FOR SELECT TO "authenticated" USING ((("id" = "public"."get_user_tenant_id"("auth"."uid"())) OR "public"."is_master_admin"("auth"."uid"())));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_insert" ON "public"."usuarios" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "usuarios_select" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("tenant_id" = "public"."get_user_tenant_id"("auth"."uid"()))));



CREATE POLICY "usuarios_update" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING (("public"."is_master_admin"("auth"."uid"()) OR ("id" = "auth"."uid"()))) WITH CHECK (("public"."is_master_admin"("auth"."uid"()) OR ("id" = "auth"."uid"())));



ALTER TABLE "public"."venda_itens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venda_itens_select_tenant" ON "public"."venda_itens" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."venda_pagamentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venda_pagamentos_select_tenant" ON "public"."venda_pagamentos" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."vendas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendas_select_tenant" ON "public"."vendas" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "wa_log_read" ON "public"."whatsapp_notifications_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."tenant_id" = "whatsapp_notifications_log"."tenant_id")))));



ALTER TABLE "public"."whatsapp_inbound_seen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_notifications_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_sessions_no_public" ON "public"."whatsapp_sessions" TO "authenticated" USING (false) WITH CHECK (false);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."_fin_parse_marker"("p_obs" "text", "p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_fin_parse_marker"("p_obs" "text", "p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_fin_parse_marker"("p_obs" "text", "p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_trg_recompute_financeiro"() TO "anon";
GRANT ALL ON FUNCTION "public"."_trg_recompute_financeiro"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_trg_recompute_financeiro"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_venda_assert_tenant"("p_venda_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_venda_assert_tenant"("p_venda_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_venda_assert_tenant"("p_venda_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_venda_mover_estoque"("p_venda_id" "uuid", "p_tipo" "public"."estoque_mov_tipo") TO "anon";
GRANT ALL ON FUNCTION "public"."_venda_mover_estoque"("p_venda_id" "uuid", "p_tipo" "public"."estoque_mov_tipo") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_venda_mover_estoque"("p_venda_id" "uuid", "p_tipo" "public"."estoque_mov_tipo") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_debug_auth_v6"() TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_debug_auth_v6"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_debug_auth_v6"() TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_debug_bloqueios_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_debug_bloqueios_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_debug_bloqueios_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v4"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v4"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v4"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v5"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v5"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v5"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v6"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v6"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_eh_admin_tenant_v6"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_eh_profissional_atual_v5"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_eh_profissional_atual_v5"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_eh_profissional_atual_v5"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_eh_profissional_atual_v6"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_eh_profissional_atual_v6"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_eh_profissional_atual_v6"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_is_admin_tenant_v7"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_is_admin_tenant_v7"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_is_admin_tenant_v7"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_is_master_admin_v7"() TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_is_master_admin_v7"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_is_master_admin_v7"() TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_is_profissional_atual_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_is_profissional_atual_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_is_profissional_atual_v7"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v4"() TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v4"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v4"() TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v5"() TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v5"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v5"() TO "service_role";



GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v6"() TO "anon";
GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v6"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."agenda_usuario_atual_v6"() TO "service_role";



GRANT ALL ON FUNCTION "public"."agendamento_esta_concluido"("_ag_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agendamento_esta_concluido"("_ag_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agendamento_esta_concluido"("_ag_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_insert_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_insert_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_insert_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_tenant"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_tenant"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_tenant"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_tenant_from_path"("_tenant_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_tenant_from_path"("_tenant_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_tenant_from_path"("_tenant_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_service_recommendations"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_service_recommendations"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_service_recommendations"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_tenant_settings"("p_tenant" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_tenant_settings"("p_tenant" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_tenant_settings"("p_tenant" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_read_profissional"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_profissional"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_profissional"("_tenant_id" "uuid", "_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_read_tenant_settings"("p_tenant" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_tenant_settings"("p_tenant" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_tenant_settings"("p_tenant" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_agendamento_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_agendamento_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_agendamento_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancelar_venda"("p_venda_id" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancelar_venda"("p_venda_id" "uuid", "p_motivo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cancelar_venda"("p_venda_id" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancelar_venda"("p_venda_id" "uuid", "p_motivo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_tenant_active_users_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_tenant_active_users_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_tenant_active_users_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."comissoes_v2_kpis"("p_tenant_id" "uuid", "p_profissional_id" "uuid", "p_inicio" "date", "p_fim" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."comissoes_v2_kpis"("p_tenant_id" "uuid", "p_profissional_id" "uuid", "p_inicio" "date", "p_fim" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."comissoes_v2_kpis"("p_tenant_id" "uuid", "p_profissional_id" "uuid", "p_inicio" "date", "p_fim" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."comissoes_v2_kpis"("p_tenant_id" "uuid", "p_profissional_id" "uuid", "p_inicio" "date", "p_fim" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."comissoes_v2_snapshot"("p_inicio" "date", "p_fim" "date", "p_profissional_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."comissoes_v2_snapshot"("p_inicio" "date", "p_fim" "date", "p_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."comissoes_v2_snapshot"("p_inicio" "date", "p_fim" "date", "p_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."comissoes_v2_snapshot"("p_inicio" "date", "p_fim" "date", "p_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_profissional_id" "uuid", "_data" "date", "_hora" "text", "_servico_id" "uuid", "_duracao" integer, "_preco" numeric, "_pacote_acao" "text", "_cliente_pacote_id" "uuid", "_pacote_def_id" "uuid", "_servicos_extras" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_profissional_id" "uuid", "_data" "date", "_hora" "text", "_servico_id" "uuid", "_duracao" integer, "_preco" numeric, "_pacote_acao" "text", "_cliente_pacote_id" "uuid", "_pacote_def_id" "uuid", "_servicos_extras" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_public_agendamento"("_tenant_id" "uuid", "_cliente_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_profissional_id" "uuid", "_data" "date", "_hora" "text", "_servico_id" "uuid", "_duracao" integer, "_preco" numeric, "_pacote_acao" "text", "_cliente_pacote_id" "uuid", "_pacote_def_id" "uuid", "_servicos_extras" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_public_booking"("_tenant_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_servico_id" "uuid", "_profissional_id" "uuid", "_data" "date", "_hora" time without time zone, "_duracao" integer, "_preco" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."create_public_booking"("_tenant_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_servico_id" "uuid", "_profissional_id" "uuid", "_data" "date", "_hora" time without time zone, "_duracao" integer, "_preco" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_public_booking"("_tenant_id" "uuid", "_cliente_nome" "text", "_cliente_telefone" "text", "_servico_id" "uuid", "_profissional_id" "uuid", "_data" "date", "_hora" time without time zone, "_duracao" integer, "_preco" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_public_cliente"("_tenant_id" "uuid", "_nome" "text", "_telefone" "text", "_nascimento" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."create_public_cliente"("_tenant_id" "uuid", "_nome" "text", "_telefone" "text", "_nascimento" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_public_cliente"("_tenant_id" "uuid", "_nome" "text", "_telefone" "text", "_nascimento" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_info"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_info"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_info"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_profissional"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_profissional"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_profissional"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_profissional_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_profissional_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_profissional_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_tenant_id"() TO "service_role";



GRANT ALL ON TABLE "public"."agendamento_pagamentos" TO "anon";
GRANT ALL ON TABLE "public"."agendamento_pagamentos" TO "authenticated";
GRANT ALL ON TABLE "public"."agendamento_pagamentos" TO "service_role";



GRANT ALL ON TABLE "public"."agendamento_produtos" TO "anon";
GRANT ALL ON TABLE "public"."agendamento_produtos" TO "authenticated";
GRANT ALL ON TABLE "public"."agendamento_produtos" TO "service_role";



GRANT ALL ON TABLE "public"."agendamento_servicos" TO "anon";
GRANT ALL ON TABLE "public"."agendamento_servicos" TO "authenticated";
GRANT ALL ON TABLE "public"."agendamento_servicos" TO "service_role";



GRANT ALL ON TABLE "public"."agendamentos" TO "anon";
GRANT ALL ON TABLE "public"."agendamentos" TO "authenticated";
GRANT ALL ON TABLE "public"."agendamentos" TO "service_role";



GRANT ALL ON TABLE "public"."cliente_pacotes" TO "anon";
GRANT ALL ON TABLE "public"."cliente_pacotes" TO "authenticated";
GRANT ALL ON TABLE "public"."cliente_pacotes" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "anon";
GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."comissoes_profissionais" TO "anon";
GRANT ALL ON TABLE "public"."comissoes_profissionais" TO "authenticated";
GRANT ALL ON TABLE "public"."comissoes_profissionais" TO "service_role";



GRANT ALL ON TABLE "public"."pacotes" TO "anon";
GRANT ALL ON TABLE "public"."pacotes" TO "authenticated";
GRANT ALL ON TABLE "public"."pacotes" TO "service_role";



GRANT ALL ON TABLE "public"."produtos" TO "anon";
GRANT ALL ON TABLE "public"."produtos" TO "authenticated";
GRANT ALL ON TABLE "public"."produtos" TO "service_role";



GRANT ALL ON TABLE "public"."profissionais" TO "anon";
GRANT ALL ON TABLE "public"."profissionais" TO "authenticated";
GRANT ALL ON TABLE "public"."profissionais" TO "service_role";



GRANT ALL ON TABLE "public"."servicos" TO "anon";
GRANT ALL ON TABLE "public"."servicos" TO "authenticated";
GRANT ALL ON TABLE "public"."servicos" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_v2_eventos" TO "anon";
GRANT ALL ON TABLE "public"."dashboard_v2_eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboard_v2_eventos" TO "service_role";



GRANT ALL ON FUNCTION "public"."dashboard_v2_auditoria"("p_tenant" "uuid", "p_ini" "date", "p_fim" "date", "p_prof" "uuid", "p_metrica" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."dashboard_v2_auditoria"("p_tenant" "uuid", "p_ini" "date", "p_fim" "date", "p_prof" "uuid", "p_metrica" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dashboard_v2_auditoria"("p_tenant" "uuid", "p_ini" "date", "p_fim" "date", "p_prof" "uuid", "p_metrica" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dashboard_v2_snapshot"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dashboard_v2_snapshot"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."dashboard_v2_snapshot"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dashboard_v2_snapshot"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dashboard_v2_snapshot_base"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dashboard_v2_snapshot_base"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."dashboard_v2_snapshot_base"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dashboard_v2_snapshot_base"("p_tenant_id" "uuid", "p_data_inicio" "date", "p_data_fim" "date", "p_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_max_usuarios_ativos"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_max_usuarios_ativos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_max_usuarios_ativos"() TO "service_role";



GRANT ALL ON FUNCTION "public"."excluir_agendamento_com_historico"("_agendamento_id" "uuid", "_status" "public"."agendamento_status") TO "anon";
GRANT ALL ON FUNCTION "public"."excluir_agendamento_com_historico"("_agendamento_id" "uuid", "_status" "public"."agendamento_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."excluir_agendamento_com_historico"("_agendamento_id" "uuid", "_status" "public"."agendamento_status") TO "service_role";



GRANT ALL ON FUNCTION "public"."fill_agendamento_concluded_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fill_agendamento_concluded_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fill_agendamento_concluded_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_agendamento_auto_end_at"("p_agendamento_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_agendamento_auto_end_at"("p_agendamento_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_agendamento_auto_end_at"("p_agendamento_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_agendamento_duracao_total_min"("p_agendamento_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_agendamento_duracao_total_min"("p_agendamento_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_agendamento_duracao_total_min"("p_agendamento_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_marcar_origem_externo"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_marcar_origem_externo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_marcar_origem_externo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_purge_expired_whatsapp_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_purge_expired_whatsapp_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_purge_expired_whatsapp_sessions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_push_externo_after_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_push_externo_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_push_externo_after_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_reconcile_auto_concluded_at"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_reconcile_auto_concluded_at"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_reconcile_auto_concluded_at"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_rodizio_externo_before_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_rodizio_externo_before_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_rodizio_externo_before_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_comissoes_dashboard"("p_inicio" "date", "p_fim" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_comissoes_dashboard"("p_inicio" "date", "p_fim" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_comissoes_dashboard"("p_inicio" "date", "p_fim" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_comissoes_dashboard"("p_inicio" "date", "p_fim" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_tenant_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_agenda_bloqueios"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_agenda_bloqueios"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_agenda_bloqueios"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_agenda_bloqueios"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) TO "service_role";



GRANT ALL ON TABLE "public"."agenda_themes" TO "anon";
GRANT ALL ON TABLE "public"."agenda_themes" TO "authenticated";
GRANT ALL ON TABLE "public"."agenda_themes" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_agenda_theme"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_agenda_theme"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_agenda_theme"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_booking_professionals"("_tenant_id" "uuid", "_servico_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_booking_professionals"("_tenant_id" "uuid", "_servico_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_booking_professionals"("_tenant_id" "uuid", "_servico_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_booking_services"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_booking_services"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_booking_services"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_booking_tenant"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_booking_tenant"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_booking_tenant"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_busy_slots"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_busy_slots"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_busy_slots"("_tenant_id" "uuid", "_data" "date", "_profissional_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_client_agendamentos"("_tenant_id" "uuid", "_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_client_agendamentos"("_tenant_id" "uuid", "_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_client_agendamentos"("_tenant_id" "uuid", "_cliente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_cliente_by_telefone"("_tenant_id" "uuid", "_telefone_digits" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_cliente_by_telefone"("_tenant_id" "uuid", "_telefone_digits" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_cliente_by_telefone"("_tenant_id" "uuid", "_telefone_digits" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_cliente_pacotes_ativos"("_tenant_id" "uuid", "_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_cliente_pacotes_ativos"("_tenant_id" "uuid", "_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_cliente_pacotes_ativos"("_tenant_id" "uuid", "_cliente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_group_units"("_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_group_units"("_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_group_units"("_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_pacote_oferta"("_tenant_id" "uuid", "_servico_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_pacote_oferta"("_tenant_id" "uuid", "_servico_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_pacote_oferta"("_tenant_id" "uuid", "_servico_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_service_recommendations"("_tenant_id" "uuid", "_servico_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_service_recommendations"("_tenant_id" "uuid", "_servico_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_service_recommendations"("_tenant_id" "uuid", "_servico_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tenant_group"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tenant_group"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tenant_group"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tenant_settings"("p_tenant" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tenant_settings"("p_tenant" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tenant_settings"("p_tenant" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_accessible_tenants"("_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_accessible_tenants"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_accessible_tenants"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_accessible_tenants"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_tenant_id"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tenant_id"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tenant_id"("_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_tenant_ids"("_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role_in_tenant"("_user_id" "uuid", "_role" "text", "_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role_in_tenant"("_user_id" "uuid", "_role" "text", "_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role_in_tenant"("_user_id" "uuid", "_role" "text", "_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_for_tenant"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_for_tenant"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_for_tenant"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_colaborador"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_colaborador"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_colaborador"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_current_user_colaborador_for_tenant"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_current_user_colaborador_for_tenant"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_current_user_colaborador_for_tenant"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_master_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_master_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_master_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_master_admin"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_master_admin"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_master_admin"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_report_admin"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_report_admin"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_report_admin"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_tenant_admin"("_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_tenant_admin"("_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_tenant_admin"("_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."listar_clientes_inativos_para_campanha"("p_tenant_id" "uuid", "p_inactivity_days" integer, "p_cooldown_days" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."listar_clientes_inativos_para_campanha"("p_tenant_id" "uuid", "p_inactivity_days" integer, "p_cooldown_days" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."listar_clientes_inativos_para_campanha"("p_tenant_id" "uuid", "p_inactivity_days" integer, "p_cooldown_days" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."public_agendamentos_dia"("p_tenant" "uuid", "p_data" "date", "p_profs" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."public_agendamentos_dia"("p_tenant" "uuid", "p_data" "date", "p_profs" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_agendamentos_dia"("p_tenant" "uuid", "p_data" "date", "p_profs" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."public_criar_agendamento"("p_tenant" "uuid", "p_cliente_nome" "text", "p_cliente_telefone" "text", "p_profissional" "uuid", "p_servico" "uuid", "p_data" "date", "p_hora" time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."public_criar_agendamento"("p_tenant" "uuid", "p_cliente_nome" "text", "p_cliente_telefone" "text", "p_profissional" "uuid", "p_servico" "uuid", "p_data" "date", "p_hora" time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_criar_agendamento"("p_tenant" "uuid", "p_cliente_nome" "text", "p_cliente_telefone" "text", "p_profissional" "uuid", "p_servico" "uuid", "p_data" "date", "p_hora" time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."public_list_profissionais"("p_tenant" "uuid", "p_servico" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."public_list_profissionais"("p_tenant" "uuid", "p_servico" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_list_profissionais"("p_tenant" "uuid", "p_servico" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."public_list_servicos"("p_tenant" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."public_list_servicos"("p_tenant" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_list_servicos"("p_tenant" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalcular_status_pagamento_agendamento"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalcular_status_pagamento_agendamento"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalcular_status_pagamento_agendamento"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_agendamento_financeiro"("p_agendamento_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_agendamento_financeiro"("p_agendamento_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_agendamento_financeiro"("p_agendamento_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_venda"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_venda"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_venda"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_venda"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_custom_report"("_slug" "text", "_tenant_id" "uuid", "_filters" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_custom_report"("_slug" "text", "_tenant_id" "uuid", "_filters" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."run_custom_report"("_slug" "text", "_tenant_id" "uuid", "_filters" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_custom_report"("_slug" "text", "_tenant_id" "uuid", "_filters" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_service_recommendations"("p_service_id" "uuid", "p_recommended_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."save_service_recommendations"("p_service_id" "uuid", "p_recommended_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_service_recommendations"("p_service_id" "uuid", "p_recommended_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_comissoes_profissionais_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_comissoes_profissionais_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_comissoes_profissionais_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_permitir_agendamento_cliente"("p_tenant" "uuid", "p_value" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_permitir_agendamento_cliente"("p_tenant" "uuid", "p_value" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_permitir_agendamento_cliente"("p_tenant" "uuid", "p_value" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_tenant_horario_comercial"("p_tenant" "uuid", "p_inicio" time without time zone, "p_fim" time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."set_tenant_horario_comercial"("p_tenant" "uuid", "p_inicio" time without time zone, "p_fim" time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tenant_horario_comercial"("p_tenant" "uuid", "p_inicio" time without time zone, "p_fim" time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_tenant_horario_semanal"("p_tenant" "uuid", "p_horarios" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."set_tenant_horario_semanal"("p_tenant" "uuid", "p_horarios" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tenant_horario_semanal"("p_tenant" "uuid", "p_horarios" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tenant_images_limit_10"() TO "anon";
GRANT ALL ON FUNCTION "public"."tenant_images_limit_10"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tenant_images_limit_10"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tenant_images_touch"() TO "anon";
GRANT ALL ON FUNCTION "public"."tenant_images_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tenant_images_touch"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tenant_settings_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tenant_settings_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tenant_settings_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_group_banner"("_group_id" "uuid", "_banner_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_group_banner"("_group_id" "uuid", "_banner_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_group_banner"("_group_id" "uuid", "_banner_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."venda_limpar_pagamentos"("p_venda_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."venda_limpar_pagamentos"("p_venda_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."venda_limpar_pagamentos"("p_venda_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."venda_limpar_pagamentos"("p_venda_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."venda_recalcular_totais"("p_venda_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."venda_recalcular_totais"("p_venda_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."venda_recalcular_totais"("p_venda_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."venda_recalcular_totais"("p_venda_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."venda_substituir_pagamentos"("p_venda_id" "uuid", "p_pagamentos" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."venda_substituir_pagamentos"("p_venda_id" "uuid", "p_pagamentos" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."venda_substituir_pagamentos"("p_venda_id" "uuid", "p_pagamentos" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."venda_substituir_pagamentos"("p_venda_id" "uuid", "p_pagamentos" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."wa_session_lookup"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."wa_session_lookup"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."wa_session_lookup"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."wa_session_lookup"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."wa_session_mark_used"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."wa_session_mark_used"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."wa_session_mark_used"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."wa_session_mark_used"("p_token" "text") TO "service_role";



GRANT ALL ON TABLE "public"."agenda_bloqueios" TO "anon";
GRANT ALL ON TABLE "public"."agenda_bloqueios" TO "authenticated";
GRANT ALL ON TABLE "public"."agenda_bloqueios" TO "service_role";



GRANT ALL ON TABLE "public"."agendamento_servico_cores" TO "anon";
GRANT ALL ON TABLE "public"."agendamento_servico_cores" TO "authenticated";
GRANT ALL ON TABLE "public"."agendamento_servico_cores" TO "service_role";



GRANT ALL ON TABLE "public"."backfill_balcao_map" TO "anon";
GRANT ALL ON TABLE "public"."backfill_balcao_map" TO "authenticated";
GRANT ALL ON TABLE "public"."backfill_balcao_map" TO "service_role";



GRANT ALL ON TABLE "public"."backup_agendamento_pagamentos_balcao" TO "anon";
GRANT ALL ON TABLE "public"."backup_agendamento_pagamentos_balcao" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_agendamento_pagamentos_balcao" TO "service_role";



GRANT ALL ON TABLE "public"."backup_agendamento_pagamentos_observacao_desconto" TO "anon";
GRANT ALL ON TABLE "public"."backup_agendamento_pagamentos_observacao_desconto" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_agendamento_pagamentos_observacao_desconto" TO "service_role";



GRANT ALL ON TABLE "public"."backup_agendamento_produtos_balcao" TO "anon";
GRANT ALL ON TABLE "public"."backup_agendamento_produtos_balcao" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_agendamento_produtos_balcao" TO "service_role";



GRANT ALL ON TABLE "public"."backup_agendamentos_balcao" TO "anon";
GRANT ALL ON TABLE "public"."backup_agendamentos_balcao" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_agendamentos_balcao" TO "service_role";



GRANT ALL ON TABLE "public"."backup_comissoes_desconto_retroativo_agendamentos" TO "anon";
GRANT ALL ON TABLE "public"."backup_comissoes_desconto_retroativo_agendamentos" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_comissoes_desconto_retroativo_agendamentos" TO "service_role";



GRANT ALL ON TABLE "public"."backup_comissoes_desconto_retroativo_pagamentos" TO "anon";
GRANT ALL ON TABLE "public"."backup_comissoes_desconto_retroativo_pagamentos" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_comissoes_desconto_retroativo_pagamentos" TO "service_role";



GRANT ALL ON TABLE "public"."cancelamento_log" TO "anon";
GRANT ALL ON TABLE "public"."cancelamento_log" TO "authenticated";
GRANT ALL ON TABLE "public"."cancelamento_log" TO "service_role";



GRANT ALL ON TABLE "public"."cancelamento_motivos" TO "anon";
GRANT ALL ON TABLE "public"."cancelamento_motivos" TO "authenticated";
GRANT ALL ON TABLE "public"."cancelamento_motivos" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios" TO "anon";
GRANT ALL ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."comissoes_v2_eventos" TO "anon";
GRANT ALL ON TABLE "public"."comissoes_v2_eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."comissoes_v2_eventos" TO "service_role";



GRANT ALL ON TABLE "public"."cores" TO "anon";
GRANT ALL ON TABLE "public"."cores" TO "authenticated";
GRANT ALL ON TABLE "public"."cores" TO "service_role";



GRANT ALL ON TABLE "public"."custom_reports" TO "anon";
GRANT ALL ON TABLE "public"."custom_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_reports" TO "service_role";



GRANT ALL ON TABLE "public"."venda_itens" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."venda_itens" TO "authenticated";
GRANT ALL ON TABLE "public"."venda_itens" TO "service_role";



GRANT ALL ON TABLE "public"."vendas" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vendas" TO "authenticated";
GRANT ALL ON TABLE "public"."vendas" TO "service_role";



GRANT ALL ON TABLE "public"."dv2_vendas_itens" TO "anon";
GRANT ALL ON TABLE "public"."dv2_vendas_itens" TO "authenticated";
GRANT ALL ON TABLE "public"."dv2_vendas_itens" TO "service_role";



GRANT ALL ON TABLE "public"."venda_pagamentos" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."venda_pagamentos" TO "authenticated";
GRANT ALL ON TABLE "public"."venda_pagamentos" TO "service_role";



GRANT ALL ON TABLE "public"."dv2_vendas_receita" TO "anon";
GRANT ALL ON TABLE "public"."dv2_vendas_receita" TO "authenticated";
GRANT ALL ON TABLE "public"."dv2_vendas_receita" TO "service_role";



GRANT ALL ON TABLE "public"."estoque_movimentacoes" TO "anon";
GRANT ALL ON TABLE "public"."estoque_movimentacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."estoque_movimentacoes" TO "service_role";



GRANT ALL ON TABLE "public"."evolution_settings" TO "anon";
GRANT ALL ON TABLE "public"."evolution_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."evolution_settings" TO "service_role";



GRANT ALL ON TABLE "public"."historico_atendimentos" TO "anon";
GRANT ALL ON TABLE "public"."historico_atendimentos" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_atendimentos" TO "service_role";



GRANT ALL ON TABLE "public"."historico_servicos" TO "anon";
GRANT ALL ON TABLE "public"."historico_servicos" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_servicos" TO "service_role";



GRANT ALL ON TABLE "public"."inactive_customer_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."inactive_customer_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."inactive_customer_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."master_tenant_history" TO "anon";
GRANT ALL ON TABLE "public"."master_tenant_history" TO "authenticated";
GRANT ALL ON TABLE "public"."master_tenant_history" TO "service_role";



GRANT ALL ON TABLE "public"."produtos_estoque_saldo" TO "anon";
GRANT ALL ON TABLE "public"."produtos_estoque_saldo" TO "authenticated";
GRANT ALL ON TABLE "public"."produtos_estoque_saldo" TO "service_role";



GRANT ALL ON TABLE "public"."produtos_estoque_ultima_mov" TO "anon";
GRANT ALL ON TABLE "public"."produtos_estoque_ultima_mov" TO "authenticated";
GRANT ALL ON TABLE "public"."produtos_estoque_ultima_mov" TO "service_role";



GRANT ALL ON TABLE "public"."professional_queue" TO "anon";
GRANT ALL ON TABLE "public"."professional_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."professional_queue" TO "service_role";



GRANT ALL ON TABLE "public"."profissional_servicos" TO "anon";
GRANT ALL ON TABLE "public"."profissional_servicos" TO "authenticated";
GRANT ALL ON TABLE "public"."profissional_servicos" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."service_recommendations" TO "anon";
GRANT ALL ON TABLE "public"."service_recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."service_recommendations" TO "service_role";



GRANT ALL ON TABLE "public"."servico_cor_config" TO "anon";
GRANT ALL ON TABLE "public"."servico_cor_config" TO "authenticated";
GRANT ALL ON TABLE "public"."servico_cor_config" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_group_tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenant_group_tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_group_tenants" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_groups" TO "anon";
GRANT ALL ON TABLE "public"."tenant_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_groups" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_images" TO "anon";
GRANT ALL ON TABLE "public"."tenant_images" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_images" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_settings" TO "anon";
GRANT ALL ON TABLE "public"."tenant_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_settings" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_public_booking" TO "anon";
GRANT ALL ON TABLE "public"."tenant_public_booking" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_public_booking" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenants_display_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenants_display_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenants_display_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_inbound_seen" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_inbound_seen" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_inbound_seen" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_notifications_log" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_notifications_log" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_notifications_log" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_sessions" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_sessions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







