// ============================================================
// SUPABASE EDGE FUNCTION: notify-reminders  (v2 — smart reminders)
// ------------------------------------------------------------
// Envia 1 (UM) lembrete de agendamento por agendamento, escolhendo
// automaticamente entre:
//   - reminder_24h  → quando o agendamento foi criado com ≥ 24h de antecedência
//   - reminder_2h   → quando o agendamento foi criado entre 2h e 24h antes
//   - nenhum        → quando criado com < 2h de antecedência
//
// Deve ser invocada por pg_cron a cada 5 min (mesma cron atual).
//
// Anti-duplicidade:
//   - agendamentos.reminder_24h_sent_at  (já existente)
//   - agendamentos.reminder_2h_sent_at   (NOVA — ver migração SQL)
//
// Logs:
//   - whatsapp_notifications_log.erro/payload identifica o tipo
//     ("reminder_24h: ..." ou "reminder_2h: ...") para auditoria.
//
// Compatível com fluxo notify-whatsapp (confirmação imediata) — não altera.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Janela em torno do alvo (cron de 5 min => 6 min de folga p/ cada lado)
const WINDOW_MIN = 6;

// Timezone padrão do tenant (America/Sao_Paulo, sem DST atual)
const TZ_OFFSET_HOURS = -3;

// Regras de antecedência (em ms)
const MS_24H = 24 * 60 * 60 * 1000;
const MS_2H  =  2 * 60 * 60 * 1000;

function fmtHora(h: string) {
  return (h || "").slice(0, 5);
}

function onlyDigits(s: string | null | undefined) {
  return String(s || "").replace(/\D+/g, "");
}

// Combina date (YYYY-MM-DD) + time (HH:MM[:SS]) interpretando como horário
// local do tenant.
function toAppointmentDate(data: string, hora: string): Date {
  const [y, m, d] = data.split("-").map(Number);
  const [hh, mm] = (hora || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - TZ_OFFSET_HOURS, mm));
}

