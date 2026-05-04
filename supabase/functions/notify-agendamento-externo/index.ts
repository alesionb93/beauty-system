// =====================================================================
// Edge Function: notify-agendamento-externo
// =====================================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("BODY RECEBIDO:", body);

    const { agendamento_id, tenant_id, profissional_id } = body;

    if (!agendamento_id || !tenant_id) {
      return json({ error: "missing fields" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // =========================================================
    // AGENDAMENTO
    // =========================================================
    const { data: ag, error: agError } = await sb
      .from("agendamentos")
      .select("id, data, hora, origem, profissional_id, cliente:clientes(nome)")
      .eq("id", agendamento_id)
      .maybeSingle();

    if (agError) {
      console.error("Erro ao buscar agendamento:", agError);
      return json({ error: "erro ao buscar agendamento" }, 500);
    }

    if (!ag) {
      return json({ error: "agendamento não encontrado" }, 404);
    }

    if (ag.origem !== "externo") {
      return json({ skipped: true });
    }

    // =========================================================
    // SUBSCRIPTIONS
    // =========================================================
    let q = sb
      .from("push_subscriptions")
      .select("*")
      .eq("tenant_id", tenant_id);

    if (profissional_id) {
      q = q.eq("profissional_id", profissional_id);
    }

    const { data } = await q;
    const subs = data ?? [];

    console.log("Subscriptions encontradas:", subs.length);

    if (subs.length === 0) {
      return json({ sent: 0, total: 0 });
    }

    // =========================================================
    // PAYLOAD
    // =========================================================
    const payload = JSON.stringify({
      title: "Novo agendamento online",
      body: `${ag.cliente?.nome ?? "Cliente"} — ${ag.data} ${String(
        ag.hora
      ).slice(0, 5)}`,
      url: `/agenda?ag=${ag.id}`,
    });

    // =========================================================
    // ENVIAR PUSH (CORRIGIDO AQUI 🔥)
    // =========================================================
    const results = await Promise.allSettled(
      subs.map((s: any) => {
        // 🔥 FIX PRINCIPAL: garantir formato correto Web Push
        const subscription = {
          endpoint: s.endpoint,
          keys: {
            p256dh: s.p256dh,
            auth: s.auth,
          },
        };

        return webpush.sendNotification(subscription, payload);
      })
    );

    // =========================================================
    // LIMPAR INVÁLIDOS
    // =========================================================
    for (let i = 0; i < results.length; i++) {
      const r = results[i];

      if (r.status === "rejected") {
        const code = (r.reason as any)?.statusCode;

        if (code === 404 || code === 410) {
          console.log("Removendo subscription inválida:", subs[i].endpoint);

          await sb
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", subs[i].endpoint);
        }

        console.error("Push erro:", r.reason);
      }
    }

    const sentCount = results.filter((r) => r.status === "fulfilled").length;

    return json({
      sent: sentCount,
      total: subs.length,
    });
  } catch (e) {
    console.error("Erro geral:", e);
    return json({ error: String(e) }, 500);
  }
});

// =========================================================
// helper
// =========================================================
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}