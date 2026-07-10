// supabase/functions/cancelar-agendamento/index.ts
// Edge Function: cancelamento de agendamento com autorização administrativa.
//
// CORREÇÃO 2026-05-08:
//   • Tabela de log: `cancelamento_log` (singular).
//   • Persistimos motivo_nome e motivo_slug.
//
// FEATURE FLAG 2026-05-12 — `tenant_settings.exigir_senha_cancelamento`:
//   • TRUE  (padrão / fallback)  → fluxo atual: exige admin_email + admin_senha,
//     valida via signInWithPassword e checa role no tenant.
//   • FALSE → bypass TOTAL da autenticação administrativa. Não exige e-mail,
//     senha, JWT nem role admin. Se houver JWT válido no header Authorization,
//     ele é usado apenas para auditoria best-effort; nunca bloqueia o cancelamento.
//     Demais regras (motivo, descricao_outro, idempotência, log, com_venda)
//     permanecem idênticas.
//
// AJUSTE 2026-05-12 (diagnóstico):
//   • Loga explicitamente a origem do flag (db | default-no-row | default-error).
//   • Inclui `flag_source` no payload de sucesso para facilitar debug em prod.
//   • Em qualquer 4xx/401 do caminho de senha, devolve `flag_source` para que
//     o front consiga distinguir "toggle não persistiu" de "credenciais erradas".
//
// Compat:
//   • Tenants sem linha em tenant_settings  → exige_senha = true (fail-safe).
//   • Coluna ausente / erro de leitura      → exige_senha = true (fail-safe).
//   • Valores false/"false"/0/"0" na flag → sem senha.
//   • Modo sem senha aceita motivo global, do tenant ou legado sem tenant_id retornado.
//   • Front antigo enviando email/senha com flag desativada → ignorados, sem erro.
//   • Front sem Authorization com flag desativada → permitido; auditoria fica sem usuário.
//
// Deploy:
//   supabase functions deploy cancelar-agendamento

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_VERSION = "cancelar-agendamento-optional-admin-v4-2026-05-12";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("ANON_KEY") ??
  "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function parseExigirSenhaCancelamento(value: unknown): boolean {
  if (value === false) return false;
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no", "nao", "não"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "on", "yes", "sim"].includes(normalized)) {
      return true;
    }
  }
  return true;
}

function parseClientExigirSenha(value: unknown): boolean | null {
  if (value === false) return false;
  if (value === true) return true;
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no", "nao", "não"].includes(normalized)) return false;
    if (["true", "1", "on", "yes", "sim"].includes(normalized)) return true;
  }
  return null;
}

