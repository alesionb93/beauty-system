// supabase/functions/authorize-admin/index.ts
// =====================================================================
// Edge Function GENÉRICA de autorização administrativa — Slotify
// ---------------------------------------------------------------------
// Responsabilidade ÚNICA: validar credenciais administrativas (login OU
// e-mail + senha) e responder se o usuário tem papel 'admin' ou
// 'master_admin'. NÃO contém nenhuma regra de negócio (cancelamento,
// desconto, estorno, exclusão, financeiro). Pode ser reutilizada por
// qualquer fluxo que exija autorização administrativa pontual.
//
// Entrada esperada (POST JSON):
//   { "identifier": "admin@empresa.com" | "login_do_admin",
//     "password":   "..." }
//
// Sucesso (200):
//   { "success": true, "user_id": "...", "name": "...",
//     "email": "...", "role": "admin" | "master_admin",
//     "access_token": "...", "tenant_id": "..." | null }
//
// Erros:
//   400  { success:false, message:"Informe usuário e senha." }
//   401  { success:false, message:"Credenciais inválidas" }
//   403  { success:false, message:"Usuário não possui permissão administrativa" }
//   500  { success:false, message:"Configuração do servidor incompleta." }
//
// Deploy:  supabase functions deploy authorize-admin
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_VERSION = "authorize-admin-v1-2026-06-03";

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
  return new Response(JSON.stringify({ ...(body as object), function_version: FUNCTION_VERSION }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ success: false, message, ...extra }, status);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Método inválido.", 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error("[authorize-admin] env ausente", {
      hasUrl: !!SUPABASE_URL,
      hasService: !!SERVICE_ROLE_KEY,
      hasAnon: !!ANON_KEY,
    });
    return fail("Configuração do servidor incompleta.", 500);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); }
  catch { return fail("Payload inválido (JSON esperado).", 400); }

  const identifierRaw = String(
    (body.identifier ?? body.login ?? body.email ?? body.usuario ?? "") as string
  ).trim();
  const password = String((body.password ?? body.senha ?? "") as string);

  if (!identifierRaw || !password) {
    return fail("Informe usuário e senha.", 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Resolver identifier → email.
  //    Se contém '@', tratamos como e-mail direto.
  //    Caso contrário, procuramos em public.usuarios por login/username.
  let email = "";
  if (identifierRaw.includes("@")) {
    email = identifierRaw.toLowerCase();
  } else {
    // Busca tolerante: tenta colunas comuns ('login', 'username', 'usuario').
    // Se nenhuma existir no schema, o select retorna erro e devolvemos 401 genérico.
    let foundEmail: string | null = null;
    for (const col of ["login", "username", "usuario"]) {
      try {
        const { data, error } = await admin
          .from("usuarios")
          .select("email")
          .eq(col, identifierRaw)
          .maybeSingle();
        if (!error && data?.email) {
          foundEmail = String(data.email);
          break;
        }
      } catch (_) { /* coluna inexistente — tenta próxima */ }
    }
    if (!foundEmail) return fail("Credenciais inválidas", 401);
    email = foundEmail.toLowerCase();
  }

  // 2) Validar senha via signInWithPassword (cliente anon).
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signErr } = await authClient.auth.signInWithPassword({
    email, password,
  });
  if (signErr || !signIn?.user) {
    console.warn("[authorize-admin] credenciais inválidas", { email, msg: signErr?.message });
    return fail("Credenciais inválidas", 401);
  }

  const userId = signIn.user.id;

  // 3) Conferir papel admin/master_admin em public.user_roles.
  const { data: roles, error: rolesErr } = await admin
    .from("user_roles")
    .select("role, tenant_id")
    .eq("user_id", userId);

  if (rolesErr) {
    console.error("[authorize-admin] erro ao ler roles", rolesErr);
    return fail("Erro ao validar permissões.", 500);
  }

  const roleList = (roles ?? []) as Array<{ role: string; tenant_id: string | null }>;
  const masterRow = roleList.find((r) => r.role === "master_admin");
  const adminRow  = roleList.find((r) => r.role === "admin");

  if (!masterRow && !adminRow) {
    return fail("Usuário não possui permissão administrativa", 403);
  }

  const role: "master_admin" | "admin" = masterRow ? "master_admin" : "admin";
  const tenantId = (masterRow?.tenant_id ?? adminRow?.tenant_id) ?? null;

  // Nome (best-effort)
  let name: string | null = null;
  try {
    const { data: u } = await admin
      .from("usuarios").select("nome").eq("id", userId).maybeSingle();
    name = (u?.nome as string) ?? null;
  } catch (_) { /* opcional */ }

  return json({
    success: true,
    user_id: userId,
    name,
    email: signIn.user.email ?? email,
    role,
    tenant_id: tenantId,
    access_token: signIn.session?.access_token ?? null,
  }, 200);
});
