// ============================================================
// SUPABASE EDGE FUNCTION: notify-whatsapp
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function fmtHora(h: string) {
  return (h || "").slice(0, 5);
}

function fmtData(d: string) {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

function onlyDigits(s: string | null | undefined) {
  return String(s || "").replace(/\D+/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let agendamento_id: string | null = null;

  try {
    const body = await req.json();
    agendamento_id = body?.agendamento_id ?? null;
  } catch (_) {}

  if (!agendamento_id) {
    return new Response(
      JSON.stringify({ ok: false, error: "agendamento_id obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // =========================
  // 1) AGENDAMENTO
  // =========================
  const { data: ag, error: agErr } = await supabase
    .from("agendamentos")
    .select("id, tenant_id, cliente_nome, cliente_telefone, profissional_id, data, hora, origem, observacoes")
    .eq("id", agendamento_id)
    .maybeSingle();

  if (agErr || !ag) {
    return new Response(
      JSON.stringify({ ok: false, error: "agendamento não encontrado" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // =========================
  // DEBUG IMPORTANTE
  // =========================
  console.log("AG:", ag);

  // =========================
  // FILTRO ORIGEM
  // =========================
  if (ag.origem !== "externo") {
    await supabase.from("whatsapp_notifications_log").insert({
      tenant_id: ag.tenant_id,
      agendamento_id: ag.id,
      profissional_id: ag.profissional_id,
      status: "ignorado",
      erro: `origem=${ag.origem}`,
    });

    return new Response(
      JSON.stringify({ ok: true, ignored: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // =========================
  // PROFISSIONAL
  // =========================
  const { data: prof } = await supabase
    .from("profissionais")
    .select("id, nome, telefone")
    .eq("id", ag.profissional_id)
    .maybeSingle();

  const telefone = onlyDigits(prof?.telefone);

  if (!telefone) {
    await supabase.from("whatsapp_notifications_log").insert({
      tenant_id: ag.tenant_id,
      agendamento_id: ag.id,
      profissional_id: ag.profissional_id,
      status: "erro",
      erro: "sem telefone",
    });

    return new Response(
      JSON.stringify({ ok: false, error: "sem telefone" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // =========================
  // SERVIÇOS
  // =========================
  const { data: servs } = await supabase
    .from("agendamento_servicos")
    .select("servicos:servico_id(nome)")
    .eq("agendamento_id", ag.id);

  const listaServ = (servs || [])
    .map((s: any) => `• ${s?.servicos?.nome ?? "Serviço"}`)
    .join("\n");

  // =========================
  // EVOLUTION SETTINGS
  // =========================
  const { data: cfg } = await supabase
    .from("evolution_settings")
    .select("base_url, instance, api_key, ativo")
    .eq("tenant_id", ag.tenant_id)
    .maybeSingle();

  console.log("CFG:", cfg);

  if (!cfg || !cfg.ativo) {
    await supabase.from("whatsapp_notifications_log").insert({
      tenant_id: ag.tenant_id,
      agendamento_id: ag.id,
      profissional_id: ag.profissional_id,
      status: "ignorado",
      erro: "cfg ausente/inativo",
    });

    return new Response(
      JSON.stringify({ ok: true, ignored: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // =========================
  // MENSAGEM
  // =========================
  const text =
    `📅 *Novo agendamento*\n` +
    `👤 Cliente: ${ag.cliente_nome}\n` +
    `📞 Tel: ${ag.cliente_telefone || "-"}\n` +
    `💇 Serviço(s):\n${listaServ || "• (não informado)"}\n` +
    `🗓 Data: ${fmtData(ag.data)}\n` +
    `⏰ Horário: ${fmtHora(ag.hora)}\n` +
    `\n_Origem: link de agendamento online_`;

  const url =
    `${cfg.base_url.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(cfg.instance)}`;

  const payload = { number: telefone, text };

  console.log("URL:", url);
  console.log("PAYLOAD:", payload);

  let httpStatus = 0;
  let respJson: any = null;
  let erro: string | null = null;

  // ===== Timeout explícito (15s) via AbortController =====
  const FETCH_TIMEOUT_MS = 15000;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort("timeout");
    console.log(`EVOLUTION FETCH TIMEOUT: abortado após ${FETCH_TIMEOUT_MS}ms`);
  }, FETCH_TIMEOUT_MS);

  const fetchStart = Date.now();
  console.log("EVOLUTION FETCH START:", url);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.api_key,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    httpStatus = r.status;

    const raw = await r.text();

    console.log("EVOLUTION STATUS:", r.status, `(${Date.now() - fetchStart}ms)`);
    console.log("EVOLUTION RESPONSE:", raw);

    try {
      respJson = JSON.parse(raw);
    } catch (_) {
      respJson = { raw };
    }

    if (!r.ok) erro = `HTTP ${r.status}`;
  } catch (e: any) {
    clearTimeout(timeout);

    if (timedOut || e?.name === "AbortError") {
      erro = `timeout após ${FETCH_TIMEOUT_MS}ms`;
      console.log("FETCH ERROR (TIMEOUT):", erro, `(${Date.now() - fetchStart}ms)`);
    } else {
      erro = e?.message || "fetch falhou";
      console.log("FETCH ERROR:", erro, `(${Date.now() - fetchStart}ms)`);
    }
  }

  // =========================
  // LOG FINAL
  // =========================
  await supabase.from("whatsapp_notifications_log").insert({
    tenant_id: ag.tenant_id,
    agendamento_id: ag.id,
    profissional_id: ag.profissional_id,
    telefone,
    status: erro ? "erro" : "enviado",
    http_status: httpStatus || null,
    payload,
    response: respJson,
    erro,
  });

  return new Response(
    JSON.stringify({ ok: !erro, http: httpStatus, erro }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
