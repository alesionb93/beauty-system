// supabase/functions/cancelar-agendamento/index.ts
// Edge Function: cancelamento de agendamento com autorização administrativa.
//
// CORREÇÃO 2026-05-08:
//   • Tabela de log corrigida: `cancelamento_log` (singular), não `cancelamento_logs`.
//   • Colunas alinhadas ao schema real:
//       cancelado_por_user_id, cancelado_por_email, cancelado_por_nome,
//       cancelado_por_role, motivo_id, motivo_slug, motivo_nome,
//       descricao_outro, status_anterior, ip, user_agent.
//   • Persiste motivo_nome e motivo_slug — necessário para o
//     analytics-cancelamentos.js exibir o nome do motivo.
//   • Falha de log agora é logada com detalhe (mas não derruba o cancelamento).
//
// Deploy:
//   supabase functions deploy cancelar-agendamento

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    return json({ error: "Payload inválido (JSON esperado)." }, 400);
  }

  console.log("[cancelar-agendamento] body keys:", Object.keys(body));

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

  if (!agendamento_id)
    return json({ error: "Agendamento não informado." }, 400);
  if (!admin_email) return json({ error: "Informe o e-mail do administrador." }, 400);
  if (!/^\S+@\S+\.\S+$/.test(admin_email))
    return json({ error: "E-mail do administrador inválido." }, 400);
  if (!admin_senha || admin_senha.length < 4)
    return json({ error: "Informe a senha do administrador." }, 400);
  if (!motivo_id) return json({ error: "Selecione um motivo." }, 400);

  // Cliente admin (service role) — bypassa RLS para leituras/escritas internas.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Carrega o agendamento e o motivo (precisamos do tenant do agendamento)
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
    return json({ error: "Motivo inválido ou inativo." }, 400);
  if (motivo.tenant_id && motivo.tenant_id !== ag.tenant_id)
    return json({ error: "Motivo não pertence a este tenant." }, 400);

  // 2. Autentica o admin pelas credenciais digitadas no modal.
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
      { error: "E-mail ou senha do administrador incorretos." },
      401,
    );
  }

  const adminUserId = signIn.user.id;

  // 3. Roles do admin autenticado.
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
        { error: "Este administrador não pertence ao tenant deste agendamento." },
        403,
      );
    }
    return json(
      { error: "Você não possui permissão para cancelar agendamentos." },
      403,
    );
  }

  // Role efetiva usada para auditoria.
  const adminRole = isMaster
    ? "master_admin"
    : isTenantAdmin
    ? "admin"
    : "desconhecida";

  // Nome do admin (best-effort) para auditoria.
  let adminNome: string | null = null;
  try {
    const { data: u } = await admin
      .from("usuarios")
      .select("nome")
      .eq("id", adminUserId)
      .maybeSingle();
    adminNome = (u?.nome as string) ?? null;
  } catch (_) {
    // ignora — nome é opcional
  }

  // 4. Idempotência.
  const jaCancelado = ["cancelado", "cancelado_com_venda", "excluido", "desmarcado"]
    .includes(String(ag.status));
  if (jaCancelado) {
    return json({ ok: true, success: true, cancelado: true, already: true, status: ag.status });
  }

  const statusAnterior = String(ag.status ?? "");

  // 5. Aplica o cancelamento.
  const novoStatus = com_venda ? "cancelado_com_venda" : "cancelado";
  const fullUpdate: Record<string, unknown> = {
    status: novoStatus,
    cancelado_em: new Date().toISOString(),
    cancelado_por: adminUserId,
    cancelamento_motivo_id: motivo_id,
    cancelamento_descricao: descricao_outro || null,
  };

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

  // 6. Log de auditoria — TABELA CORRETA: public.cancelamento_log (singular).
  //    Schema:
  //      tenant_id, agendamento_id,
  //      cancelado_por_user_id, cancelado_por_nome, cancelado_por_email, cancelado_por_role,
  //      motivo_id, motivo_slug, motivo_nome, descricao_outro,
  //      status_anterior, ip, user_agent, created_at
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
      cancelado_por_email: admin_email,
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
      // Fallback minimal — ainda persistindo o motivo (o que importa pro analytics).
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
      });
    }
  } catch (logErr) {
    console.error("[cancelar-agendamento] exceção ao registrar log", logErr);
  }

  return json({ ok: true, success: true, cancelado: true, status: novoStatus });
});
