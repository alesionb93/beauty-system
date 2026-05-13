// ============================================================
// SUPABASE EDGE FUNCTION: create-whatsapp-session
// ------------------------------------------------------------
// Recebe dados de uma conversa iniciada no WhatsApp (via webhook
// da Evolution API ou trigger manual) e:
//   1) Cria uma sessão temporária na tabela whatsapp_sessions
//   2) Envia uma mensagem acolhedora com o link mágico via Evolution API
//
// Logs estruturados: prefixo [wa-session] em todas as etapas.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BASE_URL = "https://app.seudominio.com";
const SESSION_TTL_MINUTES = 30;
const LOG_PREFIX = "[wa-session]";

// id curto para correlacionar logs de uma mesma request
function newReqId() {
  return Math.random().toString(36).slice(2, 10);
}

function onlyDigits(s: string | null | undefined) {
  return String(s || "").replace(/\D+/g, "");
}

function safeName(n: string | null | undefined) {
  const v = String(n || "").trim();
  if (!v) return null;
  return v.slice(0, 80);
}

function phoneLookupVariants(phone: string) {
  const raw = onlyDigits(phone);
  const values = new Set<string>();
  const add = (value: string | null | undefined) => {
    const digits = onlyDigits(value);
    if (digits) values.add(digits);
  };
  add(raw);
  const local = raw.startsWith("55") && raw.length > 11 ? raw.slice(2) : raw;
  add(local);
  if (local.length === 10 || local.length === 11) add(`55${local}`);
  if (local.length === 11 && local[2] === "9") {
    const withoutMobileNine = `${local.slice(0, 2)}${local.slice(3)}`;
    add(withoutMobileNine);
    add(`55${withoutMobileNine}`);
  }
  if (local.length === 10) {
    const withMobileNine = `${local.slice(0, 2)}9${local.slice(2)}`;
    add(withMobileNine);
    add(`55${withMobileNine}`);
  }
  return Array.from(values);
}

