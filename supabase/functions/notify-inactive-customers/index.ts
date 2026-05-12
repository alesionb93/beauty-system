// ============================================================
// SUPABASE EDGE FUNCTION: notify-inactive-customers  (v1)
// ------------------------------------------------------------
// Reativação automática de clientes inativos via WhatsApp.
//
// REGRAS:
//  - Cliente é elegível se o último atendimento CONCLUÍDO ocorreu há
//    MAIS de 30 dias (período FIXO — não é configurável).
//  - Cliente NÃO pode ter recebido campanha de reativação nos últimos
//    30 dias (cooldown anti-spam).
//  - Tenant precisa ter inactive_customer_automation_enabled = true
//    em tenant_settings.
//  - Tenant precisa ter evolution_settings ativo.
//  - Cliente precisa ter telefone válido (digits-only ≥ 10).
//
// EXECUÇÃO:
//  - Acionada por pg_cron 1x/dia (sugestão: 10:00 America/Sao_Paulo).
//  - NÃO compartilha cron com notify-reminders (operacional).
//
// LOGS:
//  - whatsapp_notifications_log (mesma tabela usada pelo restante).
//    erro/payload prefixados com "inactive_customer_campaign:".
//  - inactive_customer_campaigns (auditoria + cooldown).
//
// COMPATIBILIDADE:
//  - NÃO altera notify-reminders nem notify-whatsapp.
//  - Reutiliza evolution_settings + helper digits-only DDI 55.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// === Constantes da automação (NÃO configurável por tenant) ===
const INACTIVITY_DAYS = 30;     // dias sem atendimento concluído
const COOLDOWN_DAYS   = 30;     // intervalo mínimo entre campanhas

// Tamanho do lote por execução (proteção contra bursts/timeouts).
const MAX_PER_RUN = 200;

// Pequena pausa entre envios para suavizar rate-limit do WhatsApp.
const SEND_DELAY_MS = 250;

function onlyDigits(s: string | null | undefined) {
  return String(s || "").replace(/\D+/g, "");
}