function localDateStr(ms: number): string {
  const localMs = ms + TZ_OFFSET_HOURS * 60 * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const nowMs = now.getTime();

  // === Janelas alvo: 24h e 2h à frente ===
  const target24Ms = nowMs + MS_24H;
  const target2Ms  = nowMs + MS_2H;
  const win = WINDOW_MIN * 60 * 1000;

  // Datas locais a buscar (cobre as duas janelas — 24h pode cair em
  // hoje/amanhã/depois; 2h cai em hoje/amanhã).
  const datas = new Set<string>([
    localDateStr(target24Ms - win),
    localDateStr(target24Ms),
    localDateStr(target24Ms + win),
    localDateStr(target2Ms  - win),
    localDateStr(target2Ms),
    localDateStr(target2Ms  + win),
  ]);

  const { data: candidatos, error: candErr } = await supabase
    .from("agendamentos")
    .select(
      "id, tenant_id, profissional_id, cliente_nome, cliente_telefone, " +
      "data, hora, status, origem, created_at, " +
      "reminder_24h_sent_at, reminder_2h_sent_at",
    )
    .in("data", Array.from(datas));

  if (candErr) {
    console.log("CAND ERROR:", candErr);
    return new Response(
      JSON.stringify({ ok: false, error: candErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Classifica cada candidato em UM (e somente um) tipo de reminder elegível.
  type Tipo = "reminder_24h" | "reminder_2h";
  const elegiveis: Array<{ ag: any; tipo: Tipo }> = [];

  for (const ag of candidatos || []) {
    if (!ag.data || !ag.hora) continue;
    if (ag.status && /cancel/i.test(ag.status)) continue;

    const apptMs    = toAppointmentDate(ag.data, ag.hora).getTime();
    const createdMs = ag.created_at ? new Date(ag.created_at).getTime() : nowMs;
    const lead      = apptMs - createdMs; // antecedência no momento da criação

    // Bloqueio mútuo: se já mandamos qualquer reminder, ignora.
    const already24 = !!ag.reminder_24h_sent_at;
    const already2  = !!ag.reminder_2h_sent_at;
    if (already24 || already2) continue;

    // ---- Janela 24h ----
    // Elegível só se foi criado com ≥ 24h de antecedência (Cenário 1).
    if (lead >= MS_24H) {
      const diff24 = apptMs - target24Ms;
      if (Math.abs(diff24) <= win) {
        elegiveis.push({ ag, tipo: "reminder_24h" });
        continue;
      }
    }

    // ---- Janela 2h ----
    // Elegível se foi criado entre 2h e 24h antes (Cenário 2),
    // OU se passou da janela de 24h sem ter sido enviado (defensivo).
    if (lead >= MS_2H && lead < MS_24H) {
      const diff2 = apptMs - target2Ms;
      if (Math.abs(diff2) <= win) {
        elegiveis.push({ ag, tipo: "reminder_2h" });
        continue;
      }
    }
    // Cenário 3 (lead < 2h): nada a fazer.
  }

  console.log(
    `[reminders] now=${now.toISOString()} datas=${Array.from(datas).join(",")} ` +
    `candidatos=${candidatos?.length ?? 0} elegiveis=${elegiveis.length} ` +
    `window=±${WINDOW_MIN}min`,
  );

  // Cache de configuração Evolution por tenant
  const cfgCache = new Map<string, any>();
  async function getCfg(tenantId: string) {
    if (cfgCache.has(tenantId)) return cfgCache.get(tenantId);
    const { data: cfg } = await supabase
      .from("evolution_settings")
      .select("base_url, instance, api_key, ativo")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    cfgCache.set(tenantId, cfg);
    return cfg;
  }

  // Cache nome do tenant (para {empresa})
  const tenantCache = new Map<string, string>();
  async function getTenantNome(tenantId: string) {
    if (tenantCache.has(tenantId)) return tenantCache.get(tenantId)!;
    const { data: t } = await supabase
      .from("tenants")
      .select("nome")
      .eq("id", tenantId)
      .maybeSingle();
    const nome = (t?.nome as string) || "";
    tenantCache.set(tenantId, nome);
    return nome;
  }

  // Marca o reminder como "processado" no agendamento (sucesso OU erro,
  // para evitar loops a cada 5 min).
  async function marcarEnviado(agId: string, tipo: Tipo) {
    const col = tipo === "reminder_24h" ? "reminder_24h_sent_at" : "reminder_2h_sent_at";
    await supabase.from("agendamentos").update({ [col]: new Date().toISOString() }).eq("id", agId);
  }

  function montarMensagem(tipo: Tipo, nomeCliente: string, hora: string, empresa: string) {
    const cli = nomeCliente || "cliente";
    const emp = empresa ? ` na ${empresa} 💈` : " 💈";
    if (tipo === "reminder_24h") {
      return (
        `Olá ${cli} 👋\n\n` +
        `Passando para lembrar do seu horário amanhã às ${fmtHora(hora)}` + emp + `\n\n` +
        `Nos vemos em breve 😄`
      );
    }
    // reminder_2h
    return (
      `Olá ${cli} 👋\n\n` +
      `Passando para lembrar que seu horário${emp.replace(" 💈", "")} é hoje às ${fmtHora(hora)}.` +
      (empresa ? " 💈" : "") + `\n\n` +
      `Nos vemos em breve 😄`
    );
  }

  const resultados: any[] = [];

  for (const { ag, tipo } of elegiveis) {
    const telefone = onlyDigits(ag.cliente_telefone);

    // === Sem telefone: marca como enviado e loga erro ===
    if (!telefone) {
      await supabase.from("whatsapp_notifications_log").insert({
        tenant_id: ag.tenant_id,
        agendamento_id: ag.id,
        profissional_id: ag.profissional_id,
        status: "erro",
        erro: `${tipo}: sem telefone do cliente`,
      });
      await marcarEnviado(ag.id, tipo);
      resultados.push({ id: ag.id, tipo, status: "erro", erro: "sem telefone" });
      continue;
    }

    const cfg = await getCfg(ag.tenant_id);
    if (!cfg || !cfg.ativo) {
      await supabase.from("whatsapp_notifications_log").insert({
        tenant_id: ag.tenant_id,
        agendamento_id: ag.id,
        profissional_id: ag.profissional_id,
        status: "ignorado",
        erro: `${tipo}: cfg ausente/inativo`,
      });
      await marcarEnviado(ag.id, tipo);
      resultados.push({ id: ag.id, tipo, status: "ignorado" });
      continue;
    }

    const empresa = await getTenantNome(ag.tenant_id);
    const text = montarMensagem(tipo, ag.cliente_nome, ag.hora, empresa);

    const url = `${String(cfg.base_url).replace(/\/$/, "")}/message/sendText/${encodeURIComponent(cfg.instance)}`;
    const payload = { number: telefone, text, _tipo: tipo };

    let httpStatus = 0;
    let respJson: any = null;
    let erro: string | null = null;

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.api_key },
        body: JSON.stringify({ number: telefone, text }),
      });
      httpStatus = r.status;
      const raw = await r.text();
      try { respJson = JSON.parse(raw); } catch (_) { respJson = { raw }; }
      if (!r.ok) erro = `HTTP ${r.status}`;
    } catch (e: any) {
      erro = e?.message || "fetch falhou";
    }

    await supabase.from("whatsapp_notifications_log").insert({
      tenant_id: ag.tenant_id,
      agendamento_id: ag.id,
      profissional_id: ag.profissional_id,
      telefone,
      status: erro ? "erro" : "enviado",
      http_status: httpStatus || null,
      payload,
      response: respJson,
      erro: erro ? `${tipo}: ${erro}` : `${tipo}: ok`,
    });

    await marcarEnviado(ag.id, tipo);

    resultados.push({ id: ag.id, tipo, status: erro ? "erro" : "enviado", http: httpStatus, erro });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      now: now.toISOString(),
      window_min: WINDOW_MIN,
      candidatos: candidatos?.length ?? 0,
      elegiveis: elegiveis.length,
      resultados,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