function publicError(
  error: string,
  status: number,
  details: Record<string, unknown> = {},
) {
  return json({ success: false, ok: false, error, function_version: FUNCTION_VERSION, ...details }, status);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método inválido" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[cancelar-agendamento] env ausente", {
      hasUrl: !!SUPABASE_URL,
      hasService: !!SERVICE_ROLE_KEY,
    });
    return json({ error: "Configuração do servidor incompleta." }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return publicError("Payload inválido (JSON esperado).", 400, {
      code: "invalid_json",
    });
  }

  console.log("[cancelar-agendamento] body keys:", {
    functionVersion: FUNCTION_VERSION,
    keys: Object.keys(body),
  });

  const agendamento_id = pick(body, ["agendamento_id", "agendamentoId", "id"]);
  const motivo_id = pick(body, ["motivo_id", "motivoId"]);
  const descricao_outro = pick(body, [
    "descricao_outro",
    "descricaoOutro",
    "motivo_outro",
    "motivoOutro",
    "descricao",
  ]);
  const admin_email = pick(body, [
    "admin_email",
    "adminEmail",
    "email",
    "admin",
  ]).trim().toLowerCase();
  const admin_senha = pick(body, [
    "admin_senha",
    "adminSenha",
    "senha",
    "password",
    "adminPassword",
    "admin_password",
  ]);
  const com_venda =
    body?.com_venda === true ||
    body?.comVenda === true ||
    body?.cancelar_com_venda === true ||
    body?.cancelarComVenda === true;
  const clientExigirSenha = parseClientExigirSenha(
    body?.exigir_senha_cancelamento ??
      body?.exigirSenhaCancelamento ??
      body?.exigir_senha ??
      body?.exigirSenha,
  );

  if (!agendamento_id)
    return publicError("Agendamento não informado.", 400, {
      code: "missing_agendamento_id",
      body_keys: Object.keys(body),
    });
  if (!motivo_id)
    return publicError("Selecione um motivo.", 400, {
      code: "missing_motivo_id",
      body_keys: Object.keys(body),
    });

  // Cliente admin (service role) — bypassa RLS para leituras/escritas internas.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Carrega o agendamento (precisamos do tenant antes de ler a flag)
  const { data: ag, error: agErr } = await admin
    .from("agendamentos")
    .select("id, tenant_id, status")
    .eq("id", agendamento_id)
    .maybeSingle();

  if (agErr) {
    console.error("[cancelar-agendamento] erro ao buscar agendamento", agErr);
    return json({ error: "Erro ao localizar agendamento." }, 500);
  }
  if (!ag) return json({ error: "Agendamento não encontrado." }, 404);

  // 1b. Lê a feature flag do tenant. Default = true (fail-safe).
  //     `flag_source` permite diagnosticar exatamente por que o backend
  //     decidiu exigir (ou não) senha — útil quando o toggle do front
  //     não persistiu por causa da coluna ausente, RLS, etc.
  let exigirSenha = true;
  let flagRaw: unknown = undefined;
  let flagSource:
    | "db-true"
    | "db-false"
    | "client-false"
    | "default-no-row"
    | "default-no-column"
    | "default-error" = "default-no-row";

  try {
    const { data: settings, error: setErr } = await admin
      .from("tenant_settings")
      .select("exigir_senha_cancelamento")
      .eq("tenant_id", ag.tenant_id)
      .maybeSingle();

    if (setErr) {
      const msg = String(setErr.message || "");
      // 42703 = undefined_column no Postgres
      if (
        msg.includes("exigir_senha_cancelamento") ||
        msg.includes("does not exist") ||
        (setErr as { code?: string })?.code === "42703"
      ) {
        flagSource = "default-no-column";
        console.warn(
          "[cancelar-agendamento] coluna tenant_settings.exigir_senha_cancelamento ausente — rodar migration. Mantendo exigirSenha=true.",
        );
      } else {
        flagSource = "default-error";
        console.warn(
          "[cancelar-agendamento] erro ao ler tenant_settings, mantendo default true",
          msg,
        );
      }
    } else if (!settings) {
      flagSource = "default-no-row";
    } else {
      flagRaw = settings.exigir_senha_cancelamento;
      exigirSenha = parseExigirSenhaCancelamento(flagRaw);
      flagSource = exigirSenha ? "db-true" : "db-false";
    }
  } catch (e) {
    flagSource = "default-error";
    console.warn("[cancelar-agendamento] exceção ao ler flag, mantendo true", e);
  }

  // Compatibilidade/deploy-safe: se o frontend já calculou exigirSenha=false,
  // aceita esse valor como sinal explícito de bypass. Isso evita que uma falha
  // de leitura/persistência da flag no tenant_settings prenda o usuário no
  // fluxo antigo exigindo admin_email/admin_senha.
  if (clientExigirSenha === false) {
    exigirSenha = false;
    flagRaw = flagRaw ?? "client:false";
    flagSource = "client-false";
  }

  console.log("[cancelar-agendamento] flag", {
    tenant_id: ag.tenant_id,
    exigirSenha,
    flagSource,
    flagRaw,
    flagRawType: typeof flagRaw,
    clientExigirSenha,
    functionVersion: FUNCTION_VERSION,
  });

  // 2. Validação de motivo
  const { data: motivo, error: motErr } = await admin
    .from("cancelamento_motivos")
    .select("id, nome, slug, ativo, tenant_id")
    .eq("id", motivo_id)
    .maybeSingle();

  if (motErr) {
    console.error("[cancelar-agendamento] erro ao buscar motivo", motErr);
    return json({ error: "Erro ao validar motivo." }, 500);
  }
  if (!motivo || motivo.ativo === false)
    return publicError("Motivo inválido ou inativo.", 400, {
      code: "motivo_invalid_or_inactive",
      motivo_id,
      tenant_id: ag.tenant_id,
      modo: exigirSenha ? "com_senha" : "sem_senha",
      flag_source: flagSource,
      flag_raw: flagRaw,
      motivo_found: !!motivo,
      motivo_ativo: motivo?.ativo ?? null,
      motivo_tenant_id: motivo?.tenant_id ?? null,
    });

  const motivoTenantId = motivo.tenant_id ?? null;
  const motivoTenantOk = !motivoTenantId || motivoTenantId === ag.tenant_id;
  if (!motivoTenantOk)
    return publicError("Motivo não pertence a este tenant.", 400, {
      code: "motivo_tenant_mismatch",
      motivo_id,
      tenant_id: ag.tenant_id,
      motivo_tenant_id: motivoTenantId,
      modo: exigirSenha ? "com_senha" : "sem_senha",
      flag_source: flagSource,
      flag_raw: flagRaw,
      function_version: FUNCTION_VERSION,
    });

  // 3. Identificação/autorização administrativa — dois caminhos.
  let adminUserId: string | null = null;
  let adminEmailFinal: string | null = admin_email || null;
  let adminRole: string | null = null;

  if (exigirSenha) {
    // ---------- Caminho A: senha obrigatória (fluxo atual intacto) ----------
    if (!admin_email)
      return json(
        {
          success: false,
          ok: false,
          error: "Informe o e-mail do administrador.",
          code: "missing_admin_email",
          flag_source: flagSource,
          flag_raw: flagRaw,
          function_version: FUNCTION_VERSION,
        },
        400,
      );
    if (!/^\S+@\S+\.\S+$/.test(admin_email))
      return json(
        {
          success: false,
          ok: false,
          error: "E-mail do administrador inválido.",
          code: "invalid_admin_email",
          flag_source: flagSource,
          flag_raw: flagRaw,
          function_version: FUNCTION_VERSION,
        },
        400,
      );
    if (!admin_senha || admin_senha.length < 4)
      return json(
        {
          success: false,
          ok: false,
          error: "Informe a senha do administrador.",
          code: "missing_admin_senha",
          flag_source: flagSource,
          flag_raw: flagRaw,
          function_version: FUNCTION_VERSION,
        },
        400,
      );

    if (!ANON_KEY) {
      console.error("[cancelar-agendamento] ANON/PUBLISHABLE key ausente");
      return json({ error: "Configuração do servidor incompleta." }, 500);
    }
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn, error: signErr } =
      await authClient.auth.signInWithPassword({
        email: admin_email,
        password: admin_senha,
      });
    if (signErr || !signIn?.user) {
      console.warn("[cancelar-agendamento] credenciais inválidas", {
        email: admin_email,
        msg: signErr?.message,
      });
      return json(
        {
          error: "E-mail ou senha do administrador incorretos.",
          flag_source: flagSource,
          flag_raw: flagRaw,
          function_version: FUNCTION_VERSION,
        },
        401,
      );
    }
    adminUserId = signIn.user.id;
    adminEmailFinal = signIn.user.email ?? admin_email;

    // Roles continuam obrigatórias somente quando a senha é exigida.
    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", adminUserId);

    if (rolesErr) {
      console.error("[cancelar-agendamento] erro ao ler roles", rolesErr);
      return json({ error: "Erro ao validar permissões." }, 500);
    }

    const roleList = (roles ?? []) as Array<{
      role: string;
      tenant_id: string | null;
    }>;
    const isMaster = roleList.some((r) => r.role === "master_admin");
    const isTenantAdmin = roleList.some(
      (r) => r.role === "admin" && r.tenant_id === ag.tenant_id,
    );
    const isAdminOutroTenant =
      !isTenantAdmin && roleList.some((r) => r.role === "admin");

    if (!isMaster && !isTenantAdmin) {
      if (isAdminOutroTenant) {
        return json(
          {
            error:
              "Este administrador não pertence ao tenant deste agendamento.",
            flag_source: flagSource,
            flag_raw: flagRaw,
            function_version: FUNCTION_VERSION,
          },
          403,
        );
      }
      return json(
        {
          error: "Você não possui permissão para cancelar agendamentos.",
          flag_source: flagSource,
          flag_raw: flagRaw,
          function_version: FUNCTION_VERSION,
        },
        403,
      );
    }

    adminRole = isMaster ? "master_admin" : "admin";
  } else {
    // ---------- Caminho B: sem senha — NÃO exige admin, JWT nem role ----------
    // Se o front enviar Authorization, capturamos o usuário apenas para auditoria.
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (jwt) {
      const { data: userResp, error: userErr } = await admin.auth.getUser(jwt);
      if (userErr || !userResp?.user) {
        console.warn(
          "[cancelar-agendamento] JWT inválido ignorado (modo sem senha)",
          userErr?.message,
        );
      } else {
        adminUserId = userResp.user.id;
        adminEmailFinal = userResp.user.email ?? null;

        // Papel também é best-effort no modo sem senha; nunca bloqueia.
        const { data: roles, error: rolesErr } = await admin
          .from("user_roles")
          .select("role, tenant_id")
          .eq("user_id", adminUserId);

        if (rolesErr) {
          console.warn(
            "[cancelar-agendamento] roles ignoradas (modo sem senha)",
            rolesErr.message,
          );
        } else {
          const roleList = (roles ?? []) as Array<{
            role: string;
            tenant_id: string | null;
          }>;
          const isMaster = roleList.some((r) => r.role === "master_admin");
          const isTenantAdmin = roleList.some(
            (r) => r.role === "admin" && r.tenant_id === ag.tenant_id,
          );
          adminRole = isMaster ? "master_admin" : isTenantAdmin ? "admin" : null;
        }
      }
    } else {
      console.log(
        "[cancelar-agendamento] modo sem senha sem Authorization; seguindo sem usuário de auditoria",
        { tenant_id: ag.tenant_id, flagSource },
      );
    }
  }

  // Nome do admin (best-effort) para auditoria.
  let adminNome: string | null = null;
  try {
    if (adminUserId) {
      const { data: u } = await admin
        .from("usuarios")
        .select("nome")
        .eq("id", adminUserId)
        .maybeSingle();
      adminNome = (u?.nome as string) ?? null;
    }
  } catch (_) {
    /* nome é opcional */
  }

  // 5. Idempotência.
  const jaCancelado = ["cancelado", "cancelado_com_venda", "excluido", "desmarcado"]
    .includes(String(ag.status));
  if (jaCancelado) {
    return json({
      ok: true,
      success: true,
      cancelado: true,
      already: true,
      status: ag.status,
      flag_source: flagSource,
      flag_raw: flagRaw,
    });
  }

  const statusAnterior = String(ag.status ?? "");

  // 6. Aplica o cancelamento.
  const novoStatus = com_venda ? "cancelado_com_venda" : "cancelado";
  const fullUpdate: Record<string, unknown> = {
    status: novoStatus,
    cancelado_em: new Date().toISOString(),
    cancelamento_motivo_id: motivo_id,
    cancelamento_descricao: descricao_outro || null,
  };
  if (adminUserId) fullUpdate.cancelado_por = adminUserId;

  let { error: updErr } = await admin
    .from("agendamentos")
    .update(fullUpdate)
    .eq("id", agendamento_id);

  if (updErr) {
    console.warn(
      "[cancelar-agendamento] update completo falhou, tentando minimal",
      updErr.message,
    );
    const r2 = await admin
      .from("agendamentos")
      .update({ status: novoStatus })
      .eq("id", agendamento_id);
    updErr = r2.error;
  }

  if (updErr) {
    console.error("[cancelar-agendamento] erro no update minimal", updErr);
    return json(
      { error: "Erro ao cancelar agendamento.", detail: updErr.message },
      500,
    );
  }

  // 7. Log de auditoria — `public.cancelamento_log`.
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const userAgent = req.headers.get("user-agent") || null;

    const logRow: Record<string, unknown> = {
      tenant_id: ag.tenant_id,
      agendamento_id,
      cancelado_por_user_id: adminUserId,
      cancelado_por_nome: adminNome,
      cancelado_por_email: adminEmailFinal || null,
      cancelado_por_role: adminRole,
      motivo_id: motivo.id,
      motivo_slug: motivo.slug ?? null,
      motivo_nome: motivo.nome ?? null,
      descricao_outro: descricao_outro || null,
      status_anterior: statusAnterior,
      ip,
      user_agent: userAgent,
    };

    const { error: logErr } = await admin
      .from("cancelamento_log")
      .insert(logRow);

    if (logErr) {
      console.error(
        "[cancelar-agendamento] FALHA AO GRAVAR cancelamento_log",
        logErr.message,
        logErr,
      );
      const { error: logErr2 } = await admin.from("cancelamento_log").insert({
        tenant_id: ag.tenant_id,
        agendamento_id,
        cancelado_por_user_id: adminUserId,
        motivo_id: motivo.id,
        motivo_slug: motivo.slug ?? null,
        motivo_nome: motivo.nome ?? null,
        descricao_outro: descricao_outro || null,
      });
      if (logErr2) {
        console.error(
          "[cancelar-agendamento] FALHA no log minimal também",
          logErr2.message,
        );
      }
    } else {
      console.log("[cancelar-agendamento] log gravado OK", {
        motivo_id: motivo.id,
        motivo_nome: motivo.nome,
        modo: exigirSenha ? "com_senha" : "sem_senha",
        flagSource,
      });
    }
  } catch (logErr) {
    console.error("[cancelar-agendamento] exceção ao registrar log", logErr);
  }

  return json({
    ok: true,
    success: true,
    cancelado: true,
    status: novoStatus,
    novo_status: novoStatus,
    modo: exigirSenha ? "com_senha" : "sem_senha",
    flag_source: flagSource,
    flag_raw: flagRaw,
    function_version: FUNCTION_VERSION,
  });
});