function whatsappSendNumber(phone: string) {
  const raw = onlyDigits(phone);
  if (raw.startsWith("55") || !(raw.length === 10 || raw.length === 11)) return raw;
  return `55${raw}`;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMessage(nome: string | null, link: string, tenantNome: string) {
  const saud = nome ? `Olá, ${nome}! 😄` : "Olá! 😄";
  return (
`${saud}
Que bom ter você por aqui na *${tenantNome}* ✨

Para deixar tudo mais rápido, preparamos um link exclusivo onde você escolhe *serviço, profissional e horário* em poucos toques 👇

${link}

⏱️ O link é válido por ${SESSION_TTL_MINUTES} minutos.
Qualquer dúvida, é só responder esta conversa 💬`
  );
}

Deno.serve(async (req) => {
  const reqId = newReqId();
  const t0 = Date.now();

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    console.warn(`${LOG_PREFIX} ${reqId} method not allowed`, { method: req.method });
    return new Response(JSON.stringify({ ok: false, error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  let rawBodyText = "";
  try {
    rawBodyText = await req.text();
    body = rawBodyText ? JSON.parse(rawBodyText) : {};
    console.log("[wa-session][RAW BODY]", JSON.stringify(body, null, 2));
  } catch (e) {
    console.error(`${LOG_PREFIX} ${reqId} failed to parse JSON body`, {
      error: String(e),
      raw_preview: rawBodyText.slice(0, 500),
    });
  }

  // ----- 1) REQUEST RECEBIDA
  console.log(`${LOG_PREFIX} ${reqId} request received`, {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    headers: {
      "content-type": req.headers.get("content-type"),
      "user-agent": req.headers.get("user-agent"),
      "x-forwarded-for": req.headers.get("x-forwarded-for"),
    },
    event: body?.event,
    has_data: !!body?.data,
    instance: body?.instance ?? body?.instanceName,
    body,
  });

  let tenant_id: string | null = body?.tenant_id ?? null;
  let telefone: string | null = onlyDigits(body?.telefone) || null;
  let nome: string | null = safeName(body?.nome);
  let instance: string | null = body?.instance ?? null;

  if (!instance && body?.instanceName) {
    instance = String(body.instanceName);
  }

  // ----- FILTRO INBOUND
  if (body?.data && !body?.tenant_id) {
    const ev = body;
    const data = ev.data ?? {};
    const isEvolutionGo =
      String(ev.event || "").toLowerCase() === "message" &&
      Boolean(data.Info);
    const key = data.key ?? {};
    const info = data.Info ?? {};
    const message = data.message ?? {};
    const remoteJid: string = String(
      isEvolutionGo
        ? info.Chat || info.Sender || ""
        : key.remoteJid || ""
    );
    const eventName: string = isEvolutionGo
      ? "message"
      : String(ev.event || "").toLowerCase();
    const msgType: string = String(
      isEvolutionGo
        ? info.Type || ""
        : data.messageType || ""
    ).toLowerCase();
    const fromMe = isEvolutionGo ? info.IsFromMe : key.fromMe;
    const incomingInstance = isEvolutionGo
      ? String(ev.instanceName || "")
      : String(ev.instance || "");

    const ignore = (reason: string, extra: Record<string, unknown> = {}) => {
      console.log(`${LOG_PREFIX} ${reqId} ignored message`, {
        reason,
        event: eventName,
        msgType,
        remoteJid,
        fromMe,
        instance: incomingInstance || ev.instance,
        ...extra,
      });
      return new Response(JSON.stringify({ ok: true, skipped: true, reason }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };

    if (
      eventName &&
      !eventName.includes("messages.upsert") &&
      !(isEvolutionGo && eventName === "message")
    ) {
      return ignore(`ignored_event:${eventName}`);
    }
    if (fromMe === true) {
      return ignore("ignored_outbound_fromMe");
    }
    if (
      !remoteJid ||
      remoteJid.endsWith("@g.us") ||
      remoteJid.endsWith("@broadcast") ||
      remoteJid.endsWith("@newsletter") ||
      remoteJid.includes("status@")
    ) {
      return ignore("ignored_non_private_chat");
    }

    const blockedTypes = [
      "protocolmessage", "reactionmessage", "editedmessage",
      "pollupdatemessage", "ephemeralmessage", "viewoncemessage",
      "senderkeydistributionmessage",
    ];
    if (blockedTypes.includes(msgType)) {
      return ignore(`ignored_message_type:${msgType}`);
    }
    if (
      message.protocolMessage || message.reactionMessage ||
      message.editedMessage || message.pollUpdateMessage ||
      message.senderKeyDistributionMessage
    ) {
      return ignore("ignored_protocol_or_reaction");
    }

    const textContent: string = isEvolutionGo
      ? String(data.Message?.conversation || data.Message?.extendedTextMessage?.text || "")
      : (typeof message.conversation === "string" && message.conversation) ||
        (message.extendedTextMessage?.text as string) ||
        "";
    if (!textContent || !textContent.trim()) {
      return ignore("ignored_no_text_content", { msgType });
    }

    // ----- 2) MENSAGEM EXTRAÍDA E ACEITA
    const phoneFromJid = onlyDigits(remoteJid.split("@")[0]);
    console.log(`${LOG_PREFIX} ${reqId} message accepted`, {
      text: textContent,
      text_length: textContent.length,
      pushName: data.pushName,
      remoteJid,
      instance: incomingInstance || ev.instance,
      msgType,
      telefone_normalizado: phoneFromJid,
    });
  }

  if (!tenant_id && body?.instanceName) instance = String(body.instanceName);
  else if (!tenant_id && body?.instance) instance = String(body.instance);
  if (!telefone && body?.data?.key?.remoteJid) {
    telefone = onlyDigits(String(body.data.key.remoteJid).split("@")[0]);
  }
  if (!telefone && body?.data?.Info?.Chat) {
    telefone = onlyDigits(String(body.data.Info.Chat).split("@")[0]);
  }
  if (!telefone && body?.data?.Info?.Sender) {
    telefone = onlyDigits(String(body.data.Info.Sender).split("@")[0]);
  }
  if (!nome && body?.data?.pushName) nome = safeName(body.data.pushName);
  if (!nome && body?.data?.Info?.PushName) nome = safeName(body.data.Info.PushName);

  // ----- 4) RESOLUÇÃO DE TENANT
  const phoneFromParser = telefone ? onlyDigits(telefone) : "unknown";
  console.log(`${LOG_PREFIX} ${reqId} tenant lookup start`, {
    instance,
    telefone_normalizado: phoneFromParser,
  });
  if (!tenant_id && instance) {
    const { data: ev, error: evErr } = await supabase
      .from("evolution_settings")
      .select("tenant_id, ativo")
      .eq("instance", instance)
      .eq("ativo", true)
      .maybeSingle();
    if (evErr) {
      console.error(`${LOG_PREFIX} ${reqId} evolution_settings lookup error`, {
        instance, error: evErr.message,
      });
    }
    if (ev?.tenant_id) {
      tenant_id = ev.tenant_id;
      console.log(`${LOG_PREFIX} ${reqId} tenant resolved from instance`, {
        instance, tenant_id,
      });
    } else {
      console.warn(`${LOG_PREFIX} ${reqId} no tenant for instance`, { instance });
    }
  }

  if (!tenant_id || !telefone) {
    console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
      reason: "missing_tenant_id_or_telefone",
      tenant_id: !!tenant_id,
      telefone: !!telefone,
      instance,
    });
    console.log(`${LOG_PREFIX} ${reqId} tenant lookup result`, {
      tenant_found: !!tenant_id,
      tenant_id,
    });
    console.warn(`${LOG_PREFIX} ${reqId} missing tenant_id or telefone`, {
      tenant_id, telefone, instance,
    });
    return new Response(JSON.stringify({
      ok: false,
      error: "tenant_id (ou instance válida) e telefone são obrigatórios",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: settings, error: settingsErr } = await supabase
    .from("tenant_settings")
    .select("permitir_agendamento_cliente, whatsapp_magic_link_enabled")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (settingsErr) {
    console.error(`${LOG_PREFIX} ${reqId} tenant_settings lookup error`, {
      tenant_id, error: settingsErr.message,
    });
  }
  console.log(`${LOG_PREFIX} ${reqId} tenant_settings`, {
    tenant_id,
    permitir_agendamento_cliente: settings?.permitir_agendamento_cliente,
    whatsapp_magic_link_enabled: settings?.whatsapp_magic_link_enabled,
  });

  if (!settings?.permitir_agendamento_cliente) {
    console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
      reason: "agendamento_online_disabled",
      tenant_id,
    });
    console.warn(`${LOG_PREFIX} ${reqId} agendamento online desabilitado`, { tenant_id });
    return new Response(JSON.stringify({
      ok: false,
      error: "agendamento online desabilitado para este tenant",
    }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!settings?.whatsapp_magic_link_enabled) {
    console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
      reason: "magic_link_feature_flag_disabled",
      tenant_id,
    });
    console.log(`${LOG_PREFIX} ${reqId} magic link feature flag desativada`, { tenant_id });
    return new Response(JSON.stringify({
      ok: true, skipped: true, reason: "whatsapp_magic_link_disabled",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  console.log(`${LOG_PREFIX} ${reqId} evolution settings lookup`, {
    tenant_id,
    instance,
  });
  const [{ data: tenant, error: tenantErr }, { data: evo, error: evoErr }] = await Promise.all([
    supabase.from("tenants").select("id, nome, nome_fantasia").eq("id", tenant_id).maybeSingle(),
    supabase.from("evolution_settings").select("base_url, instance, api_key, ativo")
      .eq("tenant_id", tenant_id).maybeSingle(),
  ]);
  console.log(`${LOG_PREFIX} ${reqId} evolution settings result`, {
    found: !!evo,
    base_url: evo?.base_url,
    instance: evo?.instance,
    ativo: evo?.ativo,
  });

  if (tenantErr) console.error(`${LOG_PREFIX} ${reqId} tenant lookup error`, { error: tenantErr.message });
  if (evoErr) console.error(`${LOG_PREFIX} ${reqId} evolution_settings lookup error`, { error: evoErr.message });

  console.log(`${LOG_PREFIX} ${reqId} tenant + evolution loaded`, {
    tenant_found: !!tenant,
    tenant_nome: tenant?.nome_fantasia || tenant?.nome,
    evo_ativo: evo?.ativo,
    evo_instance: evo?.instance,
    evo_base_url: evo?.base_url,
    evo_has_api_key: !!evo?.api_key,
  });

  if (!tenant) {
    console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
      reason: "tenant_not_found",
      tenant_id,
    });
    console.warn(`${LOG_PREFIX} ${reqId} tenant not found`, { tenant_id });
    return new Response(JSON.stringify({ ok: false, error: "tenant não encontrado" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ----- 5) DEDUPLICAÇÃO
  const nowIso = new Date().toISOString();
  const phoneVariants = phoneLookupVariants(telefone);
  console.log(`${LOG_PREFIX} ${reqId} dedup lookup`, {
    tenant_id, telefone, phoneVariants,
  });

  const { data: existingSession, error: existingErr } = await supabase
    .from("whatsapp_sessions")
    .select("id, token, telefone, expires_at")
    .eq("tenant_id", tenant_id)
    .in("telefone", phoneVariants)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    console.error(`${LOG_PREFIX} ${reqId} dedup query error`, { error: existingErr.message });
  }

  const baseUrl = Deno.env.get("PUBLIC_BOOKING_BASE_URL") || DEFAULT_BASE_URL;

  if (existingSession?.token) {
    const activeLink = `${baseUrl.replace(/\/+$/, "")}/agendamento-whatsapp.html?t=${existingSession.token}`;
    console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
      reason: "existing_active_session_reused",
      session_id: existingSession.id,
    });
    console.log(`${LOG_PREFIX} ${reqId} active session reused — NO send`, {
      tenant_id,
      session_id: existingSession.id,
      telefone_match: existingSession.telefone,
      expires_at: existingSession.expires_at,
      ms: Date.now() - t0,
    });
    return new Response(JSON.stringify({
      ok: true, skipped: true,
      reason: "active_magic_link_already_exists",
      link: activeLink, expires_at: existingSession.expires_at,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const token = generateToken();
  const expires_at = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  console.log(`${LOG_PREFIX} ${reqId} creating session`, {
    telefone_normalizado: phoneFromParser,
    tenant_id,
  });

  const { data: insertedSession, error: insErr } = await supabase
    .from("whatsapp_sessions")
    .insert({
      tenant_id, telefone, nome, token, expires_at,
      ip: req.headers.get("x-forwarded-for"),
      user_agent: req.headers.get("user-agent"),
    })
    .select("id, created_at")
    .single();

  if (insErr) {
    console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
      reason: "session_insert_failed",
      tenant_id,
      telefone,
      error: insErr.message,
    });
    console.error(`${LOG_PREFIX} ${reqId} insert session FAILED`, {
      tenant_id, telefone, error: insErr.message,
    });
    return new Response(JSON.stringify({ ok: false, error: "falha ao criar sessão", detail: insErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`${LOG_PREFIX} ${reqId} new session created`, {
    session_id: insertedSession?.id,
    tenant_id, telefone,
    token_prefix: token.slice(0, 8),
    expires_at,
  });
  console.log(`${LOG_PREFIX} ${reqId} session created result`, {
    session_id: insertedSession?.id,
    magic_link_created: true,
  });

  // proteção race condition
  if (insertedSession?.id) {
    const { data: firstActiveSession } = await supabase
      .from("whatsapp_sessions")
      .select("id, token, expires_at")
      .eq("tenant_id", tenant_id)
      .in("telefone", phoneVariants)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstActiveSession?.id && firstActiveSession.id !== insertedSession.id) {
      console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
        reason: "concurrent_session_detected",
        kept: firstActiveSession.id,
        deleted: insertedSession.id,
      });
      console.warn(`${LOG_PREFIX} ${reqId} concurrent session detected — deleting duplicate`, {
        kept: firstActiveSession.id,
        deleted: insertedSession.id,
      });
      await supabase.from("whatsapp_sessions").delete().eq("id", insertedSession.id);
      const activeLink = `${baseUrl.replace(/\/+$/, "")}/agendamento-whatsapp.html?t=${firstActiveSession.token}`;
      return new Response(JSON.stringify({
        ok: true, skipped: true,
        reason: "active_magic_link_created_concurrently",
        link: activeLink, expires_at: firstActiveSession.expires_at,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  const link = `${baseUrl.replace(/\/+$/, "")}/agendamento-whatsapp.html?t=${token}`;
  const tenantNome = tenant.nome_fantasia || tenant.nome || "nosso espaço";
  const mensagem = buildMessage(nome, link, tenantNome);

   // ----- 6) ENVIO WHATSAPP
   let envio: any = { skipped: true };
    if (evo?.ativo && evo.base_url && evo.instance && evo.api_key) {
      const baseUrlClean = String(evo.base_url || "").replace(/\/+$/, "");
      const isEvolutionGo = /evolution-go|evogo/i.test(baseUrlClean);
      const provider = isEvolutionGo ? "evolution-go" : "evolution-classic";
      const url = isEvolutionGo
        ? `${baseUrlClean}/send/text`
        : `${baseUrlClean}/message/sendText/${encodeURIComponent(evo.instance)}`;
      const sendNumber = whatsappSendNumber(telefone);
      const payload = { number: sendNumber, text: mensagem, textMessage: { text: mensagem } };
      console.log(`${LOG_PREFIX} ${reqId} [GO-ROUTE] provider=${provider} url=${url}`, {
        provider,
        url,
        telefone_normalizado: phoneFromParser,
        base_url: evo.base_url,
        instance_present: !!evo.instance,
      });

      try {
      const sendStartedAt = Date.now();
      console.log(`${LOG_PREFIX} ${reqId} Evolution send START`, {
        started_at: new Date(sendStartedAt).toISOString(),
      });
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": evo.api_key },
        body: JSON.stringify(payload),
      });
      const fetchDurationMs = Date.now() - sendStartedAt;
      console.log(`${LOG_PREFIX} ${reqId} Evolution send duration`, {
        duration_ms: fetchDurationMs,
      });
      const txt = await resp.text();
      const totalDurationMs = Date.now() - sendStartedAt;
      let json: any = null;
      try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
      envio = { http_status: resp.status, ok: resp.ok, response: json, duration_ms: fetchDurationMs };
      console.log(`${LOG_PREFIX} ${reqId} evolution response`, {
        status: resp.status,
        ok: resp.ok,
      });

      console.log(`${LOG_PREFIX} ${reqId} Evolution API response`, {
        http_status: resp.status, ok: resp.ok,
        fetch_duration_ms: fetchDurationMs,
        total_duration_ms: totalDurationMs,
        response_preview: txt.slice(0, 500),
      });

      await supabase.from("whatsapp_notifications_log").insert({
        tenant_id, telefone,
        status: resp.ok ? "enviado" : "erro",
        http_status: resp.status,
        payload: { tipo: "magic_link", token_prefix: token.slice(0, 8), created: true },
        response: json,
        erro: resp.ok ? null : `HTTP ${resp.status}`,
      });
    } catch (e) {
      console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
        reason: "evolution_api_fetch_error",
        error: String(e),
      });
      console.error(`${LOG_PREFIX} ${reqId} Evolution API send FAILED`, {
        url, instance: evo.instance, error: String(e),
      });
      envio = { ok: false, error: String(e) };
      await supabase.from("whatsapp_notifications_log").insert({
        tenant_id, telefone, status: "erro",
        payload: { tipo: "magic_link" }, erro: String(e),
      });
    }
  } else {
    console.log(`${LOG_PREFIX} ${reqId} EXIT_REASON`, {
      reason: "evolution_settings_incomplete",
      ativo: evo?.ativo,
      has_base_url: !!evo?.base_url,
      has_instance: !!evo?.instance,
      has_api_key: !!evo?.api_key,
    });
    console.warn(`${LOG_PREFIX} ${reqId} Evolution settings incomplete — message NOT sent`, {
      ativo: evo?.ativo, has_base_url: !!evo?.base_url,
      has_instance: !!evo?.instance, has_api_key: !!evo?.api_key,
    });
  }

  console.log(`${LOG_PREFIX} ${reqId} done`, {
    tenant_id, telefone, ms: Date.now() - t0,
    envio_ok: envio?.ok, envio_status: envio?.http_status,
  });

  return new Response(JSON.stringify({
    ok: true, link, token, expires_at, created: true, envio,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
