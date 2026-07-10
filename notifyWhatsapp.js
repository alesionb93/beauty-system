// Função única de disparo — use APENAS esta
function triggerWhatsAppNotification(agendamentoId) {
  try {
    if (!agendamentoId) return;
    // Obtém cliente Supabase (pode já ter sido inicializado por agendamento-cliente.js)
    var sb = window.__supabaseClient;
    if (!sb) {
      console.warn('[notify-whatsapp] cliente Supabase não disponível');
      return;
    }
    if (typeof sb.functions.invoke !== 'function') {
      console.warn('[notify-whatsapp] sb.functions.invoke não é função');
      return;
    }
    sb.functions.invoke('notify-whatsapp', {
      body: { agendamento_id: agendamentoId }
    }).then(function(res) {
      console.log('[notify-whatsapp] invoke OK:', agendamentoId, res);
    }).catch(function(err) {
      console.warn('[notify-whatsapp] invoke ERRO:', agendamentoId, err);
    });
  } catch (e) {
    console.warn('[notify-whatsapp] erro:', e);
  }
}

window.triggerWhatsAppNotification = triggerWhatsAppNotification;