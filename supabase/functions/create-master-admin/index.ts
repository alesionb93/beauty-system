// supabase/functions/create-master-admin/index.ts
// Edge Function: cria um novo usuário com role 'master_admin'.
// Segurança:
//  - Exige Authorization: Bearer <jwt>
//  - Quem chama precisa ter role 'master_admin' em public.user_roles
//  - service_role NUNCA é exposto ao frontend; só usado aqui no servidor
// ----------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: "Server misconfigured" }, 500);
    }

    // 1) Autenticação do chamador
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } =
      await supabaseAuthClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ error: "Token inválido" }, 401);
    }
    const callerId = userData.user.id;

    // 2) Cliente admin (service role) — só no servidor
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3) Verifica se quem chamou é master_admin
    const { data: callerRoles, error: rolesErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    if (rolesErr) {
      return json({ error: "Erro ao verificar permissões" }, 500);
    }
    const isMaster = (callerRoles || []).some(
      (r: { role: string }) => r.role === "master_admin",
    );
    if (!isMaster) {
      return json(
        { error: "Acesso negado. Apenas master_admin pode executar esta ação." },
        403,
      );
    }

    // 4) Validação do payload
    const body = await req.json().catch(() => ({}));
    const nome = String(body?.nome ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!nome || nome.length < 2 || nome.length > 120) {
      return json({ error: "Nome inválido (2 a 120 caracteres)." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "E-mail inválido." }, 400);
    }
    if (!password || password.length < 8 || password.length > 72) {
      return json(
        { error: "Senha inválida (mínimo 8 caracteres)." },
        400,
      );
    }

    // 5) Cria o usuário no Auth
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome },
      });

    if (createErr || !created?.user) {
      const msg = createErr?.message || "Falha ao criar usuário.";
      // 422/email exists, etc.
      const status = /already|exists|registered/i.test(msg) ? 409 : 400;
      return json({ error: msg }, status);
    }

    const newUserId = created.user.id;

    // 6) Insere em public.usuarios (id = auth user id)
    const { error: usuariosErr } = await admin.from("usuarios").upsert(
      {
        id: newUserId,
        nome,
        email,
        ativo: true,
        tenant_id: null,
      },
      { onConflict: "id" },
    );
    if (usuariosErr) {
      // rollback do auth user pra não deixar lixo
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      return json(
        { error: "Erro ao salvar perfil: " + usuariosErr.message },
        500,
      );
    }

    // 7) Atribui role master_admin (tenant_id = null pois é global)
    const { error: roleErr } = await admin.from("user_roles").insert({
      user_id: newUserId,
      role: "master_admin",
      tenant_id: null,
    });
    if (roleErr) {
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      return json(
        { error: "Erro ao atribuir role: " + roleErr.message },
        500,
      );
    }

    return json({
      success: true,
      user: { id: newUserId, email, nome, role: "master_admin" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro inesperado";
    return json({ error: msg }, 500);
  }
});
