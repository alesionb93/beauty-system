// ============================================================
// SUPABASE EDGE FUNCTION: create-whatsapp-session
// ------------------------------------------------------------
// Recebe dados de uma conversa iniciada no WhatsApp (via webhook
// da Evolution API ou trigger manual) e:
//   1) Garante idempotência por message_id (whatsapp_inbound_seen)
//      — de forma NÃO-BLOQUEANTE (nunca derruba o envio).
//   2) Cria uma sessão temporária na tabela whatsapp_sessions.
//   3) Envia uma mensagem acolhedora com o link mágico via
//      Evolution API (classic ou Evolution Go).
//   4) Utiliza o NOME DO GRUPO de unidades (tenant_groups) quando
//      existir, caindo em nome_fantasia/nome como fallback.
//
// Logs estruturados: prefixo [wa-session] em TODAS as etapas.
// Cada etapa importante tem um marcador [STEP N] para facilitar
// identificar exatamente onde o fluxo interrompe.
//
// CHANGELOG:
// - 2026-07-10: HARDENING
//     * try/catch GLOBAL — qualquer throw agora é logado ([FATAL])
//       ao invés de virar um 500 opaco (causa raiz do "só aparece
//       RAW BODY nos logs").
//     * Idempotência (whatsapp_inbound_seen) isolada em try/catch
//       e NÃO-BLOQUEANTE. Se a tabela não existir ou der erro,
//       apenas logamos e seguimos — o link mágico continua sendo
//       enviado.
//     * Logs [STEP 1..12] cobrindo webhook → validação → tenant →
//       grupo → sessão → Evolution → done.
//     * Lookup do grupo em DUAS queries separadas (sem embed
//       PostgREST), robusto a schemas sem FK declarada. Preserva
//       a melhoria "Grupo Ander Barber Shop".
// - 2026-06-19: Idempotência por message_id.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BASE_URL = "https://slotify.pilotodigital.online";
const SESSION_TTL_MINUTES = 30;
const LOG_PREFIX = "[wa-session]";

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