function isValidPhone(p: string) {
  // Pelo menos 10 dígitos (DDD + número). DDI será concatenado pelo
  // padrão Evolution API já em uso no projeto.
  return /^\d{10,15}$/.test(p);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function montarMensagem(nomeCliente: string, empresa: string) {
  const cli = (nomeCliente || "").split(" ")[0] || "cliente";
  const emp = empresa ? ` na ${empresa} 💈` : "";
  return (
    `Oi ${cli} 👋\n\n` +
    `Faz um tempinho desde sua última visita 😄\n\n` +
    `Estamos com horários disponíveis essa semana${emp} ✨\n\n` +
    `Me avisa se quiser reservar um horário pra você 💜`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = new Date();
  const nowIso = startedAt.toISOString();

  // === 1. Tenants com automação ATIVADA ===
  const { data: tenantsCfg, error: tenantsErr } = await supabase
    .from("tenant_settings")
    .select("tenant_id")
    .eq("inactive_customer_automation_enabled", true);

  if (tenantsErr) {
    console.error("[inactive] tenant_settings error:", tenantsErr);
    return new Response(
      JSON.stringify({ ok: false, error: tenantsErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const tenantIds = (tenantsCfg || []).map((t) => t.tenant_id).filter(Boolean);
  if (tenantIds.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, tenants: 0, total_enviados: 0, message: "nenhum tenant com automação ativa" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // === 2. Cache: evolution_settings + nome do tenant ===
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

  const tenantCache = new Map<string, string>();
  async function getTenantNome(tenantId: string) {
    if (tenantCache.has(tenantId)) return tenantCache.get(tenantId)!;
    const { data: t } = await supabase
      .from("tenants")
      .select("nome, nome_fantasia")
      .eq("id", tenantId)
      .maybeSingle();
    const nome = (t?.nome_fantasia || t?.nome || "") as string;
    tenantCache.set(tenantId, nome);
    return nome;
  }

  // === 3. Para cada tenant, busca clientes elegíveis ===
  const totaisPorTenant: any[] = [];
  let totalEnviados = 0;
  let totalErros = 0;
  let totalIgnorados = 0;

  for (const tenantId of tenantIds) {
    if (totalEnviados + totalErros + totalIgnorados >= MAX_PER_RUN) break;

    // Pré-checa Evolution; se inativo/ausente, ignora tenant inteiro.
    const cfg = await getCfg(tenantId);
    if (!cfg || !cfg.ativo) {
      totaisPorTenant.push({ tenant_id: tenantId, skipped: "evolution_inativo" });
      continue;
    }

    // Chama RPC (definida na migration) que faz o JOIN pesado no banco
    // com índices corretos — evita scan/loop em Deno.
    const { data: elegiveis, error: elErr } = await supabase
      .rpc("listar_clientes_inativos_para_campanha", {
        p_tenant_id: tenantId,
        p_inactivity_days: INACTIVITY_DAYS,
        p_cooldown_days: COOLDOWN_DAYS,
        p_limit: MAX_PER_RUN - (totalEnviados + totalErros + totalIgnorados),
      });

    if (elErr) {
      console.error(`[inactive] tenant=${tenantId} rpc error:`, elErr);
      totaisPorTenant.push({ tenant_id: tenantId, error: elErr.message });
      continue;
    }

    if (!elegiveis || elegiveis.length === 0) {
      totaisPorTenant.push({ tenant_id: tenantId, elegiveis: 0 });
      continue;
    }

    const empresa = await getTenantNome(tenantId);
    let enviados = 0, erros = 0, ignorados = 0;

    for (const cli of elegiveis) {
      const telefone = onlyDigits(cli.telefone);
      if (!isValidPhone(telefone)) {
        ignorados++;
        await supabase.from("inactive_customer_campaigns").insert({
          tenant_id: tenantId,
          cliente_id: cli.cliente_id,
          telefone: telefone || null,
          mensagem: null,
          status: "ignorado",
          erro: "telefone_invalido",
        });
        continue;
      }

      const text = montarMensagem(cli.nome, empresa);
      const url = `${String(cfg.base_url).replace(/\/$/, "")}/message/sendText/${encodeURIComponent(cfg.instance)}`;
      const payload = { number: telefone, text, _tipo: "inactive_customer_campaign" };

      let httpStatus = 0;
      let respJson: any = null;
      let erroMsg: string | null = null;

      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: cfg.api_key },
          body: JSON.stringify({ number: telefone, text }),
        });
        httpStatus = r.status;
        const raw = await r.text();
        try { respJson = JSON.parse(raw); } catch (_) { respJson = { raw }; }
        if (!r.ok) erroMsg = `HTTP ${r.status}`;
      } catch (e: any) {
        erroMsg = e?.message || "fetch falhou";
      }

      // Registro auditável (cooldown lê esta tabela)
      await supabase.from("inactive_customer_campaigns").insert({
        tenant_id: tenantId,
        cliente_id: cli.cliente_id,
        telefone,
        mensagem: text,
        status: erroMsg ? "erro" : "enviado",
        erro: erroMsg,
        response: respJson,
      });

      // Log padronizado (mesmo padrão notify-reminders/notify-whatsapp)
      await supabase.from("whatsapp_notifications_log").insert({
        tenant_id: tenantId,
        agendamento_id: null,
        profissional_id: null,
        telefone,
        status: erroMsg ? "erro" : "enviado",
        http_status: httpStatus || null,
        payload,
        response: respJson,
        erro: erroMsg
          ? `inactive_customer_campaign: ${erroMsg}`
          : `inactive_customer_campaign: ok`,
      });

      if (erroMsg) erros++; else enviados++;
      await sleep(SEND_DELAY_MS);
    }

    totalEnviados += enviados;
    totalErros    += erros;
    totalIgnorados += ignorados;
    totaisPorTenant.push({ tenant_id: tenantId, elegiveis: elegiveis.length, enviados, erros, ignorados });
  }

  console.log(
    `[inactive] now=${nowIso} tenants=${tenantIds.length} enviados=${totalEnviados} erros=${totalErros} ignorados=${totalIgnorados}`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      now: nowIso,
      tenants: tenantIds.length,
      total_enviados: totalEnviados,
      total_erros: totalErros,
      total_ignorados: totalIgnorados,
      detalhes: totaisPorTenant,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
