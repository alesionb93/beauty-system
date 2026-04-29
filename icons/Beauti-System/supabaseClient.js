
(function () {
  window.SUPABASE_KEY = window.SUPABASE_KEY || window.SUPABASE_ANON_KEY;
  if (window.supabaseClient) return;
  var canCreate = !!(window.supabase && typeof window.supabase.createClient === 'function');
  var url = window.SUPABASE_URL || localStorage.getItem('SUPABASE_URL') || localStorage.getItem('beauty_supabase_url') || '';
  var key = window.SUPABASE_ANON_KEY || localStorage.getItem('SUPABASE_ANON_KEY') || localStorage.getItem('beauty_supabase_anon_key') || '';

  if (canCreate && url && key) {
    window.supabaseClient = window.supabase.createClient(url, key);
    return;
  }

  window.SUPABASE_KEY = window.SUPABASE_KEY || key || '';
  window.__BEAUTY_OFFLINE_MODE = true;
  window.supabaseClient = null;
  console.warn('[BeautySystem] supabaseClient.js carregado em modo local. Para dados reais, defina SUPABASE_URL e SUPABASE_ANON_KEY.');
})();