function extractMessageId(body: any): string | null {
  const data = body?.data ?? {};
  const fromGo = data?.Info?.ID;
  const fromClassic = data?.key?.id;
  const raw = fromGo || fromClassic || null;
  if (!raw) return null;
  const s = String(raw).trim();
  return s ? s.slice(0, 200) : null;
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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const reqId = newReqId();
  const t0 = Date.now();

  // ---------- [STEP 1] REQUEST RECEBIDO (LOG IMEDIATO) ----------
  // Este log DEVE aparecer sempre, antes de QUALQUER operação
  // que possa falhar. Se ele não aparecer, o problema é infra.
  console.log(`${LOG_PREFIX} ${reqId} [STEP 1] request received`, {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    console.warn(`${LOG_PREFIX} ${reqId} method not allowed`, { method: req.method });
    return jsonResponse({ ok: false, error: "method not allowed" }, 405);
  }

  // ============================================================
  // TRY/CATCH GLOBAL — garante que QUALQUER exceção
  // (rede, schema, parse, RLS, timeout) seja logada como [FATAL]
  // com stack, ao invés de virar um 500 opaco sem rastro.
  // ============================================================
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      console.error(`${LOG_PREFIX} ${reqId} [FATAL] missing Supabase env vars`, {
        has_url: !!supabaseUrl,
        has_service_role: !!supabaseKey,
      });
      return jsonResponse({ ok: false, error: "server misconfigured" }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ---------- Parse do body ----------
    let body: any = {};
    let rawBodyText = "";
    try {
      rawBodyText = await req.text();
      body = rawBodyText ? JSON.parse(rawBodyText) : {};
      console.log(`${LOG_PREFIX} ${reqId} [RAW BODY]`, JSON.stringify(body));
    } catch (e) {
      console.error(`${LOG_PREFIX} ${reqId} failed to parse JSON body`, {
        error: String(e),
        raw_preview: rawBodyText.slice(0, 500),
      });
      // Body malformado — retornamos 200 para não gerar reenvio da Evolution.
      return jsonResponse({ ok: true, skipped: true, reason: "invalid_json_body" });
    }

    console.log(`${LOG_PREFIX} ${reqId} [STEP 1.1] body parsed`, {
      event: body?.event,
      has_data: !!body?.data,
      instance: body?.instance ?? body?.instanceName,
      has_tenant_id: !!body?.tenant_id,
    });

    // ============================================================
    // [STEP 1.5] IDEMPOTÊNCIA — NÃO BLOQUEANTE
    // ------------------------------------------------------------
    // Se `whatsapp_inbound_seen` não existir, tiver schema diferente
    // ou qualquer erro ocorrer, apenas LOGAMOS e seguimos. Nunca
    // derrubamos o envio por causa da dedup. Duplicatas continuam
    // sendo detectadas quando a tabela existe corretamente.
    // ============================================================
    if (body?.data) {
      const messageId = extractMessageId(body);
      if (messageId) {
        try {
          const { error: seenErr } = await supabase
            .from("whatsapp_inbound_seen")
            .insert({
              message_id: messageId,
              instance: body?.instance ?? body?.instanceName ?? null,
              remote_jid:
                body?.data?.key?.remoteJid ??
                body?.data?.Info?.Chat ??
                body?.data?.Info?.Sender ??
                null,
            });

          if (seenErr) {
            const isDuplicate =
              (seenErr as any).code === "23505" ||
              /duplicate key|already exists/i.test(seenErr.message || "");
            if (isDuplicate) {
              console.log(`${LOG_PREFIX} ${reqId} [STEP 1.5] EXIT duplicate webhook`, {
                message_id: messageId,
                ms: Date.now() - t0,
              });
              return jsonResponse({
                ok: true,
                skipped: true,
                reason: "duplicate_webhook_delivery",
                message_id: messageId,
              });
            }
            console.error(`${LOG_PREFIX} ${reqId} [STEP 1.5] dedup insert error (CONTINUING)`, {
              error: seenErr.message,
              code: (seenErr as any).code,
            });
          } else {
            console.log(`${LOG_PREFIX} ${reqId} [STEP 1.5] inbound marked as seen`, {
              message_id: messageId,
            });
          }
        } catch (dedupThrow) {
          console.error(`${LOG_PREFIX} ${reqId} [STEP 1.5] dedup THREW (CONTINUING)`, {
            error: String(dedupThrow),
          });
        }
      } else {
        console.log(`${LOG_PREFIX} ${reqId} [STEP 1.5] no message_id, skipping dedup`);
      }
    }

    // ---------- Extração de campos ----------
    let tenant_id: string | null = body?.tenant_id ?? null;
    let telefone: string | null = onlyDigits(body?.telefone) || null;
    let nome: string | null = safeName(body?.nome);
    let instance: string | null = body?.instance ?? null;
    if (!instance && body?.instanceName) instance = String(body.instanceName);

    // ---------- [STEP 2] FILTRO INBOUND ----------
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
        isEvolutionGo ? info.Chat || info.Sender || "" : key.remoteJid || ""
      );
      const eventName: string = isEvolutionGo
        ? "message"
        : String(ev.event || "").toLowerCase();
      const msgType: string = String(
        isEvolutionGo ? info.Type || "" : data.messageType || ""
      ).toLowerCase();
      const fromMe = isEvolutionGo ? info.IsFromMe : key.fromMe;
      const incomingInstance = isEvolutionGo
        ? String(ev.instanceName || "")
        : String(ev.instance || "");

      const ignore = (reason: string, extra: Record<string, unknown> = {}) => {
        console.log(`${LOG_PREFIX} ${reqId} [STEP 2] ignored`, {
          reason, event: eventName, msgType, remoteJid, fromMe,
          instance: incomingInstance || ev.instance, ...extra,
        });
        return jsonResponse({ ok: true, skipped: true, reason });
      };

      if (
        eventName &&
        !eventName.includes("messages.upsert") &&
        !(isEvolutionGo && eventName === "message")
      ) {
        return ignore(`ignored_event:${eventName}`);
      }
      if (fromMe === true) return ignore("ignored_outbound_fromMe");
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
      if (blockedTypes.includes(msgType)) return ignore(`ignored_message_type:${msgType}`);
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

      const phoneFromJid = onlyDigits(remoteJid.split("@")[0]);
      console.log(`${LOG_PREFIX} ${reqId} [STEP 2] message accepted`, {
        text_length: textContent.length,
        pushName: data.pushName ?? info.PushName,
        remoteJid,
        instance: incomingInstance || ev.instance,
        msgType,
        telefone_normalizado: phoneFromJid,
      });
    }

    // ---------- Extras derivados ----------
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

    // ---------- [STEP 3] TENANT LOOKUP ----------
    const phoneFromParser = telefone ? onlyDigits(telefone) : "unknown";
    console.log(`${LOG_PREFIX} ${reqId} [STEP 3] tenant lookup start`, {
      instance, telefone_normalizado: phoneFromParser,
    });
    if (!tenant_id && instance) {
      const { data: ev, error: evErr } = await supabase
        .from("evolution_settings")
        .select("tenant_id, ativo")
        .eq("instance", instance)
        .eq("ativo", true)
        .maybeSingle();
      if (evErr) {
        console.error(`${LOG_PREFIX} ${reqId} [STEP 3] evolution_settings lookup error`, {
          instance, error: evErr.message,
        });
      }
      if (ev?.tenant_id) {
        tenant_id = ev.tenant_id;
      } else {
        console.warn(`${LOG_PREFIX} ${reqId} [STEP 3] no tenant for instance`, { instance });
      }
    }

    if (!tenant_id || !telefone) {
      console.log(`${LOG_PREFIX} ${reqId} EXIT missing_tenant_or_telefone`, {
        tenant_id: !!tenant_id, telefone: !!telefone, instance,
      });
      return jsonResponse({
        ok: false,
        error: "tenant_id (ou instance válida) e telefone são obrigatórios",
      }, 400);
    }

    // ---------- [STEP 4] TENANT RESOLVED + SETTINGS ----------
    console.log(`${LOG_PREFIX} ${reqId} [STEP 4] tenant resolved`, { tenant_id, instance });

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
    console.log(`${LOG_PREFIX} ${reqId} [STEP 4] tenant_settings`, {
      tenant_id,
      permitir_agendamento_cliente: settings?.permitir_agendamento_cliente,
      whatsapp_magic_link_enabled: settings?.whatsapp_magic_link_enabled,
    });

    if (!settings?.permitir_agendamento_cliente) {
      console.log(`${LOG_PREFIX} ${reqId} EXIT agendamento_online_disabled`, { tenant_id });
      return jsonResponse({
        ok: false, error: "agendamento online desabilitado para este tenant",
      }, 403);
    }
    if (!settings?.whatsapp_magic_link_enabled) {
      console.log(`${LOG_PREFIX} ${reqId} EXIT magic_link_disabled`, { tenant_id });
      return jsonResponse({
        ok: true, skipped: true, reason: "whatsapp_magic_link_disabled",
      });
    }

    // ---------- [STEP 5] TENANT + EVOLUTION ----------
    console.log(`${LOG_PREFIX} ${reqId} [STEP 5] loading tenant + evolution`, { tenant_id });
    const [
      { data: tenant, error: tenantErr },
      { data: evo, error: evoErr },
    ] = await Promise.all([
      supabase.from("tenants").select("id, nome, nome_fantasia").eq("id", tenant_id).maybeSingle(),
      supabase.from("evolution_settings").select("base_url, instance, api_key, ativo")
        .eq("tenant_id", tenant_id).maybeSingle(),
    ]);
    if (tenantErr) console.error(`${LOG_PREFIX} ${reqId} tenant lookup error`, { error: tenantErr.message });
    if (evoErr) console.error(`${LOG_PREFIX} ${reqId} evolution_settings lookup error`, { error: evoErr.message });

    if (!tenant) {
      console.log(`${LOG_PREFIX} ${reqId} EXIT tenant_not_found`, { tenant_id });
      return jsonResponse({ ok: false, error: "tenant não encontrado" }, 404);
    }

    console.log(`${LOG_PREFIX} ${reqId} [STEP 5] tenant + evolution loaded`, {
      tenant_nome: tenant?.nome_fantasia || tenant?.nome,
      evo_ativo: evo?.ativo,
      evo_instance: evo?.instance,
      evo_has_base_url: !!evo?.base_url,
      evo_has_api_key: !!evo?.api_key,
    });

    // ---------- [STEP 6] GRUPO (DUAS QUERIES, SEM EMBED) ----------
    // A relação é N:N via `tenant_group_tenants` (tenant_id, group_id).
    // Fazemos duas queries explícitas — mais robusto que embed PostgREST,
    // que exige FK declarada no schema para funcionar.
    let grupoNomeResolved: string | null = null;
    try {
      const { data: link, error: linkErr } = await supabase
        .from("tenant_group_tenants")
        .select("group_id")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .maybeSingle();
      if (linkErr) {
        console.error(`${LOG_PREFIX} ${reqId} [STEP 6] tenant_group_tenants lookup error`, {
          error: linkErr.message,
        });
      }
      const groupId = (link as any)?.group_id ?? null;
      if (groupId) {
        const { data: grp, error: grpErr } = await supabase
          .from("tenant_groups")
          .select("name")
          .eq("id", groupId)
          .maybeSingle();
        if (grpErr) {
          console.error(`${LOG_PREFIX} ${reqId} [STEP 6] tenant_groups lookup error`, {
            error: grpErr.message,
          });
        }
        grupoNomeResolved = (grp as any)?.name ?? null;
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} ${reqId} [STEP 6] grupo lookup THREW (continuing)`, {
        error: String(e),
      });
    }
    console.log(`${LOG_PREFIX} ${reqId} [STEP 6] grupo resolved`, {
      tenant_id, grupo_nome: grupoNomeResolved,
    });

    // ---------- [STEP 7] DEDUP DE SESSÃO ATIVA ----------
    const nowIso = new Date().toISOString();
    const phoneVariants = phoneLookupVariants(telefone);
    console.log(`${LOG_PREFIX} ${reqId} [STEP 7] session dedup lookup`, {
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
      console.error(`${LOG_PREFIX} ${reqId} [STEP 7] dedup query error`, { error: existingErr.message });
    }

    const baseUrl = Deno.env.get("PUBLIC_BOOKING_BASE_URL") || DEFAULT_BASE_URL;

    if (existingSession?.token) {
      const activeLink = `${baseUrl.replace(/\/+$/, "")}/agendamento-whatsapp.html?t=${existingSession.token}`;
      console.log(`${LOG_PREFIX} ${reqId} [STEP 7] EXIT session_reused — NO send`, {
        session_id: existingSession.id,
        expires_at: existingSession.expires_at,
        ms: Date.now() - t0,
      });
      return jsonResponse({
        ok: true, skipped: true,
        reason: "active_magic_link_already_exists",
        link: activeLink, expires_at: existingSession.expires_at,
      });
    }

    // ---------- [STEP 8] CRIA SESSÃO ----------
    const token = generateToken();
    const expires_at = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
    console.log(`${LOG_PREFIX} ${reqId} [STEP 8] creating session`, {
      tenant_id, telefone_normalizado: phoneFromParser,
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
      console.error(`${LOG_PREFIX} ${reqId} [STEP 8] session insert FAILED`, {
        tenant_id, telefone, error: insErr.message,
      });
      return jsonResponse({ ok: false, error: "falha ao criar sessão", detail: insErr.message }, 500);
    }
    console.log(`${LOG_PREFIX} ${reqId} [STEP 8] session created`, {
      session_id: insertedSession?.id,
      token_prefix: token.slice(0, 8),
      expires_at,
    });

    // ---------- Proteção race condition ----------
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
        console.warn(`${LOG_PREFIX} ${reqId} [STEP 8] concurrent session — deleting duplicate`, {
          kept: firstActiveSession.id, deleted: insertedSession.id,
        });
        await supabase.from("whatsapp_sessions").delete().eq("id", insertedSession.id);
        const activeLink = `${baseUrl.replace(/\/+$/, "")}/agendamento-whatsapp.html?t=${firstActiveSession.token}`;
        return jsonResponse({
          ok: true, skipped: true,
          reason: "active_magic_link_created_concurrently",
          link: activeLink, expires_at: firstActiveSession.expires_at,
        });
      }
    }

    // ---------- [STEP 9] MONTANDO MENSAGEM ----------
    const link = `${baseUrl.replace(/\/+$/, "")}/agendamento-whatsapp.html?t=${token}`;
    // PREFERIR o nome do GRUPO (marca da rede) sobre o nome da unidade.
    // Fallback: nome_fantasia > nome (cenário legado sem grupo).
    const tenantNome = grupoNomeResolved || tenant.nome_fantasia || tenant.nome || "nosso espaço";
    const mensagem = buildMessage(nome, link, tenantNome);
    console.log(`${LOG_PREFIX} ${reqId} [STEP 9] message built`, {
      tenant_nome_usado: tenantNome,
      usou_grupo: !!grupoNomeResolved,
      link_prefix: link.slice(0, 60),
      msg_length: mensagem.length,
    });

    // ---------- [STEP 10/11] ENVIO EVOLUTION ----------
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

      console.log(`${LOG_PREFIX} ${reqId} [STEP 10] sending to Evolution`, {
        provider, url,
        telefone_normalizado: phoneFromParser,
        instance_present: !!evo.instance,
      });

      try {
        const sendStartedAt = Date.now();
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": evo.api_key },
          body: JSON.stringify(payload),
        });
        const fetchDurationMs = Date.now() - sendStartedAt;
        const txt = await resp.text();
        let json: any = null;
        try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
        envio = { http_status: resp.status, ok: resp.ok, response: json, duration_ms: fetchDurationMs };

        console.log(`${LOG_PREFIX} ${reqId} [STEP 11] Evolution response`, {
          http_status: resp.status, ok: resp.ok,
          fetch_duration_ms: fetchDurationMs,
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
        console.error(`${LOG_PREFIX} ${reqId} [STEP 11] Evolution send FAILED`, {
          url, instance: evo.instance, error: String(e),
        });
        envio = { ok: false, error: String(e) };
        await supabase.from("whatsapp_notifications_log").insert({
          tenant_id, telefone, status: "erro",
          payload: { tipo: "magic_link" }, erro: String(e),
        });
      }
    } else {
      console.warn(`${LOG_PREFIX} ${reqId} [STEP 10] Evolution settings incomplete — NOT sent`, {
        ativo: evo?.ativo, has_base_url: !!evo?.base_url,
        has_instance: !!evo?.instance, has_api_key: !!evo?.api_key,
      });
    }

    // ---------- [STEP 12] DONE ----------
    console.log(`${LOG_PREFIX} ${reqId} [STEP 12] done`, {
      tenant_id, telefone, ms: Date.now() - t0,
      envio_ok: envio?.ok, envio_status: envio?.http_status,
    });

    return jsonResponse({
      ok: true, link, token, expires_at, created: true, envio,
    });
  } catch (fatal) {
    // ============================================================
    // Qualquer throw não previsto cai aqui — antes ficava opaco
    // como um 500 sem log, escondendo a causa raiz.
    // ============================================================
    console.error(`${LOG_PREFIX} ${reqId} [FATAL] unhandled exception`, {
      error: String(fatal),
      stack: (fatal as any)?.stack,
      ms: Date.now() - t0,
    });
    return jsonResponse({
      ok: false, error: "internal_error", detail: String(fatal),
    }, 500);
  }
});
