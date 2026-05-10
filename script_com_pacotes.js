/* ===== DATA (agora dinâmico — carregado do Supabase) ===== */
var professionals = {};
var servicePrices = {};
var allServicos = [];
var allProfissionais = [];

/* ===== CORES DINÂMICAS (carregadas do Supabase) ===== */
var coresPorServico = {};
var corConfigPorServico = {};
var colorOptions = [];
var pigmentOptions = [];
var professionalAvatars = {};

var clients = [];
var appointments = [];
var editingAppointmentId = null;
var pendingClienteFromIdentificacao = null;
var currentUser = { nome: '', role: '', tenantId: null, profissionalId: null, profissionalNome: null };
var activeFilters = [];
var pendingBaseCallback = null;
var pendingPigmentoCallback = null;

var MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

var today = new Date();
var currentMonth = today.getMonth();
var currentYear = today.getFullYear();
var selectedDay = today.getDate();

var profColors = {};
var profColorPalette = ['#5bc0de', '#9b59b6', '#e91e90', '#2ecc71', '#e67e22', '#3498db', '#e74c3c', '#1abc9c', '#f39c12', '#8e44ad'];

/* ===== MULTI-TENANT: Funções de Role e Tenant (SEMPRE do banco) ===== */

function resolveUserRoleRows(roleRows, tenantId) {
  if (!roleRows || roleRows.length === 0) return 'colaborador';

  if (roleRows.some(function(row) { return row.role === 'master_admin'; })) {
    return 'master_admin';
  }

  if (tenantId) {
    if (roleRows.some(function(row) { return row.tenant_id === tenantId && row.role === 'admin'; })) {
      return 'admin';
    }
    if (roleRows.some(function(row) { return row.tenant_id === tenantId && row.role === 'colaborador'; })) {
      return 'colaborador';
    }
  }

  if (roleRows.some(function(row) { return row.role === 'admin'; })) {
    return 'admin';
  }

  if (roleRows.some(function(row) { return row.role === 'colaborador'; })) {
    return 'colaborador';
  }

  return roleRows[0].role || 'colaborador';
}

async function getUserRole() {
  var sessionResp = await supabaseClient.auth.getSession();
  var session = sessionResp.data.session;
  if (!session) return 'colaborador';

  var tenantId = localStorage.getItem('currentTenantId');
  if (!tenantId) {
    tenantId = await getUserTenant();
  }

  var resp = await supabaseClient.from('user_roles').select('role, tenant_id').eq('user_id', session.user.id);
  if (resp.error) {
    console.error('Erro ao buscar roles:', resp.error);
    return 'colaborador';
  }

  return resolveUserRoleRows(resp.data || [], tenantId);
}

async function getUserTenant() {
  var { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  var resp = await supabaseClient.from('usuarios').select('tenant_id').eq('id', session.user.id).single();
  if (resp.data) return resp.data.tenant_id;
  return null;
}

function getCurrentTenantId() {
  return localStorage.getItem('currentTenantId') || currentUser.tenantId;
}

async function applyPermissions() {
  var role = await getUserRole();
  currentUser.role = role;

  if (role === 'master_admin') {
    // master_admin: tenant vem do localStorage (selecionado na tela de tenant)
    currentUser.tenantId = localStorage.getItem('currentTenantId') || null;
    if (!currentUser.tenantId) {
      window.location.href = 'select-tenant.html';
      return false;
    }
  } else {
    // admin/colaborador: tenant vem do banco
    var tenantId = await getUserTenant();
    currentUser.tenantId = tenantId;
    localStorage.setItem('currentTenantId', tenantId || '');
  }

  // Aplicar visibilidade dos elementos admin-only
  if (!isAdmin()) {
    document.querySelectorAll('.admin-only, .nav-admin-only').forEach(function(el) {
      el.style.display = 'none';
    });
  } else {
    var btnGerenciar = document.getElementById('btn-gerenciar-servicos');
    if (btnGerenciar) btnGerenciar.style.display = '';
    var btnAddProf = document.getElementById('btn-add-profissional');
    if (btnAddProf) btnAddProf.style.display = '';
  }

  // Mostrar botão "Trocar Tenant" para master_admin
  if (role === 'master_admin') {
    var navArea = document.querySelector('.sidebar-nav');
    if (navArea && !document.getElementById('btn-trocar-tenant')) {
      var btn = document.createElement('button');
      btn.className = 'nav-btn';
      btn.id = 'btn-trocar-tenant';
      btn.innerHTML = '<i class="fa-solid fa-building"></i> Trocar Tenant';
      btn.onclick = function() {
        window.location.href = 'select-tenant.html';
      };
      navArea.appendChild(btn);
    }
    // Mostrar nome do tenant na sidebar
    var tenantNome = localStorage.getItem('currentTenantNome') || '';
    if (tenantNome) {
      var brand = document.querySelector('.sidebar-header .brand p');
      if (brand) brand.textContent = tenantNome;
    }
  }

  // Mostrar/ocultar elementos master-only (ex: Tema da Agenda)
  document.querySelectorAll('.master-only-tab, .master-only-panel').forEach(function(el) {
    el.style.display = isMasterAdmin() ? '' : 'none';
  });

  return true;
}

/* ===== SUPABASE HELPERS (COM tenant_id) ===== */
async function loadClients() {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('clientes').select('*').order('nome');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro clientes:', resp.error); return; }
  clients = resp.data.map(function(c) {
    return { id: c.id, nome: c.nome, telefone: c.telefone, nascimento: c.nascimento || '' };
  });
}

async function loadAppointments() {
  var tenantId = getCurrentTenantId();
  // ✅ FIX MULTI-PROFISSIONAL: incluir profissional_id em agendamento_servicos
  var query = supabaseClient.from('agendamentos').select('*, agendamento_servicos(id, servico_id, profissional_id, preco, duracao, cor_id, servicos(id, nome, preco, duracao), cores(id, nome, hex), agendamento_servico_cores(id, cor_id, tipo, quantidade, cores(id, nome, hex)))');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro agendamentos:', resp.error); return; }

  // Build profissional id->nome map
  var profIdToNome = {};
  allProfissionais.forEach(function(p) { profIdToNome[p.id] = p.nome; });

  appointments = resp.data.map(function(a) {
    var profPrincipalNome = profIdToNome[a.profissional_id] || '';
    var svcs = (a.agendamento_servicos || []).map(function(as) {
      var bases = [];
      var pigmentacoes = [];
      var coresArr = [];
      // Load from agendamento_servico_cores table
      if (as.agendamento_servico_cores && as.agendamento_servico_cores.length > 0) {
        as.agendamento_servico_cores.forEach(function(asc) {
          if (asc.cores) {
            if (asc.tipo === 'base') {
              bases.push({ cor: asc.cores.nome, qtd: asc.quantidade || 0 });
            } else if (asc.tipo === 'pigmento') {
              pigmentacoes.push({ cor: asc.cores.nome, qtd: asc.quantidade || 0 });
            } else if (asc.tipo === 'cor') {
              coresArr.push(asc.cores.nome);
            }
          }
        });
      }
      // Fallback: legacy single cor_id
      if (bases.length === 0 && pigmentacoes.length === 0 && coresArr.length === 0 && as.cores) {
        coresArr.push(as.cores.nome);
      }
      // ✅ FIX MULTI-PROFISSIONAL: cada serviço carrega SEU próprio profissional.
      // Fallback para o profissional principal apenas em registros legados sem profissional_id no serviço.
      var svcProfNome = profIdToNome[as.profissional_id] || profPrincipalNome;
      return {
        profissional: svcProfNome,
        profissional_id: as.profissional_id || a.profissional_id,
        servico: as.servicos ? as.servicos.nome : '',
        servico_id: as.servico_id,
        preco: parseFloat(as.preco),
        duracao: as.duracao,
        cor: coresArr.length > 0 ? coresArr[0] : (as.cores ? as.cores.nome : ''),
        bases: bases,
        pigmentacoes: pigmentacoes,
        cores: coresArr
      };
    });
    var firstSvc = svcs.length > 0 ? svcs[0] : null;
    return {
      id: a.id,
      cliente_id: a.cliente_id,
      cliente: a.cliente_nome,
      telefone: a.cliente_telefone,
      profissional_id: a.profissional_id,
      profissional: profPrincipalNome,
      servico: firstSvc ? firstSvc.servico : '',
      cor: '',
      data: a.data,
      hora: (a.hora || '').substring(0, 5),
      observacoes: a.observacoes || '',
      status: a.status || 'agendado',
      servicos: svcs.length > 0 ? svcs : null
    };
  });
}

async function loadProfissionais() {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('profissionais').select('*').order('nome');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro profissionais:', resp.error); return; }
  var todos = resp.data || [];

  // 🔒 REGRA: ocultar profissionais cujo usuário vinculado está inativo.
  // Buscamos os usuários do tenant aqui mesmo (sem depender da ordem de loadUsuarios).
  var usuariosResp = await supabaseClient
    .from('usuarios')
    .select('id, profissional_id, ativo, tenant_id')
    .eq('tenant_id', tenantId || null);
  var usuariosTenant = (usuariosResp && usuariosResp.data) ? usuariosResp.data : [];

  // Mapa: profissional_id -> existe pelo menos um usuário ATIVO vinculado?
  var profTemUsuarioAtivo = {};
  // Mapa: profissional_id -> existe algum usuário vinculado (ativo ou não)?
  var profTemUsuarioQualquer = {};
  usuariosTenant.forEach(function(u) {
    if (!u.profissional_id) return;
    profTemUsuarioQualquer[u.profissional_id] = true;
    if (u.ativo === true) profTemUsuarioAtivo[u.profissional_id] = true;
  });

  allProfissionais = todos.filter(function(p) {
    // Sem usuário vinculado → mantém visível (profissional "solto", legado/admin).
    if (!profTemUsuarioQualquer[p.id]) return true;
    // Tem usuário vinculado → só aparece se houver pelo menos 1 ativo.
    return !!profTemUsuarioAtivo[p.id];
  });

  professionalAvatars = {};
  profColors = {};
  allProfissionais.forEach(function(p, idx) {
    if (p.foto_url) {
      professionalAvatars[p.nome] = p.foto_url;
    }
    profColors[p.nome] = profColorPalette[idx % profColorPalette.length];
  });
}

async function loadServicos() {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('servicos').select('*').order('nome');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro servicos:', resp.error); return; }
  allServicos = resp.data || [];
  servicePrices = {};
  allServicos.forEach(function(s) {
    servicePrices[s.nome] = { preco: parseFloat(s.preco), duracao: s.duracao };
  });
}

async function loadProfissionalServicos() {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('profissional_servicos').select('profissional_id, servico_id, profissionais(id, nome), servicos(id, nome, preco, duracao)');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro prof_servicos:', resp.error); return; }
  professionals = {};
  allProfissionais.forEach(function(p) {
    if (!professionals[p.nome]) professionals[p.nome] = [];
  });
  (resp.data || []).forEach(function(ps) {
    var prof = ps.profissionais ? ps.profissionais.nome : null;
    if (!prof) return;
    if (!professionals[prof]) professionals[prof] = [];
    if (ps.servicos) {
      var exists = professionals[prof].some(function(s) { return s.id === ps.servicos.id; });
      if (!exists) {
        professionals[prof].push({
          id: ps.servicos.id,
          nome: ps.servicos.nome,
          preco: parseFloat(ps.servicos.preco),
          duracao: ps.servicos.duracao
        });
      }
    }
  });
}

async function loadCores() {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('cores').select('*').order('nome');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro cores:', resp.error); return; }
  coresPorServico = {};
  colorOptions = [];
  pigmentOptions = [];

  (resp.data || []).forEach(function(c) {
    var sid = c.servico_id;
    if (!coresPorServico[sid]) coresPorServico[sid] = { base: [], pigmento: [] };
    var item = { id: c.id, nome: c.nome, hex: c.hex };
    if (c.tipo === 'base') {
      coresPorServico[sid].base.push(item);
      if (!colorOptions.some(function(x) { return x.code === c.nome; })) {
        colorOptions.push({ code: c.nome, hex: c.hex });
      }
    } else {
      coresPorServico[sid].pigmento.push(item);
      if (!pigmentOptions.some(function(x) { return x.code === c.nome; })) {
        pigmentOptions.push({ code: c.nome, hex: c.hex });
      }
    }
  });
}

function getCoresDoServico(servicoNome) {
  var svc = allServicos.find(function(s) { return s.nome === servicoNome; });
  if (!svc) return { base: [], pigmento: [] };
  return coresPorServico[svc.id] || { base: [], pigmento: [] };
}

function getCoresDoServico_legacy() {
  // Fallback: retorna todas as cores de todos os serviços
  var all = { base: [], pigmento: [] };
  Object.keys(coresPorServico).forEach(function(sid) {
    all.base = all.base.concat(coresPorServico[sid].base);
    all.pigmento = all.pigmento.concat(coresPorServico[sid].pigmento);
  });
  return all;
}


/* ===== CARREGAR CONFIGURAÇÃO DE QUANTIDADES (servico_cor_config) ===== */
async function loadCorConfig() {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('servico_cor_config').select('*');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.warn('servico_cor_config não encontrada ou erro:', resp.error.message); return; }
  corConfigPorServico = {};
  (resp.data || []).forEach(function(cfg) {
    if (!corConfigPorServico[cfg.servico_id]) corConfigPorServico[cfg.servico_id] = {};
    corConfigPorServico[cfg.servico_id][cfg.tipo] = cfg;
  });
}

function getQtdOptions(servicoId, tipo) {
  var cfg = (corConfigPorServico[servicoId] || {})[tipo];
  if (!cfg) {
    if (tipo === 'base') return { options: generateRange(5, 120, 5), unidade: 'g' };
    return { options: generateRange(1, 10, 1), unidade: 'g' };
  }
  var unidade = cfg.unidade || 'g';
  return { options: generateRange(cfg.qtd_min || 5, cfg.qtd_max || 120, cfg.qtd_step || 5), unidade: unidade };
}

function generateRange(min, max, step) {
  var arr = [];
  for (var i = min; i <= max; i += step) arr.push(i);
  return arr;
}

function populateQtdSelect(selectEl, servicoId, tipo) {
  selectEl.innerHTML = '';
  var config = getQtdOptions(servicoId, tipo);
  if (config.options === 'livre') {
    // Replace select with input
    var input = document.createElement('input');
    input.type = 'number';
    input.min = config.min;
    input.max = config.max;
    input.value = config.min;
    input.id = selectEl.id;
    input.className = 'form-control';
    input.placeholder = config.min + '-' + config.max + config.unidade;
    selectEl.parentNode.replaceChild(input, selectEl);
    // Update label
    var label = input.parentNode.querySelector('label');
    if (label) label.textContent = 'Digite a quantidade (' + config.unidade + ')';
    return;
  }
  config.options.forEach(function(v) {
    var opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v + config.unidade;
    selectEl.appendChild(opt);
  });
  // Update label
  var label = selectEl.parentNode.querySelector('label');
  if (label) label.textContent = 'Selecione a quantidade (' + config.unidade + ')';
}

/* CRUD de Cores (com tenant_id) */
async function criarCor(nome, hex, tipo, servicoId) {
  var tenantId = getCurrentTenantId();
  var resp = await supabaseClient.from('cores').insert([{ nome: nome, hex: hex, tipo: tipo, servico_id: servicoId, tenant_id: tenantId }]).select();
  if (resp.error) { console.error('Erro criar cor:', resp.error); return null; }
  return resp.data[0];
}

async function editarCor(id, nome, hex) {
  var resp = await supabaseClient.from('cores').update({ nome: nome, hex: hex }).eq('id', id);
  if (resp.error) { console.error('Erro editar cor:', resp.error); return false; }
  return true;
}

async function excluirCor(id) {
  var resp = await supabaseClient.from('cores').delete().eq('id', id);
  if (resp.error) {
    console.error('Erro excluir cor:', resp.error);
    return { ok: false, error: resp.error };
  }
  return { ok: true };
}

/* Helpers de permissão — SEMPRE baseados na role carregada do banco */
function isAdmin() {
  return currentUser.role === 'admin' || currentUser.role === 'master_admin';
}
function isMasterAdmin() {
  return currentUser.role === 'master_admin';
}

function getProfServiceNames(prof) {
  // ✅ FIX: lista os serviços do profissional em ORDEM ALFABÉTICA (case/acento-insensible).
  return (professionals[prof] || [])
    .map(function(s) { return s.nome; })
    .sort(function(a, b) { return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }); });
}

async function insertAppointment(apt) {
  var tenantId = getCurrentTenantId();
  var clienteObj = clients.find(function(c) { return c.nome === apt.cliente; });
  var clienteId = clienteObj ? clienteObj.id : null;
  if (!clienteId) { console.error('Cliente não encontrado:', apt.cliente); return false; }
  // ✅ Profissional principal = profissional do 1º serviço (compatibilidade com agendamentos.profissional_id)
  var profObj = allProfissionais.find(function(p) { return p.nome === apt.profissional; });
  var profId = profObj ? profObj.id : null;
  if (!profId) { console.error('Profissional não encontrado:', apt.profissional); return false; }

  var row = {
    cliente_id: clienteId,
    cliente_nome: apt.cliente,
    cliente_telefone: apt.telefone,
    profissional_id: profId,
    data: apt.data,
    hora: apt.hora,
    observacoes: apt.observacoes || '',
    tenant_id: tenantId
  };
  var resp = await supabaseClient.from('agendamentos').insert([row]).select();
  if (resp.error) { console.error('Erro inserir agendamento:', resp.error); return false; }
  var agId = resp.data[0].id;
  if (apt.servicos && apt.servicos.length > 0) {
    for (var i = 0; i < apt.servicos.length; i++) {
      var s = apt.servicos[i];
      var svcObj = allServicos.find(function(sv) { return sv.nome === s.servico; });
      if (!svcObj) continue;
      // ✅ FIX MULTI-PROFISSIONAL: profissional individual de CADA serviço
      var svcProfObj = allProfissionais.find(function(p) { return p.nome === s.profissional; });
      var svcProfId = svcProfObj ? svcProfObj.id : profId; // fallback p/ principal
      var svcRow = {
        agendamento_id: agId,
        servico_id: svcObj.id,
        profissional_id: svcProfId,
        preco: svcObj.preco,
        duracao: svcObj.duracao,
        cor_id: null,
        tenant_id: tenantId
      };
      var svcResp = await supabaseClient.from('agendamento_servicos').insert([svcRow]).select();
      if (svcResp.error) { console.error('Erro inserir agendamento_servicos:', svcResp.error); continue; }
      var asId = svcResp.data[0].id;
      await saveServiceColors(asId, s, tenantId);
    }
  }
  return true;
}

async function saveServiceColors(agendamentoServicoId, svcData, tenantId) {
  var colorRows = [];
  if (svcData.bases && svcData.bases.length > 0) {
    svcData.bases.forEach(function(b) {
      var corObj = findCorByNome(b.cor);
      if (corObj) colorRows.push({ agendamento_servico_id: agendamentoServicoId, cor_id: corObj.id, tipo: 'base', quantidade: b.qtd || 0, tenant_id: tenantId });
    });
  }
  if (svcData.pigmentacoes && svcData.pigmentacoes.length > 0) {
    svcData.pigmentacoes.forEach(function(p) {
      var corObj = findCorByNome(p.cor);
      if (corObj) colorRows.push({ agendamento_servico_id: agendamentoServicoId, cor_id: corObj.id, tipo: 'pigmento', quantidade: p.qtd || 0, tenant_id: tenantId });
    });
  }
  if (svcData.cores && svcData.cores.length > 0) {
    svcData.cores.forEach(function(c) {
      var corObj = findCorByNome(c);
      if (corObj) colorRows.push({ agendamento_servico_id: agendamentoServicoId, cor_id: corObj.id, tipo: 'cor', quantidade: 0, tenant_id: tenantId });
    });
  }
  if (colorRows.length > 0) {
    var resp = await supabaseClient.from('agendamento_servico_cores').insert(colorRows);
    if (resp.error) { console.error('Erro inserir agendamento_servico_cores:', resp.error); }
  }
}

function findCorByNome(nome) {
  var found = null;
  Object.keys(coresPorServico).forEach(function(sid) {
    coresPorServico[sid].base.forEach(function(c) { if (c.nome === nome) found = c; });
    coresPorServico[sid].pigmento.forEach(function(c) { if (c.nome === nome) found = c; });
  });
  return found;
}

async function updateAppointment(id, apt) {
  var tenantId = getCurrentTenantId();
  var profObj = allProfissionais.find(function(p) { return p.nome === apt.profissional; });
  var profId = profObj ? profObj.id : null;
  var row = {
    profissional_id: profId,
    data: apt.data,
    hora: apt.hora,
    observacoes: apt.observacoes || ''
  };
  var resp = await supabaseClient.from('agendamentos').update(row).eq('id', id);
  if (resp.error) { console.error('Erro atualizar agendamento:', resp.error); return false; }
  await supabaseClient.from('agendamento_servicos').delete().eq('agendamento_id', id);
  if (apt.servicos && apt.servicos.length > 0) {
    for (var i = 0; i < apt.servicos.length; i++) {
      var s = apt.servicos[i];
      var svcObj = allServicos.find(function(sv) { return sv.nome === s.servico; });
      if (!svcObj) continue;
      // ✅ FIX MULTI-PROFISSIONAL: profissional individual de CADA serviço
      var svcProfObj = allProfissionais.find(function(p) { return p.nome === s.profissional; });
      var svcProfId = svcProfObj ? svcProfObj.id : profId;
      var svcRow = {
        agendamento_id: id,
        servico_id: svcObj.id,
        profissional_id: svcProfId,
        preco: svcObj.preco,
        duracao: svcObj.duracao,
        cor_id: null,
        tenant_id: tenantId
      };
      var svcResp = await supabaseClient.from('agendamento_servicos').insert([svcRow]).select();
      if (svcResp.error) { console.error('Erro inserir agendamento_servicos:', svcResp.error); continue; }
      var asId = svcResp.data[0].id;
      await saveServiceColors(asId, s, tenantId);
    }
  }
  return true;
}

async function deleteAppointment(id) {
  var tenantId = getCurrentTenantId();
  var ag = appointments.find(function(a) { return a.id === id; });
  var histId = null;
  if (ag) {
    // ✅ FIX BADGE "Cliente desmarcado": INSERT defensivo com retries.
    // Antes o INSERT podia falhar (HTTP 400 — coluna ausente, FK, etc.) e o erro
    // era ignorado, então o histórico nunca recebia o registro com status='excluido'
    // e o badge nunca aparecia. Agora: log + retry com payload mínimo.
    var fullRow = {
      agendamento_id: ag.id,
      cliente_id: ag.cliente_id || null,
      cliente_nome: ag.cliente,
      cliente_telefone: ag.telefone || null,
      profissional_id: ag.profissional_id || null,
      profissional_nome: ag.profissional || null,
      status: 'excluido',
      data: ag.data,
      hora: ag.hora,
      observacoes: ag.observacoes || '',
      tenant_id: tenantId
    };
    var histResp = await supabaseClient.from('historico_atendimentos').insert([fullRow]).select();
    if (histResp.error) {
      console.warn('[deleteAppointment] INSERT histórico (full) falhou:', histResp.error);
      // Retry sem agendamento_id (caso seja FK que será violada após o DELETE em cascata)
      var minRow = {
        cliente_id: ag.cliente_id || null,
        cliente_nome: ag.cliente,
        cliente_telefone: ag.telefone || null,
        profissional_nome: ag.profissional || null,
        status: 'excluido',
        data: ag.data,
        hora: ag.hora,
        tenant_id: tenantId
      };
      var retry1 = await supabaseClient.from('historico_atendimentos').insert([minRow]).select();
      if (retry1.error) {
        console.warn('[deleteAppointment] INSERT histórico (min) falhou:', retry1.error);
        // Retry ultra mínimo
        var ultraMin = {
          cliente_nome: ag.cliente,
          status: 'excluido',
          data: ag.data,
          hora: ag.hora,
          tenant_id: tenantId
        };
        var retry2 = await supabaseClient.from('historico_atendimentos').insert([ultraMin]).select();
        if (retry2.error) {
          console.error('[deleteAppointment] INSERT histórico (ultra-min) falhou — badge não aparecerá:', retry2.error);
        } else if (retry2.data && retry2.data[0]) {
          histId = retry2.data[0].id;
        }
      } else if (retry1.data && retry1.data[0]) {
        histId = retry1.data[0].id;
      }
    } else if (histResp.data && histResp.data[0]) {
      histId = histResp.data[0].id;
    }

    // Save services to historico_servicos
    if (histId && ag.servicos && ag.servicos.length > 0) {
      var histSvcRows = ag.servicos.map(function(s) {
        // Construir cores_detalhes JSON para histórico
        var coresDetalhes = [];
        if (s.bases && s.bases.length > 0) {
          s.bases.forEach(function(b) {
            var corObj = findCorByNome(b.cor);
            coresDetalhes.push({ tipo: 'base', cor: b.cor, qtd: b.qtd || 0, hex: corObj ? corObj.hex : '#888' });
          });
        }
        if (s.pigmentacoes && s.pigmentacoes.length > 0) {
          s.pigmentacoes.forEach(function(p) {
            var corObj = findCorByNome(p.cor);
            coresDetalhes.push({ tipo: 'pigmento', cor: p.cor, qtd: p.qtd || 0, hex: corObj ? corObj.hex : '#888' });
          });
        }
        if (s.cores && s.cores.length > 0) {
          s.cores.forEach(function(c) {
            var corObj = findCorByNome(c);
            coresDetalhes.push({ tipo: 'cor', cor: c, qtd: 0, hex: corObj ? corObj.hex : '#888' });
          });
        }
        return {
          historico_atendimento_id: histId,
          servico_nome: s.servico,
          preco: s.preco || 0,
          duracao: s.duracao || 30,
          cor_nome: s.cor || null,
          cor_hex: null,
          cores_detalhes: coresDetalhes.length > 0 ? JSON.stringify(coresDetalhes) : null,
          tenant_id: tenantId
        };
      });
      var svcInsResp = await supabaseClient.from('historico_servicos').insert(histSvcRows);
      if (svcInsResp.error) console.warn('[deleteAppointment] INSERT historico_servicos falhou:', svcInsResp.error);
    }
  }
  // Delete agendamento_servicos first (FK constraint)
  await supabaseClient.from('agendamento_servicos').delete().eq('agendamento_id', id);
  var resp = await supabaseClient.from('agendamentos').delete().eq('id', id);
  if (resp.error) { console.error('Erro excluir agendamento:', resp.error); return false; }
  return true;
}

async function insertClient(clientObj) {
  var tenantId = getCurrentTenantId();

  // Verificar se já existe cliente com mesmo telefone no tenant
  var existente = await buscarClientePorTelefone(clientObj.telefone, tenantId);
  if (existente) {
    console.log('Cliente já existe com este telefone, retornando existente:', existente.id);
    return existente;
  }

  var row = { nome: clientObj.nome, telefone: clientObj.telefone, tenant_id: tenantId };
  if (clientObj.nascimento) row.nascimento = clientObj.nascimento;
  var resp = await supabaseClient.from('clientes').insert([row]).select();

  // Tratar erro de unique constraint (duplicidade por concorrência)
  if (resp.error) {
    if (resp.error.code === '23505' || (resp.error.message && resp.error.message.indexOf('unique') !== -1)) {
      console.warn('Duplicidade detectada, buscando cliente existente...');
      var existente2 = await buscarClientePorTelefone(clientObj.telefone, tenantId);
      if (existente2) return existente2;
    }
    console.error('Erro inserir cliente:', resp.error);
    return null;
  }
  return resp.data[0];
}

// Buscar cliente por telefone no tenant (comparação por dígitos)
async function buscarClientePorTelefone(telefone, tenantId) {
  var telefoneDigits = telefone.replace(/\D/g, '');
  var query = supabaseClient.from('clientes').select('*').eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error || !resp.data) return null;
  var found = resp.data.find(function(c) {
    return c.telefone.replace(/\D/g, '') === telefoneDigits;
  });
  return found || null;
}

/* ===== CRUD DE SERVIÇOS (com tenant_id) ===== */
async function criarServico(nome, preco, duracao, usa_cores) {
  var tenantId = getCurrentTenantId();
  var resp = await supabaseClient.from('servicos').insert([{ nome: nome, preco: preco, duracao: duracao, usa_cores: usa_cores || false, tenant_id: tenantId }]).select();
  if (resp.error) { console.error('Erro criar serviço:', resp.error); return null; }
  return resp.data[0];
}

async function editarServico(id, nome, preco, duracao, usa_cores) {
  var resp = await supabaseClient.from('servicos').update({ nome: nome, preco: preco, duracao: duracao, usa_cores: usa_cores || false }).eq('id', id);
  if (resp.error) { console.error('Erro editar serviço:', resp.error); return false; }
  return true;
}

async function excluirServico(id) {
  var resp = await supabaseClient.from('servicos').delete().eq('id', id);
  if (resp.error) { console.error('Erro excluir serviço:', resp.error); return false; }
  return true;
}

async function vincularServicoProfissional(profId, servicoId) {
  var tenantId = getCurrentTenantId();
  var resp = await supabaseClient.from('profissional_servicos').insert([{ profissional_id: profId, servico_id: servicoId, tenant_id: tenantId }]);
  if (resp.error && resp.error.code !== '23505') { console.error('Erro vincular:', resp.error); return false; }
  return true;
}

async function desvincularServicoProfissional(profId, servicoId) {
  var resp = await supabaseClient.from('profissional_servicos').delete().eq('profissional_id', profId).eq('servico_id', servicoId);
  if (resp.error) { console.error('Erro desvincular:', resp.error); return false; }
  return true;
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', async function() {
  // Verificar sessão via Supabase (NÃO sessionStorage)
  var { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  // Carregar role e tenant do BANCO
  var ok = await applyPermissions();
  if (!ok) return; // Redirecionado para select-tenant

  // Carregar nome do usuário do banco
  var userResp = await supabaseClient.from('usuarios').select('nome').eq('id', session.user.id).single();
  if (userResp.data) {
    currentUser.nome = userResp.data.nome;
  }

  var userAvatarHtml = getAvatarHtml(currentUser.nome, 'avatar--sidebar');
  document.getElementById('user-info').innerHTML = userAvatarHtml + '<div class="user-details"><span class="user-name">' + currentUser.nome + '</span><span class="user-role">' + currentUser.role + '</span></div>';

  await loadProfissionais();

  // Determinar profissional vinculado ao usuário logado
  var linkedProfName = null;
  currentUser.profissionalId = null;
  currentUser.profissionalNome = null;
  if (session && session.user) {
    var usuarioResp = await supabaseClient.from('usuarios').select('profissional_id').eq('id', session.user.id).maybeSingle();
    if (usuarioResp.data && usuarioResp.data.profissional_id) {
      var linkedProf = allProfissionais.find(function(p) { return p.id === usuarioResp.data.profissional_id; });
      if (linkedProf) {
        linkedProfName = linkedProf.nome;
        currentUser.profissionalId = linkedProf.id;
        currentUser.profissionalNome = linkedProf.nome;
      }
    }
  }
  // 🔒 REGRA: Colaborador deve ter profissional vinculado. Avisar se não tiver.
  if (currentUser.role === 'colaborador' && !currentUser.profissionalNome) {
    console.warn('[REGRA] Colaborador sem profissional vinculado — agendamentos ficarão bloqueados.');
  }
  // ===== FIX 1: Inicialização do filtro de profissionais na agenda =====
  // - Colaborador: SEMPRE travado no profissional vinculado (RLS já bloqueia o resto).
  // - Admin/Master COM vínculo: inicia mostrando apenas o profissional vinculado,
  //   mas pode trocar/marcar outros livremente.
  // - Admin/Master SEM vínculo: inicia com TODOS os profissionais selecionados.
  if (currentUser.role === 'colaborador') {
    activeFilters = linkedProfName ? [linkedProfName] : [];
  } else if (linkedProfName) {
    activeFilters = [linkedProfName];
  } else {
    activeFilters = (allProfissionais || []).map(function(p) { return p.nome; });
  }
  await loadServicos();
  await loadProfissionalServicos();
  await loadCores();
  await loadCorConfig();
  await loadClients();
  await loadAppointments();

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var page = this.dataset.page;
      // Dashboard agora é acessível por colaborador também (filtrado por RLS).
      // Bloqueamos apenas se for colaborador SEM profissional vinculado.
      if (page === 'dashboard'
          && currentUser.role === 'colaborador'
          && !currentUser.profissionalId) {
        showToast('Seu usuário não está vinculado a um profissional. Solicite ao administrador.', 'error');
        return;
      }
      switchPage(page);
    });
  });

  // Configurações tabs
  document.querySelectorAll('.config-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var tabName = this.dataset.configTab;
      if (tabName === 'usuarios' && !isAdmin()) return;
      document.querySelectorAll('.config-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.config-panel').forEach(function(p) { p.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('config-' + tabName).classList.add('active');
    });
  });

  document.getElementById('hamburger').addEventListener('click', openSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
  document.getElementById('close-sidebar').addEventListener('click', closeSidebar);

  document.getElementById('btn-sair').addEventListener('click', async function() {
    await supabaseClient.auth.signOut();
    localStorage.removeItem('currentTenantId');
    localStorage.removeItem('currentTenantNome');
    window.location.href = 'index.html';
  });

  document.getElementById('prev-month').addEventListener('click', function() {
    if (currentMonth === 0) { currentMonth = 11; currentYear--; } else { currentMonth--; }
    selectedDay = 1; renderCalendar(); renderDayDetail();
  });
  document.getElementById('next-month').addEventListener('click', function() {
    if (currentMonth === 11) { currentMonth = 0; currentYear++; } else { currentMonth++; }
    selectedDay = 1; renderCalendar(); renderDayDetail();
  });

  document.getElementById('btn-novo-agendamento').addEventListener('click', function() {
    document.getElementById('id-telefone').value = '';
    document.getElementById('id-feedback').style.display = 'none';
    openModal('modal-identificacao');
  });

  document.getElementById('btn-novo-cliente').addEventListener('click', function() {
    pendingClienteFromIdentificacao = null;
    document.getElementById('form-cliente').reset();
    openModal('modal-cliente');
  });

  var filterBtn = document.getElementById('btn-filtrar-agendas');
  if (filterBtn) {
    filterBtn.addEventListener('click', toggleFilterBar);
  }

  document.getElementById('ag-data').value = formatDateInput(today);

  maskTelefone(document.getElementById('id-telefone'));
  maskTelefone(document.getElementById('cl-telefone'));

  // Quantidade selects serão populados dinamicamente via populateQtdSelect()
  // Fallback: popular com valores padrão caso servico_cor_config não exista
  populateQtdSelect(document.getElementById('base-qtd-select'), null, 'base');
  populateQtdSelect(document.getElementById('pigmento-qtd-select'), null, 'pigmento');

  switchPage('agendamentos');
});

/* ===== PHONE MASK ===== */
function maskTelefone(input) {
  input.addEventListener('input', function() {
    var v = this.value.replace(/\D/g, '');
    if (v.length > 11) v = v.substring(0, 11);
    if (v.length > 6) {
      this.value = '(' + v.substring(0,2) + ') ' + v.substring(2,7) + '-' + v.substring(7);
    } else if (v.length > 2) {
      this.value = '(' + v.substring(0,2) + ') ' + v.substring(2);
    } else if (v.length > 0) {
      this.value = '(' + v;
    }
  });
}

/* ===== IDENTIFICAÇÃO DO CLIENTE ===== */
async function consultarCliente() {
  var tel = document.getElementById('id-telefone').value.trim();
  var feedback = document.getElementById('id-feedback');

  if (!tel || tel.replace(/\D/g,'').length < 10) {
    feedback.style.display = 'block';
    feedback.style.color = '#e74c3c';
    feedback.textContent = 'Digite um telefone válido.';
    return;
  }

  feedback.style.display = 'block';
  feedback.style.color = 'var(--text-muted)';
  feedback.textContent = 'Consultando...';

  var telDigits = tel.replace(/\D/g,'');
  var found = clients.find(function(c) {
    return c.telefone.replace(/\D/g,'') === telDigits;
  });

  // Se não encontrou localmente, buscar direto no banco
  if (!found) {
    var tenantId = getCurrentTenantId();
    var dbResult = await buscarClientePorTelefone(tel, tenantId);
    if (dbResult) {
      found = { id: dbResult.id, nome: dbResult.nome, telefone: dbResult.telefone, nascimento: dbResult.nascimento || '' };
      if (!clients.some(function(c) { return c.id === found.id; })) {
        clients.push(found);
      }
    }
  }

  if (found) {
    feedback.style.color = 'var(--gold)';
    feedback.textContent = 'Cliente encontrado: ' + found.nome;
    setTimeout(function() {
      closeModal('modal-identificacao');
      openAgendamentoModal(null, found.nome, found.telefone);
    }, 600);
  } else {
    feedback.style.color = '#e74c3c';
    feedback.textContent = 'Cliente não cadastrado. Redirecionando para cadastro...';
    pendingClienteFromIdentificacao = true;
    setTimeout(function() {
      closeModal('modal-identificacao');
      document.getElementById('form-cliente').reset();
      document.getElementById('cl-telefone').value = tel;
      openModal('modal-cliente');
    }, 1000);
  }
}

/* ===== NAVIGATION ===== */
function switchPage(page) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('page-' + page).classList.add('active');
  var navBtn = document.querySelector('.nav-btn[data-page="' + page + '"]');
  if (navBtn) navBtn.classList.add('active');

  if (page === 'agendamentos') { renderCalendar(); renderDayDetail(); }
  if (page === 'clientes') { renderClients(); }
  if (page === 'profissionais') { renderProfessionals(); }
  if (page === 'dashboard') { initDashboard(); }
  if (page === 'configuracoes') { initConfiguracoes(); }

  closeSidebar();
}

/* ===== SIDEBAR MOBILE ===== */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('hamburger').style.display = 'none';
  document.getElementById('sidebar-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('hamburger').style.display = '';
  document.getElementById('sidebar-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

/* ===== FILTER BAR (ADMIN) ===== */
function toggleFilterBar() {
  var bar = document.getElementById('filter-bar');
  if (bar.style.display === 'none') {
    bar.style.display = 'flex';
    renderFilterChips();
  } else {
    bar.style.display = 'none';
  }
}

function renderFilterChips() {
  var container = document.getElementById('filter-chips');
  container.innerHTML = '';
  // FIX 1: Colaborador não pode alterar o filtro (RLS já isola, mas travamos a UI também).
  var lockedForColaborador = (currentUser.role === 'colaborador');
  Object.keys(professionals).forEach(function(name) {
    var chip = document.createElement('button');
    var isActive = activeFilters.indexOf(name) >= 0;
    chip.className = 'filter-chip' + (isActive ? ' active' : '') + (lockedForColaborador ? ' locked' : '');
    var avatarHtml = getAvatarHtml(name, 'avatar--chip');
    chip.innerHTML = avatarHtml + '<span>' + name + '</span>' + (lockedForColaborador && isActive ? ' 🔒' : '');
    if (lockedForColaborador) {
      chip.disabled = true;
      chip.title = 'Filtro travado: você só visualiza dados do seu profissional vinculado.';
    } else {
      chip.onclick = function() {
        var idx = activeFilters.indexOf(name);
        if (idx >= 0) { activeFilters.splice(idx, 1); } else { activeFilters.push(name); }
        renderFilterChips();
        renderCalendar();
        renderDayDetail();
      };
    }
    container.appendChild(chip);
  });
}

/* ===== Avatar helper ===== */
function getAvatarHtml(name, sizeClass) {
  var url = professionalAvatars[name];
  var classes = 'avatar' + (sizeClass ? ' ' + sizeClass : '');
  if (url) {
    return '<div class="' + classes + '"><img src="' + url + '" alt="' + name + '" decoding="async" fetchpriority="high"></div>';
  }
  return '<div class="' + classes + '">' + (name ? name.charAt(0).toUpperCase() : '?') + '</div>';
}

/* ===== HELPER: Get professionals from appointment ===== */
function getAppointmentProfessionals(a) {
  var profs = [];
  if (a.servicos && a.servicos.length > 0) {
    a.servicos.forEach(function(s) { if (profs.indexOf(s.profissional) < 0) profs.push(s.profissional); });
  } else if (a.profissional) {
    profs.push(a.profissional);
  }
  return profs;
}

function appointmentMatchesFilter(a) {
  var profs = getAppointmentProfessionals(a);
  for (var i = 0; i < profs.length; i++) {
    if (activeFilters.indexOf(profs[i]) >= 0) return true;
  }
  return false;
}

function getAppointmentDuration(a) {
  var total = 0;
  if (a.servicos && a.servicos.length > 0) {
    a.servicos.forEach(function(s) {
      var sp = servicePrices[s.servico];
      total += sp ? sp.duracao : 30;
    });
  } else {
    var sp = servicePrices[a.servico];
    total = sp ? sp.duracao : 30;
  }
  return total;
}

function getAppointmentPrice(a) {
  var total = 0;
  if (a.servicos && a.servicos.length > 0) {
    a.servicos.forEach(function(s) {
      var sp = servicePrices[s.servico];
      total += sp ? sp.preco : 0;
    });
  } else {
    var sp = servicePrices[a.servico];
    total = sp ? sp.preco : 0;
  }
  return total;
}

function getAppointmentServicos(a) {
  if (a.servicos && a.servicos.length > 0) return a.servicos;
  return [{ profissional: a.profissional, servico: a.servico, bases: [], pigmentacoes: [] }];
}

function getAppointmentServiceNames(a) {
  return getAppointmentServicos(a).map(function(s) { return s.servico; }).join(', ');
}

/* ============================================================================
 * ✅ FIX MULTI-PROFISSIONAL: expandir agendamento em "eventos por serviço".
 * Cada serviço de um agendamento vira um evento independente, com:
 *   - profissional próprio (s.profissional)
 *   - horário sequencial (1º começa em a.hora; demais somam a duração anterior)
 *   - duração própria (s.duracao || servicePrices[s.servico].duracao)
 * Usado pela renderização da agenda. NÃO altera persistência.
 * ========================================================================== */
function expandToServiceEvents(apps) {
  var events = [];
  apps.forEach(function(a) {
    var servicos = getAppointmentServicos(a);
    var parts = (a.hora || '00:00').split(':');
    var cursor = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0); // minutos do dia
    servicos.forEach(function(s, idx) {
      var sp = servicePrices[s.servico];
      var dur = s.duracao || (sp ? sp.duracao : 30);
      var hh = Math.floor(cursor / 60);
      var mm = cursor % 60;
      var hora = pad(hh) + ':' + pad(mm);
      events.push({
        // referência ao agendamento original (para edição/click)
        agendamento: a,
        id: a.id + '__svc' + idx,
        cliente: a.cliente,
        telefone: a.telefone,
        data: a.data,
        hora: hora,
        duracao: dur,
        profissional: s.profissional || a.profissional,
        servico: s.servico,
        servicoData: s,
        idx: idx,
        totalSvcs: servicos.length,
        status: a.status
      });
      cursor += dur;
    });
  });
  return events;
}

function eventDuration(ev) { return ev.duracao || 30; }


/* ===== CALENDAR ===== */
function renderCalendar() {
  document.getElementById('month-year').textContent = MONTHS[currentMonth] + ' ' + currentYear;
  var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  var firstDay = new Date(currentYear, currentMonth, 1).getDay();
  var container = document.getElementById('calendar-days');
  container.innerHTML = '';

  for (var i = 0; i < firstDay; i++) {
    var empty = document.createElement('div');
    empty.className = 'calendar-day empty';
    container.appendChild(empty);
  }

  for (var d = 1; d <= daysInMonth; d++) {
    var btn = document.createElement('button');
    btn.className = 'calendar-day';
    btn.textContent = d;
    if (d === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear()) btn.classList.add('today');
    if (d === selectedDay) btn.classList.add('selected');

    var dateStr = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(d);
    var hasApt = appointments.some(function(a) { return a.data === dateStr && appointmentMatchesFilter(a); });
    if (hasApt) btn.classList.add('has-appointment');

    btn.addEventListener('click', (function(day) {
      return function() { selectedDay = day; renderCalendar(); renderDayDetail(); };
    })(d));
    container.appendChild(btn);
  }
}

/* ===== TIMELINE DAY VIEW ===== */
function renderDayDetail() {
  var date = new Date(currentYear, currentMonth, selectedDay);
  var weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });
  var formatted = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  document.getElementById('day-detail-header').textContent = weekday + ', ' + formatted;

  var dateStr = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(selectedDay);
  var dayAppointments = appointments.filter(function(a) { return a.data === dateStr && appointmentMatchesFilter(a); });
  dayAppointments.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

  var container = document.getElementById('day-appointments');

  if (dayAppointments.length === 0) {
    container.className = '';
    container.innerHTML = '<div class="no-appointments"><i class="fa-regular fa-clock"></i><p>Nenhum agendamento neste dia</p></div>';
    return;
  }

  // ✅ FIX MULTI-PROFISSIONAL: trabalhar com EVENTOS (1 por serviço), não agendamentos.
  var dayEvents = expandToServiceEvents(dayAppointments).filter(function(ev) {
    // respeita o filtro: cada evento só aparece se SEU profissional está no filtro
    return activeFilters.indexOf(ev.profissional) >= 0;
  });
  dayEvents.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

  var showMultiAgenda = isAdmin() && activeFilters.length > 1;

  if (showMultiAgenda) {
    renderMultiAgenda(container, dayEvents, dateStr);
  } else {
    renderSingleTimeline(container, dayEvents);
  }
}

function computeEndTime(hora, durationMin) {
  var parts = hora.split(':');
  var h = parseInt(parts[0]);
  var m = parseInt(parts[1] || 0);
  var totalMin = h * 60 + m + durationMin;
  var eh = Math.floor(totalMin / 60);
  var em = totalMin % 60;
  return pad(eh) + ':' + pad(em);
}

// Agrupa EVENTOS que se sobrepõem no tempo (mesmo profissional ou mesma coluna)
function computeOverlapGroups(events) {
  var sorted = events.slice().sort(function(a, b) { return a.hora.localeCompare(b.hora); });
  var groups = [];
  sorted.forEach(function(a) {
    var aParts = a.hora.split(':');
    var aStart = parseInt(aParts[0]) * 60 + parseInt(aParts[1] || 0);
    var aEnd = aStart + eventDuration(a);
    var placed = false;
    for (var g = 0; g < groups.length; g++) {
      var overlaps = false;
      for (var i = 0; i < groups[g].length; i++) {
        var b = groups[g][i];
        var bParts = b.hora.split(':');
        var bStart = parseInt(bParts[0]) * 60 + parseInt(bParts[1] || 0);
        var bEnd = bStart + eventDuration(b);
        if (aStart < bEnd && aEnd > bStart) { overlaps = true; break; }
      }
      if (overlaps) { groups[g].push(a); placed = true; break; }
    }
    if (!placed) groups.push([a]);
  });
  return groups;
}

function assignColumns(group) {
  var sorted = group.slice().sort(function(a, b) { return a.hora.localeCompare(b.hora); });
  var columns = [];
  var result = {};
  sorted.forEach(function(a) {
    var aParts = a.hora.split(':');
    var aStart = parseInt(aParts[0]) * 60 + parseInt(aParts[1] || 0);
    var placed = false;
    for (var c = 0; c < columns.length; c++) {
      var lastInCol = columns[c];
      var lParts = lastInCol.hora.split(':');
      var lStart = parseInt(lParts[0]) * 60 + parseInt(lParts[1] || 0);
      var lEnd = lStart + eventDuration(lastInCol);
      if (aStart >= lEnd) { columns[c] = a; result[a.id] = c; placed = true; break; }
    }
    if (!placed) { result[a.id] = columns.length; columns.push(a); }
  });
  return { map: result, totalCols: columns.length };
}

function renderSingleTimeline(container, dayEvents) {
  container.className = 'timeline-container';
  var html = '<div class="timeline">';
  for (var h = 7; h <= 21; h++) {
    html += '<div class="timeline-row"><div class="timeline-hour">' + pad(h) + ':00</div><div class="timeline-slot" data-hour="' + h + '"></div></div>';
  }
  html += '<div class="timeline-blocks" id="timeline-blocks"></div></div>';
  container.innerHTML = html;

  var blocksContainer = document.getElementById('timeline-blocks');
  var groups = computeOverlapGroups(dayEvents);
  groups.forEach(function(group) {
    var cols = assignColumns(group);
    group.forEach(function(ev) {
      renderTimelineBlock(blocksContainer, ev, cols.map[ev.id], cols.totalCols);
    });
  });
}

function renderMultiAgenda(container, dayEvents, dateStr) {
  container.className = 'multi-agenda-container';
  var html = '<div class="multi-agenda">';
  html += '<div class="multi-agenda-header"><div class="timeline-hour-header"></div>';
  activeFilters.forEach(function(name) {
    var avatarHtml = getAvatarHtml(name, 'avatar--sm');
    html += '<div class="multi-agenda-col-header">' + avatarHtml + '<span>' + name + '</span></div>';
  });
  html += '</div><div class="multi-agenda-body">';
  for (var h = 7; h <= 21; h++) {
    html += '<div class="multi-agenda-row"><div class="timeline-hour">' + pad(h) + ':00</div>';
    activeFilters.forEach(function(name) { html += '<div class="multi-agenda-cell" data-prof="' + name + '" data-hour="' + h + '"></div>'; });
    html += '</div>';
  }
  html += '</div>';
  activeFilters.forEach(function(name) { html += '<div class="multi-agenda-blocks" data-prof-col="' + name + '"></div>'; });
  html += '</div>';
  container.innerHTML = html;

  // ✅ Cada coluna recebe SOMENTE os eventos do seu profissional
  activeFilters.forEach(function(name, colIdx) {
    var profEvents = dayEvents.filter(function(ev) { return ev.profissional === name; });
    var blocksEl = container.querySelector('.multi-agenda-blocks[data-prof-col="' + name + '"]');
    var groups = computeOverlapGroups(profEvents);
    groups.forEach(function(group) {
      var cols = assignColumns(group);
      var totalSubCols = cols.totalCols;
      group.forEach(function(ev) {
        var subCol = cols.map[ev.id];
        renderTimelineBlockMulti(blocksEl, ev, colIdx, activeFilters.length, subCol, totalSubCols);
      });
    });
  });
}

function renderTimelineBlockMulti(container, ev, colIdx, totalCols, subCol, totalSubCols) {
  var parts = ev.hora.split(':');
  var hourNum = parseInt(parts[0]);
  var minNum = parseInt(parts[1] || 0);
  var startMinutes = (hourNum - 7) * 60 + minNum;
  var duration = eventDuration(ev);
  var topPx = startMinutes;
  var heightPx = Math.max(duration, 20);

  var endTime = computeEndTime(ev.hora, duration);

  var block = document.createElement('div');
  block.className = 'timeline-block';
  block.style.top = topPx + 'px';
  block.style.height = heightPx + 'px';
  block.style.overflow = 'hidden';

  var colWidth = 100 / totalCols;
  var subWidth = colWidth / totalSubCols;
  block.style.left = (colIdx * colWidth + subCol * subWidth) + '%';
  block.style.width = subWidth + '%';
  if (totalSubCols > 1) {
    block.style.zIndex = 10 + subCol;
    block.style.boxShadow = '-2px 0 4px rgba(0,0,0,0.15)';
  }

  buildBlockContent(block, ev, heightPx, endTime, ev.servico);
  block.onclick = function() { openAgendamentoParaEditar(ev.agendamento); };
  container.appendChild(block);
}

function renderTimelineBlock(container, ev, colIdx, totalCols) {
  var parts = ev.hora.split(':');
  var hourNum = parseInt(parts[0]);
  var minNum = parseInt(parts[1] || 0);
  var startMinutes = (hourNum - 7) * 60 + minNum;
  var duration = eventDuration(ev);
  var topPx = startMinutes;
  var heightPx = Math.max(duration, 20);

  var endTime = computeEndTime(ev.hora, duration);

  var block = document.createElement('div');
  block.className = 'timeline-block';
  block.style.top = topPx + 'px';
  block.style.height = heightPx + 'px';
  block.style.overflow = 'hidden';

  if (totalCols > 1) {
    var colWidth = 100 / totalCols;
    block.style.left = (colIdx * colWidth) + '%';
    block.style.width = colWidth + '%';
    block.style.zIndex = 10 + colIdx;
    block.style.boxShadow = '-2px 0 4px rgba(0,0,0,0.15)';
  }

  buildBlockContent(block, ev, heightPx, endTime, ev.servico);
  block.onclick = function() { openAgendamentoParaEditar(ev.agendamento); };
  container.appendChild(block);
}

function buildBlockContent(block, ev, heightPx, endTime, serviceNames) {
  var timeRange = ev.hora + ' \u2013 ' + endTime;
  var serviceText = serviceNames ? ' - ' + serviceNames : '';
  // Indicador visual quando o agendamento tem múltiplos serviços (este é o N de M)
  var partTag = (ev.totalSvcs && ev.totalSvcs > 1)
    ? ' <span class="tb-part" style="opacity:.7;font-size:.75em;">(' + (ev.idx + 1) + '/' + ev.totalSvcs + ')</span>'
    : '';
  block.style.display = 'flex';
  block.style.flexDirection = 'column';
  block.style.justifyContent = 'center';
  if (heightPx <= 38) {
    block.innerHTML = '<div class="tb-row-compact">' +
      '<span class="tb-time">' + timeRange + '</span> <span class="tb-client">' + ev.cliente + '</span><span class="tb-service">' + serviceText + '</span>' + partTag + '</div>';
  } else if (heightPx <= 55) {
    block.innerHTML = '<div class="tb-time tb-truncate">' + timeRange + partTag + '</div>' +
      '<div class="tb-row-compact"><span class="tb-client">' + ev.cliente + '</span><span class="tb-service">' + serviceText + '</span></div>';
  } else {
    block.innerHTML = '<div class="tb-time tb-truncate">' + timeRange + partTag + '</div>' +
      '<div class="tb-client tb-truncate">' + ev.cliente + '</div>' +
      '<div class="tb-service tb-truncate">' + serviceNames + '</div>';
  }
}

function openAgendamentoModal(agId, clienteNome, clienteTel) {
  editingAppointmentId = agId || null;
  document.getElementById('ag-cliente').value = clienteNome || '';
  document.getElementById('ag-telefone').value = clienteTel || '';
  document.getElementById('modal-agendamento-titulo').textContent = agId ? 'Editar Agendamento' : 'Novo Agendamento';
  document.getElementById('btn-excluir-agendamento').style.display = agId ? 'flex' : 'none';
  document.getElementById('servicos-container').innerHTML = '';

  if (!agId) {
    adicionarBlocoServico();
    document.getElementById('ag-data').value = formatDateInput(new Date(currentYear, currentMonth, selectedDay));
    document.getElementById('ag-hora-h').value = '09';
    document.getElementById('ag-minuto').value = '00';
  }

  openModal('modal-agendamento');
}

function openAgendamentoParaEditar(a) {
  openAgendamentoModal(a.id, a.cliente, a.telefone);
  var servicos = getAppointmentServicos(a);
  document.getElementById('servicos-container').innerHTML = '';
  servicos.forEach(function(s) { adicionarBlocoServicoComDados(s); });
  document.getElementById('ag-data').value = a.data;
  var horaParts = a.hora.split(':');
  document.getElementById('ag-hora-h').value = horaParts[0];
  document.getElementById('ag-minuto').value = horaParts[1] || '00';
}

/* ===== MULTI-SERVICE BLOCKS ===== */
var servicoBlockCounter = 0;

function adicionarBlocoServico() { adicionarBlocoServicoComDados(null); }

function adicionarBlocoServicoComDados(dados) {
  var container = document.getElementById('servicos-container');
  var blockId = 'svc-block-' + (servicoBlockCounter++);
  var wrapper = document.createElement('div');
  wrapper.className = 'servico-block';
  wrapper.id = blockId;

  var removeHtml = container.children.length > 0 ?
    '<button type="button" class="servico-remove-btn" onclick="removerBlocoServico(\'' + blockId + '\')"><i class="fa-solid fa-xmark"></i></button>' : '';

  wrapper.innerHTML =
    '<div class="servico-block-header"><span class="servico-block-title">Serviço ' + (container.children.length + 1) + '</span>' + removeHtml + '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Profissional</label><select class="svc-profissional" onchange="onSvcProfChange(this)" required><option value="">Selecione...</option></select></div>' +
    '<div class="form-group"><label>Serviço</label><select class="svc-servico" onchange="onSvcServicoChange(this)" required><option value="">Selecione...</option></select></div>' +
    '</div>' +
    '<div class="svc-extras"></div>';

  container.appendChild(wrapper);

  var profSelect = wrapper.querySelector('.svc-profissional');
  Object.keys(professionals).forEach(function(name) {
    var opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    profSelect.appendChild(opt);
  });

  // 🔒 REGRA: Colaborador agenda apenas para si mesmo
  if (currentUser.role === 'colaborador' && currentUser.profissionalNome) {
    // Garantir que a opção exista (caso professionals ainda não tenha sido populado com este prof)
    var hasOpt = Array.prototype.some.call(profSelect.options, function(o){ return o.value === currentUser.profissionalNome; });
    if (!hasOpt) {
      var optForced = document.createElement('option');
      optForced.value = currentUser.profissionalNome;
      optForced.textContent = currentUser.profissionalNome;
      profSelect.appendChild(optForced);
    }
    profSelect.value = currentUser.profissionalNome;
    profSelect.disabled = true;
    profSelect.setAttribute('data-locked-colaborador', '1');
    // Disparar onChange para popular serviços
    onSvcProfChange(profSelect);
  }

  if (dados) {
    profSelect.value = dados.profissional || '';
    onSvcProfChange(profSelect);
    wrapper.querySelector('.svc-servico').value = dados.servico || '';
    onSvcServicoChange(wrapper.querySelector('.svc-servico'));

    if (dados.bases && dados.bases.length > 0) {
      var extrasDiv = wrapper.querySelector('.svc-extras');
      var basesContainer = extrasDiv.querySelector('.bases-container');
      if (basesContainer) {
        basesContainer.innerHTML = '';
        dados.bases.forEach(function(b) { adicionarCampoBaseComValor(basesContainer, b.cor, b.qtd); });
      }
    }

    if (dados.pigmentacoes && dados.pigmentacoes.length > 0) {
      var extrasDiv2 = wrapper.querySelector('.svc-extras');
      var pigContainer = extrasDiv2.querySelector('.pig-container');
      if (pigContainer) {
        pigContainer.innerHTML = '';
        dados.pigmentacoes.forEach(function(p) { adicionarPigmentacaoComValor(pigContainer, p.cor, p.qtd); });
      }
    }

    if (dados.cores && dados.cores.length > 0) {
      var extrasDiv3 = wrapper.querySelector('.svc-extras');
      var coresContainer = extrasDiv3.querySelector('.cores-container');
      if (coresContainer) {
        coresContainer.innerHTML = '';
        dados.cores.forEach(function(c) { adicionarCorSimplesComValor(coresContainer, c); });
      }
    }
  }

  atualizarNumerosServicos();
}

function removerBlocoServico(blockId) {
  var el = document.getElementById(blockId);
  if (el) el.remove();
  atualizarNumerosServicos();
}

function atualizarNumerosServicos() {
  var blocks = document.querySelectorAll('.servico-block');
  blocks.forEach(function(b, i) {
    var title = b.querySelector('.servico-block-title');
    if (title) title.textContent = 'Serviço ' + (i + 1);
    var rmBtn = b.querySelector('.servico-remove-btn');
    if (rmBtn) rmBtn.style.display = blocks.length > 1 ? '' : 'none';
  });
}

function onSvcProfChange(selectEl) {
  var prof = selectEl.value;
  var block = selectEl.closest('.servico-block');
  var svcSelect = block.querySelector('.svc-servico');
  svcSelect.innerHTML = '<option value="">Selecione...</option>';
  var services = getProfServiceNames(prof);
  services.forEach(function(s) {
    var opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    svcSelect.appendChild(opt);
  });
  onSvcServicoChange(svcSelect);
}

function onSvcServicoChange(selectEl) {
  var block = selectEl.closest('.servico-block');
  var servico = selectEl.value;
  var extrasDiv = block.querySelector('.svc-extras');
  extrasDiv.innerHTML = '';

  // Encontrar o serviço pelo nome e verificar usa_cores (database-driven)
  var svcObj = allServicos.find(function(s) { return s.nome === servico; });
  if (!svcObj || !svcObj.usa_cores) return;

  var servicoId = svcObj.id;
  var cores = coresPorServico[servicoId] || { base: [], pigmento: [] };
  var temBase = cores.base.length > 0;
  var temPigmento = cores.pigmento.length > 0;

  if (temBase || temPigmento) {
    var html = '';
    if (temBase) {
      html += '<div class="form-group"><label>Base</label>' +
        '<div class="bases-container"></div>' +
        '<button type="button" class="btn-add-cor" onclick="adicionarCampoBase(this)" data-servico-id="' + servicoId + '"><i class="fa-solid fa-circle-plus"></i> Adicionar outra base</button>' +
        '</div>';
    }
    if (temPigmento) {
      html += '<div class="form-group"><label>Pigmentação</label>' +
        '<div class="pig-container"></div>' +
        '<button type="button" class="btn-add-cor" onclick="adicionarPigmentacao(this)" data-servico-id="' + servicoId + '"><i class="fa-solid fa-circle-plus"></i> Adicionar pigmentação</button>' +
        '</div>';
    }
    extrasDiv.innerHTML = html;
    // Store servicoId on the block for later use
    block.dataset.servicoId = servicoId;
    if (temBase) adicionarCampoBase(extrasDiv.querySelector('[onclick*="adicionarCampoBase"]'));
  } else {
    // Serviço usa cores mas não tem base/pigmento configurados - mostrar seletor simples
    extrasDiv.innerHTML =
      '<div class="form-group"><label>Cores</label>' +
      '<div class="cores-container"></div>' +
      '<button type="button" class="btn-add-cor" onclick="adicionarCorSimples(this)" data-servico-id="' + servicoId + '"><i class="fa-solid fa-circle-plus"></i> Adicionar cor</button>' +
      '</div>';
    block.dataset.servicoId = servicoId;
    adicionarCorSimples(extrasDiv.querySelector('.btn-add-cor'));
  }
}

/* ===== BASE / PIGMENTAÇÃO / COR (DINÂMICO) ===== */
function adicionarCampoBase(btn) {
  var container = btn.closest('.form-group').querySelector('.bases-container');
  adicionarCampoBaseComValor(container, '', '');
}

function adicionarCampoBaseComValor(container, corVal, qtdVal) {
  var wrapper = document.createElement('div');
  wrapper.className = 'base-item';
  var display = document.createElement('div');
  display.className = 'cor-select-display';
  var swatch = document.createElement('span');
  swatch.className = 'cor-swatch';
  var label = document.createElement('span');
  label.className = 'cor-label placeholder';
  label.textContent = 'Selecione base';
  var qtdBadge = document.createElement('span');
  qtdBadge.className = 'base-qtd-badge';
  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'cor-remove-btn';
  removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  removeBtn.onclick = function(e) { e.stopPropagation(); wrapper.remove(); };
  display.appendChild(swatch);
  display.appendChild(label);
  display.appendChild(qtdBadge);
  display.appendChild(removeBtn);
  var dropdown = document.createElement('div');
  dropdown.className = 'base-grid-dropdown';
  var servicoId = container.closest('.servico-block') ? container.closest('.servico-block').dataset.servicoId : null;
  var cores = servicoId ? (coresPorServico[servicoId] || { base: [], pigmento: [] }) : getCoresDoServico_legacy();
  var baseCores = cores.base;
  baseCores.forEach(function(opt) {
    var item = document.createElement('div');
    item.className = 'base-grid-option';
    item.style.background = opt.hex;
    item.title = opt.nome;
    item.innerHTML = '<span class="base-grid-code">' + opt.nome + '</span>';
    item.onclick = function(e) {
      e.stopPropagation();
      swatch.style.background = opt.hex;
      swatch.style.borderStyle = 'solid';
      label.textContent = opt.nome;
      label.className = 'cor-label';
      wrapper.dataset.cor = opt.nome;
      dropdown.classList.remove('open');
      pendingBaseCallback = function(qtd) {
        var cfgU = getQtdOptions(servicoId, 'base');
        wrapper.dataset.qtd = qtd;
        qtdBadge.textContent = qtd + (cfgU.unidade || 'g');
      };
      var baseQtdSel = document.getElementById('base-qtd-select');
      if (baseQtdSel) populateQtdSelect(baseQtdSel, servicoId, 'base');
      openModal('modal-base-qtd');
    };
    dropdown.appendChild(item);
  });
  display.onclick = function(e) {
    e.stopPropagation();
    document.querySelectorAll('.base-grid-dropdown.open, .pig-dropdown.open, .cor-dropdown.open').forEach(function(d) { if (d !== dropdown) d.classList.remove('open'); });
    dropdown.classList.toggle('open');
  };
  wrapper.appendChild(display);
  wrapper.appendChild(dropdown);
  if (corVal) {
    var o = baseCores.find(function(x) { return x.nome === corVal; });
    if (!o) { var legacy = colorOptions.find(function(x) { return x.code === corVal; }); if (legacy) o = { nome: legacy.code, hex: legacy.hex }; }
    if (o) { swatch.style.background = o.hex; swatch.style.borderStyle = 'solid'; label.textContent = o.nome; label.className = 'cor-label'; wrapper.dataset.cor = corVal; }
    if (qtdVal) { wrapper.dataset.qtd = qtdVal; qtdBadge.textContent = qtdVal + 'g'; }
  }
  container.appendChild(wrapper);
}

function confirmarBaseQtd() {
  var qtd = document.getElementById('base-qtd-select').value;
  if (pendingBaseCallback) { pendingBaseCallback(qtd); pendingBaseCallback = null; }
  closeModal('modal-base-qtd');
}

function adicionarPigmentacao(btn) {
  var container = btn.closest('.form-group').querySelector('.pig-container');
  adicionarPigmentacaoComValor(container, '', '');
}

function adicionarPigmentacaoComValor(container, corVal, qtdVal) {
  var wrapper = document.createElement('div');
  wrapper.className = 'pig-item';
  var display = document.createElement('div');
  display.className = 'cor-select-display';
  var swatch = document.createElement('span');
  swatch.className = 'cor-swatch';
  var label = document.createElement('span');
  label.className = 'cor-label placeholder';
  label.textContent = 'Selecione pigmento';
  var qtdBadge = document.createElement('span');
  qtdBadge.className = 'base-qtd-badge';
  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'cor-remove-btn';
  removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  removeBtn.onclick = function(e) { e.stopPropagation(); wrapper.remove(); };
  display.appendChild(swatch);
  display.appendChild(label);
  display.appendChild(qtdBadge);
  display.appendChild(removeBtn);
  var dropdown = document.createElement('div');
  dropdown.className = 'pig-dropdown';
  var servicoId = container.closest('.servico-block') ? container.closest('.servico-block').dataset.servicoId : null;
  var cores = servicoId ? (coresPorServico[servicoId] || { base: [], pigmento: [] }) : getCoresDoServico_legacy();
  var pigCores = cores.pigmento;
  pigCores.forEach(function(opt) {
    var item = document.createElement('div');
    item.className = 'pig-option';
    item.style.background = opt.hex;
    item.title = opt.nome;
    item.innerHTML = '<span class="pig-code">' + opt.nome + '</span>';
    item.onclick = function(e) {
      e.stopPropagation();
      swatch.style.background = opt.hex;
      swatch.style.borderStyle = 'solid';
      label.textContent = opt.nome;
      label.className = 'cor-label';
      wrapper.dataset.cor = opt.nome;
      dropdown.classList.remove('open');
      pendingPigmentoCallback = function(qtd) {
        var cfgU = getQtdOptions(servicoId, 'pigmento');
        wrapper.dataset.qtd = qtd;
        qtdBadge.textContent = qtd + (cfgU.unidade || 'g');
      };
      var pigQtdSel = document.getElementById('pigmento-qtd-select');
      if (pigQtdSel) populateQtdSelect(pigQtdSel, servicoId, 'pigmento');
      openModal('modal-pigmento-qtd');
    };
    dropdown.appendChild(item);
  });
  display.onclick = function(e) {
    e.stopPropagation();
    document.querySelectorAll('.base-grid-dropdown.open, .pig-dropdown.open, .cor-dropdown.open').forEach(function(d) { if (d !== dropdown) d.classList.remove('open'); });
    dropdown.classList.toggle('open');
  };
  wrapper.appendChild(display);
  wrapper.appendChild(dropdown);
  if (corVal) {
    var o = pigCores.find(function(x) { return x.nome === corVal; });
    if (!o) { var legacy = pigmentOptions.find(function(x) { return x.code === corVal; }); if (legacy) o = { nome: legacy.code, hex: legacy.hex }; }
    if (o) { swatch.style.background = o.hex; swatch.style.borderStyle = 'solid'; label.textContent = o.nome; label.className = 'cor-label'; wrapper.dataset.cor = corVal; }
    if (qtdVal) { wrapper.dataset.qtd = qtdVal; qtdBadge.textContent = qtdVal + 'g'; }
  }
  container.appendChild(wrapper);
}

function confirmarPigmentoQtd() {
  var qtd = document.getElementById('pigmento-qtd-select').value;
  if (pendingPigmentoCallback) { pendingPigmentoCallback(qtd); pendingPigmentoCallback = null; }
  closeModal('modal-pigmento-qtd');
}

function adicionarCorSimples(btn) {
  var container = btn.closest('.form-group').querySelector('.cores-container');
  if (container.children.length >= 5) return;
  adicionarCorSimplesComValor(container, '');
  if (container.children.length >= 5) btn.classList.add('disabled');
}

function adicionarCorSimplesComValor(container, valor) {
  var wrapper = document.createElement('div');
  wrapper.className = 'cor-select-wrapper';
  var display = document.createElement('div');
  display.className = 'cor-select-display';
  var swatch = document.createElement('span');
  swatch.className = 'cor-swatch';
  var label = document.createElement('span');
  label.className = 'cor-label placeholder';
  label.textContent = 'Selecione uma cor';
  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'cor-remove-btn';
  removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  removeBtn.onclick = function(e) {
    e.stopPropagation(); wrapper.remove();
    var addBtn = container.closest('.form-group').querySelector('.btn-add-cor');
    if (addBtn && container.children.length < 5) addBtn.classList.remove('disabled');
  };
  display.appendChild(swatch);
  display.appendChild(label);
  display.appendChild(removeBtn);
  var dropdown = document.createElement('div');
  dropdown.className = 'cor-dropdown';
  var servicoId = container.closest('.servico-block') ? container.closest('.servico-block').dataset.servicoId : null;
  var cores = servicoId ? (coresPorServico[servicoId] || { base: [], pigmento: [] }) : getCoresDoServico_legacy();
  var allCores = cores.base.concat(cores.pigmento);
  if (allCores.length === 0) { allCores = colorOptions.map(function(o) { return { nome: o.code, hex: o.hex }; }); }
  allCores.forEach(function(opt) {
    var item = document.createElement('div');
    item.className = 'cor-option';
    item.innerHTML = '<span class="cor-swatch" style="background:' + opt.hex + ';border:1px solid rgba(255,255,255,0.15)"></span><span>' + opt.nome + '</span>';
    item.onclick = function(e) {
      e.stopPropagation();
      swatch.style.background = opt.hex; swatch.style.borderStyle = 'solid';
      label.textContent = opt.nome; label.className = 'cor-label';
      wrapper.dataset.cor = opt.nome; dropdown.classList.remove('open');
    };
    dropdown.appendChild(item);
  });
  display.onclick = function(e) {
    e.stopPropagation();
    document.querySelectorAll('.cor-dropdown.open').forEach(function(d) { if (d !== dropdown) d.classList.remove('open'); });
    dropdown.classList.toggle('open');
  };
  wrapper.appendChild(display);
  wrapper.appendChild(dropdown);
  if (valor) {
    var o = allCores.find(function(x) { return x.nome === valor; });
    if (!o) { var legacy = colorOptions.find(function(x) { return x.code === valor; }); if (legacy) o = { nome: legacy.code, hex: legacy.hex }; }
    if (o) { swatch.style.background = o.hex; swatch.style.borderStyle = 'solid'; label.textContent = o.nome; label.className = 'cor-label'; wrapper.dataset.cor = valor; }
  }
  container.appendChild(wrapper);
}

document.addEventListener('click', function() {
  document.querySelectorAll('.cor-dropdown.open, .pig-dropdown.open, .base-grid-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
});

/* ===== COLLECT SERVICE DATA ===== */
function collectServicos() {
  var blocks = document.querySelectorAll('.servico-block');
  var servicos = [];
  blocks.forEach(function(block) {
    var prof = block.querySelector('.svc-profissional').value;
    // 🔒 REGRA: Colaborador SEMPRE agenda para o profissional vinculado (anti-bypass)
    if (currentUser.role === 'colaborador' && currentUser.profissionalNome) {
      prof = currentUser.profissionalNome;
    }
    var servico = block.querySelector('.svc-servico').value;
    if (!prof || !servico) return;
    var svc = { profissional: prof, servico: servico, bases: [], pigmentacoes: [], cores: [] };
    block.querySelectorAll('.base-item').forEach(function(bi) {
      if (bi.dataset.cor) svc.bases.push({ cor: bi.dataset.cor, qtd: parseInt(bi.dataset.qtd) || 0 });
    });
    block.querySelectorAll('.pig-item').forEach(function(pi) {
      if (pi.dataset.cor) svc.pigmentacoes.push({ cor: pi.dataset.cor, qtd: parseInt(pi.dataset.qtd) || 0 });
    });
    block.querySelectorAll('.cores-container .cor-select-wrapper').forEach(function(cw) {
      if (cw.dataset.cor && cw.dataset.cor !== 'Nenhuma') svc.cores.push(cw.dataset.cor);
    });
    servicos.push(svc);
  });
  return servicos;
}

/* ===== SAVE APPOINTMENT ===== */
async function saveAppointment(e) {
  e.preventDefault();
  // 🔒 REGRA: Colaborador precisa estar vinculado a um profissional para agendar
  if (currentUser.role === 'colaborador' && !currentUser.profissionalNome) {
    showToast('Seu usuário não está vinculado a um profissional. Contate o administrador.');
    return;
  }
  var servicos = collectServicos();
  if (servicos.length === 0) { showToast('Adicione pelo menos um serviço!'); return; }
  var apt = {
    cliente: document.getElementById('ag-cliente').value.trim(),
    telefone: document.getElementById('ag-telefone').value.trim(),
    profissional: servicos[0].profissional,
    servico: servicos[0].servico,
    data: document.getElementById('ag-data').value,
    hora: document.getElementById('ag-hora-h').value + ':' + document.getElementById('ag-minuto').value,
    servicos: servicos
  };
  var corParts = [];
  servicos.forEach(function(s) {
    s.bases.forEach(function(b) { corParts.push(b.cor); });
    s.cores.forEach(function(c) { corParts.push(c); });
  });
  apt.cor = corParts.join(',');
  if (!apt.cliente || !apt.data || !apt.hora) return;
  var ok;
  if (editingAppointmentId) {
    ok = await updateAppointment(editingAppointmentId, apt);
    if (!ok) { showToast('Erro ao atualizar!'); return; }
    showToast('Agendamento atualizado!');
  } else {
    ok = await insertAppointment(apt);
    if (!ok) { showToast('Erro ao salvar!'); return; }
    showToast('Agendamento criado!');
  }
  closeModal('modal-agendamento');
  await loadAppointments();
  renderCalendar();
  renderDayDetail();
}

/* ===== EXCLUSÃO ===== */
function confirmarExclusao() { openModal('modal-confirmar-exclusao'); }

async function excluirAgendamento() {
  if (!editingAppointmentId) return;
  var ok = await deleteAppointment(editingAppointmentId);
  closeModal('modal-confirmar-exclusao');
  closeModal('modal-agendamento');
  if (ok) {
    showToast('Agendamento excluído!');
    await loadAppointments();
    renderCalendar();
    renderDayDetail();
  } else {
    showToast('Erro ao excluir!');
  }
}

/* ===== CLIENTS ===== */
function renderClients() {
  var tbody = document.getElementById('clients-tbody');
  tbody.innerHTML = '';
  var todayStr = pad(today.getDate()) + '/' + pad(today.getMonth() + 1);
  var birthdayNames = [];
  clients.forEach(function(c) {
    var tr = document.createElement('tr');
    tr.onclick = function() { openHistorico(c); };
    var birthFormatted = c.nascimento ? c.nascimento.split('-').reverse().join('/') : '-';
    var isBirthday = false;
    if (c.nascimento) {
      var parts = c.nascimento.split('-');
      isBirthday = (pad(parseInt(parts[2])) + '/' + pad(parseInt(parts[1]))) === todayStr;
      if (isBirthday) birthdayNames.push(c.nome);
    }
    var bIcon = isBirthday ? ' <i class="fa-solid fa-cake-candles birthday-icon"></i>' : '';
    tr.innerHTML = '<td>' + c.nome + bIcon + '</td><td>' + c.telefone + '</td><td>' + birthFormatted + '</td>';
    tbody.appendChild(tr);
  });
  var banner = document.getElementById('birthday-banner');
  if (birthdayNames.length > 0) {
    banner.style.display = 'flex';
    banner.innerHTML = '<i class="fa-solid fa-cake-candles"></i> Aniversariante(s) de hoje: <span class="names">' + birthdayNames.join(', ') + '</span>';
  } else {
    banner.style.display = 'none';
  }
}

async function saveClient(e) {
  e.preventDefault();
  var nome = document.getElementById('cl-nome').value.trim();
  var telefone = document.getElementById('cl-telefone').value.trim();
  var nascimento = document.getElementById('cl-nascimento').value;
  if (!nome || !telefone) return;

  // Verificar duplicidade antes de tentar inserir
  var tenantId = getCurrentTenantId();
  var existente = await buscarClientePorTelefone(telefone, tenantId);
  if (existente) {
    showToast('Cliente já cadastrado com este telefone: ' + existente.nome, 'error');
    closeModal('modal-cliente');
    await loadClients();
    renderClients();
    if (pendingClienteFromIdentificacao) {
      pendingClienteFromIdentificacao = null;
      setTimeout(function() { openAgendamentoModal(null, existente.nome, existente.telefone); }, 500);
    }
    return;
  }

  var result = await insertClient({ nome: nome, telefone: telefone, nascimento: nascimento });
  if (!result) { showToast('Erro ao cadastrar cliente!'); return; }
  showToast('Cliente cadastrado!');
  closeModal('modal-cliente');
  await loadClients();
  renderClients();
  if (pendingClienteFromIdentificacao) {
    pendingClienteFromIdentificacao = null;
    setTimeout(function() { openAgendamentoModal(null, nome, telefone); }, 500);
  }
}

/* ===== HISTÓRICO ===== */
async function openHistorico(cliente) {
  var conteudo = document.getElementById('historico-conteudo');
  conteudo.innerHTML = '<p style="color:var(--text-muted)">Carregando...</p>';
  openModal('modal-historico');
  var birthFormatted = cliente.nascimento ? cliente.nascimento.split('-').reverse().join('/') : '-';
  var tenantId = getCurrentTenantId();

  function normalizeHistoricoStatus(status) {
    return String(status || '').trim().toLowerCase();
  }

  function isHistoricoDesmarcado(item, ativosMap) {
    var statusNorm = normalizeHistoricoStatus(item && item.status);
    if (statusNorm === 'excluido' || statusNorm === 'excluído' || statusNorm === 'cancelado' || statusNorm === 'desmarcado') {
      return true;
    }
    if (item && item.agendamento_id && !ativosMap[item.agendamento_id]) {
      return true;
    }
    return false;
  }

  // ✅ FIX HISTÓRICO: buscar por cliente_id (preferencial) com fallback p/ cliente_nome
  // (registros antigos sem cliente_id ou após renomear). Itens com status='excluido'
  // ('Cliente desmarcado') deixavam de aparecer quando o cliente era renomeado.
  async function fetchHistorico() {
    var results = [];
    var seen = {};
    if (cliente.id) {
      var qById = supabaseClient.from('historico_atendimentos').select('*, historico_servicos(*)').eq('cliente_id', cliente.id);
      if (tenantId) qById = qById.eq('tenant_id', tenantId);
      var rById = await qById;
      (rById.data || []).forEach(function(r) { if (!seen[r.id]) { seen[r.id] = 1; results.push(r); } });
    }
    var qByName = supabaseClient.from('historico_atendimentos').select('*, historico_servicos(*)').eq('cliente_nome', cliente.nome);
    if (tenantId) qByName = qByName.eq('tenant_id', tenantId);
    var rByName = await qByName;
    (rByName.data || []).forEach(function(r) { if (!seen[r.id]) { seen[r.id] = 1; results.push(r); } });
    return results;
  }
  async function fetchAgendamentos() {
    var sel = '*, agendamento_servicos(servico_id, preco, duracao, cor_id, servicos(nome), cores(nome, hex), agendamento_servico_cores(cor_id, tipo, quantidade, cores(nome, hex)))';
    var results = [];
    var seen = {};
    if (cliente.id) {
      var qById = supabaseClient.from('agendamentos').select(sel).eq('cliente_id', cliente.id);
      if (tenantId) qById = qById.eq('tenant_id', tenantId);
      var rById = await qById;
      (rById.data || []).forEach(function(r) { if (!seen[r.id]) { seen[r.id] = 1; results.push(r); } });
    }
    var qByName = supabaseClient.from('agendamentos').select(sel).eq('cliente_nome', cliente.nome);
    if (tenantId) qByName = qByName.eq('tenant_id', tenantId);
    var rByName = await qByName;
    (rByName.data || []).forEach(function(r) { if (!seen[r.id]) { seen[r.id] = 1; results.push(r); } });
    return results;
  }
  var pair = await Promise.all([fetchHistorico(), fetchAgendamentos()]);
  var historico = pair[0];
  var agendamentos = pair[1];
  var agendamentosAtivosMap = {};

  agendamentos.forEach(function(ag) {
    ag._origem = 'agenda';
    agendamentosAtivosMap[ag.id] = true;
  });

  // Normalize agendamentos to have .servicos array like historico
  agendamentos.forEach(function(ag) {
    if (ag.agendamento_servicos && ag.agendamento_servicos.length > 0) {
      var profNomeMap = {};
      allProfissionais.forEach(function(p) { profNomeMap[p.id] = p.nome; });
      ag.profissional = profNomeMap[ag.profissional_id] || '';
      ag.servicos = ag.agendamento_servicos.map(function(as) {
        var bases = [], pigmentacoes = [], coresArr = [];
        if (as.agendamento_servico_cores && as.agendamento_servico_cores.length > 0) {
          as.agendamento_servico_cores.forEach(function(asc) {
            if (asc.cores) {
              if (asc.tipo === 'base') bases.push({ cor: asc.cores.nome, qtd: asc.quantidade || 0, hex: asc.cores.hex });
              else if (asc.tipo === 'pigmento') pigmentacoes.push({ cor: asc.cores.nome, qtd: asc.quantidade || 0, hex: asc.cores.hex });
              else if (asc.tipo === 'cor') coresArr.push(asc.cores.nome);
            }
          });
        }
        if (bases.length === 0 && pigmentacoes.length === 0 && coresArr.length === 0 && as.cores) coresArr.push(as.cores.nome);
        return { profissional: ag.profissional, servico: as.servicos ? as.servicos.nome : '', bases: bases, pigmentacoes: pigmentacoes, cores: coresArr };
      });
    }
  });
  // Normalize historico to have .servicos from historico_servicos
  historico.forEach(function(h) {
    h._origem = 'historico';
    if (h.historico_servicos && h.historico_servicos.length > 0 && !h.servicos) {
      h.servicos = h.historico_servicos.map(function(hs) {
        var bases = [], pigmentacoes = [], coresArr = [];
        if (hs.cores_detalhes) {
          var detalhes = typeof hs.cores_detalhes === 'string' ? JSON.parse(hs.cores_detalhes) : hs.cores_detalhes;
          detalhes.forEach(function(d) {
            if (d.tipo === 'base') bases.push({ cor: d.cor, qtd: d.qtd || 0, hex: d.hex || '#888' });
            else if (d.tipo === 'pigmento') pigmentacoes.push({ cor: d.cor, qtd: d.qtd || 0, hex: d.hex || '#888' });
            else coresArr.push(d.cor);
          });
        } else if (hs.cor_nome) {
          coresArr.push(hs.cor_nome);
        }
        return { profissional: h.profissional_nome || '', servico: hs.servico_nome, bases: bases, pigmentacoes: pigmentacoes, cores: coresArr };
      });
    }
  });

  historico = historico.filter(function(h) {
    if (h.agendamento_id && !agendamentosAtivosMap[h.agendamento_id] && !normalizeHistoricoStatus(h.status)) {
      h.status = 'desmarcado';
    }
    return true;
  });

  var todos = historico.concat(agendamentos);
  // ✅ FIX ORDENAÇÃO: do MENOR para o MAIOR (mais antigo → mais recente), por data + hora.
  todos.sort(function(a, b) {
    var da = (a.data || '') + ' ' + (a.hora || '00:00');
    var db = (b.data || '') + ' ' + (b.hora || '00:00');
    return da.localeCompare(db);
  });

  var html = '<div class="historico-info">';
  html += '<p><strong>' + cliente.nome + '</strong></p>';
  html += '<p><i class="fa-solid fa-phone" style="margin-right:6px"></i>' + cliente.telefone + '</p>';
  html += '<p><i class="fa-solid fa-cake-candles" style="margin-right:6px"></i>' + birthFormatted + '</p>';
  html += '</div>';

  if (todos.length === 0) {
    html += '<p style="color:var(--text-muted)">Nenhum atendimento registrado.</p>';
  } else {
    html += '<ul class="historico-lista">';
    todos.forEach(function(h) {
      var dataF = h.data ? h.data.split('-').reverse().join('/') : '-';
      var svcList = [];
      var svcs = h.servicos ? (typeof h.servicos === 'string' ? JSON.parse(h.servicos) : h.servicos) : null;
      if (svcs && svcs.length > 0) {
        svcs.forEach(function(s) {
          var svcLine = s.servico + ' com ' + s.profissional;
          if (s.bases && s.bases.length > 0) {
            svcLine += ' — Base: ';
            s.bases.forEach(function(b, idx) {
              var hex = b.hex || '#888';
              if (!b.hex) { var opt = colorOptions.find(function(o) { return o.code === b.cor; }); hex = opt ? opt.hex : '#888'; }
              svcLine += '<span class="hist-cor-badge"><span class="hist-cor-swatch" style="background:' + hex + '"></span>' + b.cor;
              if (b.qtd) svcLine += ' (' + b.qtd + 'g)';
              svcLine += '</span>';
              if (idx < s.bases.length - 1) svcLine += ' ';
            });
          }
          if (s.pigmentacoes && s.pigmentacoes.length > 0) {
            svcLine += ' — Pigmentação: ';
            s.pigmentacoes.forEach(function(p, idx) {
              var hex = p.hex || '#888';
              if (!p.hex) { var opt = pigmentOptions.find(function(o) { return o.code === p.cor; }); hex = opt ? opt.hex : '#888'; }
              svcLine += '<span class="hist-cor-badge"><span class="hist-cor-swatch" style="background:' + hex + '"></span>' + p.cor;
              if (p.qtd) svcLine += ' (' + p.qtd + 'g)';
              svcLine += '</span>';
              if (idx < s.pigmentacoes.length - 1) svcLine += ' ';
            });
          }
          if (s.cores && s.cores.length > 0) {
            svcLine += ' — Cores: ';
            s.cores.forEach(function(c, idx) {
              var opt = colorOptions.find(function(o) { return o.code === c; });
              var hex = opt ? opt.hex : '#888';
              svcLine += '<span class="hist-cor-badge"><span class="hist-cor-swatch" style="background:' + hex + '"></span>' + c + '</span>';
              if (idx < s.cores.length - 1) svcLine += ' ';
            });
          }
          svcList.push(svcLine);
        });
      } else {
        var legacyLine = (h.servico || h.servico_nome || 'N/A') + ' com ' + (h.profissional || h.profissional_nome || 'N/A');
        if (h.cor) {
          var cores = h.cor.split(',').filter(function(c) { return c.trim() && c.trim() !== 'Nenhuma'; });
          if (cores.length > 0) {
            legacyLine += ' — Cores: ';
            cores.forEach(function(c) {
              var opt = colorOptions.find(function(o) { return o.code === c.trim(); });
              var hex = opt ? opt.hex : '#888';
              legacyLine += '<span class="hist-cor-badge"><span class="hist-cor-swatch" style="background:' + hex + '"></span>' + c.trim() + '</span> ';
            });
          }
        }
        svcList.push(legacyLine);
      }
      // ✅ FIX BADGE: estilos movidos para estilos.css (.hist-status-badge / .hist-item-desmarcado).
      // Tolerante a variações de status: 'excluido', 'excluído', 'cancelado', 'desmarcado'.
      var isDesmarcado = h._origem === 'historico' && isHistoricoDesmarcado(h, agendamentosAtivosMap);
      var statusBadge = isDesmarcado
        ? '<span class="hist-status-badge hist-status-desmarcado"><i class="fa-solid fa-ban"></i>Cliente desmarcado</span>'
        : '';
      var liClass = isDesmarcado ? ' class="hist-item-desmarcado"' : '';
      html += '<li' + liClass + '><div class="hist-item-top"><span class="hist-data">' + dataF + '</span>' + statusBadge + '</div><div class="hist-item-body">' + svcList.join('<br>') + '</div></li>';
    });
    html += '</ul>';
  }
  conteudo.innerHTML = html;
}

/* ===== PROFESSIONALS PAGE ===== */
function renderProfessionals() {
  var container = document.getElementById('professionals-grid');
  if (!container) return;
  container.innerHTML = '';

  // 🔒 REGRA: só renderiza profissionais visíveis (allProfissionais já vem filtrado
  // por loadProfissionais — exclui aqueles vinculados apenas a usuários inativos).
  // Iteramos sobre allProfissionais (não sobre o dict `professionals`, que pode conter
  // chaves "órfãs" de profissionais já removidos/inativados).
  var visiveis = allProfissionais || [];

  visiveis.forEach(function(p) {
    var name = p.nome;
    var card = document.createElement('div');
    card.className = 'professional-card';
    var svcs = professionals[name] || [];
    var services = svcs.map(function(s) {
      var dur = s.duracao ? s.duracao + 'min' : '';
      var preco = s.preco ? ' R$' + s.preco.toFixed(0) : '';
      return '<li><i class="fa-solid fa-scissors"></i>' + s.nome + (dur ? ' <span class="svc-dur">(' + dur + preco + ')</span>' : '') + '</li>';
    }).join('');
    var editBtn = '';
    if (isAdmin()) {
      editBtn = '<button class="btn-edit-prof" onclick="openModalEditarProfissional(\'' + name.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-pen"></i></button>';
    }
    var avatarHtml = getAvatarHtml(name, '');
    // Badge de vínculo (apenas se houver usuário ATIVO vinculado)
    var linkedUser = (allUsuarios || []).find(function(u) {
      return u.profissional_id === p.id && u.ativo !== false;
    });
    var linkedBadge = linkedUser ? '<span class="linked-badge" title="' + linkedUser.nome + '"><i class="fa-solid fa-link" style="font-size:0.55rem;opacity:0.7;"></i></span>' : '';
    card.innerHTML = '<div class="card-header">' + avatarHtml + '<div class="prof-info"><span class="name">' + name + '</span>' + linkedBadge + '</div>' + editBtn + '</div><ul class="services-list">' + services + '</ul>';
    container.appendChild(card);
  });

  if (visiveis.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 40px;">Nenhum profissional cadastrado.</p>';
  }
}


/* ===== PROFISSIONAIS CRUD ===== */
var novoProfFotoFile = null;
var novoUserProfFotoFile = null;
var editProfFotoFile = null;
var editProfFotoRemoved = false;
var editingProfId = null;

function openModalCriarProfissional() {
  document.getElementById('novo-prof-nome').value = '';
  document.getElementById('novo-prof-avatar-preview').innerHTML = '';
  document.getElementById('novo-prof-avatar-preview').textContent = '?';
  novoProfFotoFile = null;
  var container = document.getElementById('novo-prof-servicos-list');
  container.innerHTML = '';
  allServicos.forEach(function(s) {
    var row = document.createElement('label');
    row.className = 'vincular-servico-item';
    row.innerHTML = '<input type="checkbox" value="' + s.id + '"> ' + s.nome + ' <span class="svc-dur">(R$' + parseFloat(s.preco).toFixed(0) + ' · ' + s.duracao + 'min)</span>';
    container.appendChild(row);
  });
  var feedback = document.getElementById('criar-prof-feedback');
  if (feedback) feedback.style.display = 'none';
  openModal('modal-criar-profissional');
}

function onNovoProfFotoChange(input) {
  if (input.files && input.files[0]) {
    novoProfFotoFile = input.files[0];
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('novo-prof-avatar-preview').innerHTML = '<img src="' + e.target.result + '" alt="Foto">';
    };
    reader.readAsDataURL(input.files[0]);
  }
}


function onNovoUserProfFotoChange(input) {
  if (input.files && input.files[0]) {
    novoUserProfFotoFile = input.files[0];
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('novo-user-prof-foto-preview').innerHTML = '<img src="' + e.target.result + '" alt="Foto">';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function salvarNovoProfissional(e) {
  e.preventDefault();
  var nome = document.getElementById('novo-prof-nome').value.trim();
  var feedback = document.getElementById('criar-prof-feedback');
  if (!nome) { feedback.style.display = 'block'; feedback.style.color = '#e74c3c'; feedback.textContent = 'Nome é obrigatório!'; return; }
  var exists = allProfissionais.find(function(p) { return p.nome.toLowerCase() === nome.toLowerCase(); });
  if (exists) { feedback.style.display = 'block'; feedback.style.color = '#e74c3c'; feedback.textContent = 'Já existe um profissional com este nome!'; return; }
  feedback.style.display = 'block'; feedback.style.color = 'var(--text-muted)'; feedback.textContent = 'Criando profissional...';
  var fotoUrl = '';
  if (novoProfFotoFile) { fotoUrl = await uploadProfFoto(novoProfFotoFile, nome); }
  var tenantId = getCurrentTenantId();
  var resp = await supabaseClient.from('profissionais').insert([{ nome: nome, foto_url: fotoUrl, tenant_id: tenantId }]).select();
  if (resp.error) { feedback.style.color = '#e74c3c'; feedback.textContent = 'Erro: ' + resp.error.message; return; }
  var novoProfId = resp.data[0].id;
  var checkboxes = document.querySelectorAll('#novo-prof-servicos-list input[type="checkbox"]:checked');
  var promises = [];
  checkboxes.forEach(function(cb) { promises.push(vincularServicoProfissional(novoProfId, cb.value)); });
  await Promise.all(promises);
  feedback.style.display = 'none';
  closeModal('modal-criar-profissional');
  showToast('Profissional criado com sucesso!');
  await loadProfissionais();
  await loadProfissionalServicos();
  renderProfessionals();
}

function openModalEditarProfissional(profNome) {
  var prof = allProfissionais.find(function(p) { return p.nome === profNome; });
  if (!prof) return;
  editingProfId = prof.id;
  editProfFotoFile = null;
  editProfFotoRemoved = false;
  document.getElementById('edit-prof-id').value = prof.id;
  document.getElementById('edit-prof-old-nome').value = prof.nome;
  document.getElementById('edit-prof-nome').value = prof.nome;
  var avatarEl = document.getElementById('edit-prof-avatar-preview');
  if (prof.foto_url) { avatarEl.innerHTML = '<img src="' + prof.foto_url + '" alt="' + prof.nome + '">'; }
  else { avatarEl.innerHTML = ''; avatarEl.textContent = prof.nome.charAt(0).toUpperCase(); }
  var container = document.getElementById('vincular-servicos-list');
  container.innerHTML = '';
  var profSvcs = professionals[profNome] || [];
  var profSvcIds = profSvcs.map(function(s) { return s.id; });
  allServicos.forEach(function(s) {
    var checked = profSvcIds.indexOf(s.id) >= 0 ? 'checked' : '';
    var row = document.createElement('label');
    row.className = 'vincular-servico-item';
    row.innerHTML = '<input type="checkbox" value="' + s.id + '" ' + checked + '> ' + s.nome + ' <span class="svc-dur">(R$' + parseFloat(s.preco).toFixed(0) + ' · ' + s.duracao + 'min)</span>';
    container.appendChild(row);
  });
  openModal('modal-vincular-servicos');
}

function onEditProfFotoChange(input) {
  if (input.files && input.files[0]) {
    editProfFotoFile = input.files[0];
    editProfFotoRemoved = false;
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('edit-prof-avatar-preview').innerHTML = '<img src="' + e.target.result + '" alt="Foto">';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function removerEditProfFoto() {
  editProfFotoFile = null;
  editProfFotoRemoved = true;
  var avatarEl = document.getElementById('edit-prof-avatar-preview');
  var nome = document.getElementById('edit-prof-nome').value || '?';
  avatarEl.innerHTML = '';
  avatarEl.textContent = nome.charAt(0).toUpperCase();
}

async function salvarEdicaoProfissional() {
  var id = document.getElementById('edit-prof-id').value;
  var oldNome = document.getElementById('edit-prof-old-nome').value;
  var novoNome = document.getElementById('edit-prof-nome').value.trim();
  if (!novoNome) { showToast('Nome é obrigatório!'); return; }
  var updateData = { nome: novoNome };
  if (editProfFotoFile) { updateData.foto_url = await uploadProfFoto(editProfFotoFile, novoNome); }
  else if (editProfFotoRemoved) { updateData.foto_url = ''; }
  var resp = await supabaseClient.from('profissionais').update(updateData).eq('id', id);
  if (resp.error) { showToast('Erro: ' + resp.error.message); return; }
  if (oldNome !== novoNome) {
    // Agendamentos já usam profissional_id, não precisa atualizar nome
  }
  var checkboxes = document.querySelectorAll('#vincular-servicos-list input[type="checkbox"]');
  var profSvcs = professionals[oldNome] || [];
  var profSvcIds = profSvcs.map(function(s) { return s.id; });
  var promises = [];
  checkboxes.forEach(function(cb) {
    var svcId = cb.value;
    var wasLinked = profSvcIds.indexOf(svcId) >= 0;
    var isLinked = cb.checked;
    if (isLinked && !wasLinked) { promises.push(vincularServicoProfissional(id, svcId)); }
    else if (!isLinked && wasLinked) { promises.push(desvincularServicoProfissional(id, svcId)); }
  });
  await Promise.all(promises);
  closeModal('modal-vincular-servicos');
  showToast('Profissional atualizado!');
  await loadProfissionais();
  await loadProfissionalServicos();
  renderProfessionals();
}

function confirmarExcluirProfissional() { openModal('modal-confirmar-excluir-prof'); }

async function executarExcluirProfissional() {
  var id = document.getElementById('edit-prof-id').value;
  var nome = document.getElementById('edit-prof-old-nome').value;
  await supabaseClient.from('profissional_servicos').delete().eq('profissional_id', id);
  var resp = await supabaseClient.from('profissionais').delete().eq('id', id);
  if (resp.error) { showToast('Erro: ' + resp.error.message); closeModal('modal-confirmar-excluir-prof'); return; }
  closeModal('modal-confirmar-excluir-prof');
  closeModal('modal-vincular-servicos');
  showToast('Profissional excluído!');
  await loadProfissionais();
  await loadProfissionalServicos();
  renderProfessionals();
}

async function uploadProfFoto(file, profNome) {
  var fileExt = file.name.split('.').pop();
  var fileName = profNome.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now() + '.' + fileExt;
  try {
    var resp = await supabaseClient.storage.from('profissionais').upload(fileName, file, { cacheControl: '3600', upsert: true });
    if (resp.error) { console.warn('Storage upload falhou:', resp.error.message); return await fileToDataUrl(file); }
    var urlResp = supabaseClient.storage.from('profissionais').getPublicUrl(fileName);
    return urlResp.data.publicUrl;
  } catch (err) { console.warn('Erro no upload:', err); return await fileToDataUrl(file); }
}

function fileToDataUrl(file) {
  return new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.readAsDataURL(file);
  });
}

/* ===== GERENCIAR SERVIÇOS ===== */
function openModalGerenciarServicos() { renderListaServicos(); openModal('modal-gerenciar-servicos'); }

function renderListaServicos() {
  var container = document.getElementById('lista-servicos-container');
  if (!container) return;
  container.innerHTML = '';
  allServicos.forEach(function(s) {
    var row = document.createElement('div');
    row.className = 'servico-crud-row';
    var temCores = coresPorServico[s.id] && (coresPorServico[s.id].base.length > 0 || coresPorServico[s.id].pigmento.length > 0);
    var coresBtn = '';
    if (isAdmin() && s.usa_cores) {
      var coresCount = temCores ? ' (' + ((coresPorServico[s.id] || {base:[], pigmento:[]}).base.length + (coresPorServico[s.id] || {base:[], pigmento:[]}).pigmento.length) + ')' : '';
      coresBtn = '<button class="btn-icon btn-cores-svc" onclick="openGerenciarCoresServico(\'' + s.id + '\')" title="Gerenciar cores"><i class="fa-solid fa-palette"></i>' + coresCount + '</button>';
    }
    row.innerHTML = '<span class="servico-crud-nome">' + s.nome + '</span><span class="servico-crud-info">R$' + parseFloat(s.preco).toFixed(0) + ' · ' + s.duracao + 'min</span><div class="servico-crud-actions">' + coresBtn + '<button class="btn-icon" onclick="openEditarServico(\'' + s.id + '\')"><i class="fa-solid fa-pen"></i></button><button class="btn-icon btn-danger" onclick="confirmarExcluirServico(\'' + s.id + '\')"><i class="fa-solid fa-trash"></i></button></div>';
    container.appendChild(row);
  });
}

function openCriarServico() {
  document.getElementById('svc-crud-id').value = '';
  document.getElementById('svc-crud-nome').value = '';
  document.getElementById('svc-crud-preco').value = '';
  document.getElementById('svc-crud-duracao').value = '';
  document.getElementById('svc-crud-usa-cores').checked = false;
  document.getElementById('modal-crud-servico-titulo').textContent = 'Novo Serviço';
  openModal('modal-crud-servico');
}

function openEditarServico(id) {
  var svc = allServicos.find(function(s) { return s.id === id; });
  if (!svc) return;
  document.getElementById('svc-crud-id').value = svc.id;
  document.getElementById('svc-crud-nome').value = svc.nome;
  document.getElementById('svc-crud-preco').value = svc.preco;
  document.getElementById('svc-crud-duracao').value = svc.duracao;
  document.getElementById('svc-crud-usa-cores').checked = svc.usa_cores || false;
  document.getElementById('modal-crud-servico-titulo').textContent = 'Editar Serviço';
  openModal('modal-crud-servico');
}

async function salvarServicoCrud(e) {
  e.preventDefault();
  var id = document.getElementById('svc-crud-id').value;
  var nome = document.getElementById('svc-crud-nome').value.trim();
  var preco = parseFloat(document.getElementById('svc-crud-preco').value);
  var duracao = parseInt(document.getElementById('svc-crud-duracao').value);
  var usa_cores = document.getElementById('svc-crud-usa-cores').checked;
  if (!nome || isNaN(preco) || isNaN(duracao)) { showToast('Preencha todos os campos!'); return; }
  if (id) {
    var ok = await editarServico(id, nome, preco, duracao, usa_cores);
    if (!ok) { showToast('Erro ao atualizar!'); return; }
    showToast('Serviço atualizado!');
  } else {
    var result = await criarServico(nome, preco, duracao, usa_cores);
    if (!result) { showToast('Erro ao criar!'); return; }
    showToast('Serviço criado!');
  }
  closeModal('modal-crud-servico');
  await loadServicos();
  await loadProfissionalServicos();
  renderListaServicos();
  renderProfessionals();
}

async function confirmarExcluirServico(id) {
  if (!confirm('Excluir este serviço?')) return;
  var ok = await excluirServico(id);
  if (!ok) { showToast('Erro!'); return; }
  showToast('Serviço removido!');
  await loadServicos();
  await loadProfissionalServicos();
  renderListaServicos();
  renderProfessionals();
}

/* ===== GERENCIAR CORES ===== */
var gerenciarCoresServicoId = null;

function openGerenciarCoresServico(servicoId) {
  gerenciarCoresServicoId = servicoId;
  var svc = allServicos.find(function(s) { return s.id === servicoId; });
  document.getElementById('cores-servico-nome').textContent = svc ? svc.nome : '';
  renderListaCoresServico();
  openModal('modal-gerenciar-cores');
}

function renderListaCoresServico() {
  var container = document.getElementById('cores-servico-container');
  if (!container || !gerenciarCoresServicoId) return;
  container.innerHTML = '';
  var cores = coresPorServico[gerenciarCoresServicoId] || { base: [], pigmento: [] };
  var baseHtml = '<div class="cores-section"><div class="cores-section-header"><h4><i class="fa-solid fa-droplet"></i> Base</h4><button class="btn-add-cor-small" onclick="openCriarCor(\'base\')"><i class="fa-solid fa-plus"></i> Nova base</button></div><div class="cores-list">';
  if (cores.base.length === 0) { baseHtml += '<p class="cores-empty">Nenhuma cor de base.</p>'; }
  else { cores.base.forEach(function(c) { baseHtml += '<div class="cor-crud-row"><div class="cor-crud-swatch" style="background:' + c.hex + '"></div><span class="cor-crud-nome">' + c.nome + '</span><span class="cor-crud-hex">' + c.hex + '</span><div class="cor-crud-actions"><button class="btn-icon" onclick="openEditarCor(\'' + c.id + '\')"><i class="fa-solid fa-pen"></i></button><button class="btn-icon btn-danger" onclick="confirmarExcluirCor(\'' + c.id + '\')"><i class="fa-solid fa-trash"></i></button></div></div>'; }); }
  baseHtml += '</div></div>';
  var pigHtml = '<div class="cores-section"><div class="cores-section-header"><h4><i class="fa-solid fa-palette"></i> Pigmentação</h4><button class="btn-add-cor-small" onclick="openCriarCor(\'pigmento\')"><i class="fa-solid fa-plus"></i> Nova pigmentação</button></div><div class="cores-list">';
  if (cores.pigmento.length === 0) { pigHtml += '<p class="cores-empty">Nenhuma cor de pigmentação.</p>'; }
  else { cores.pigmento.forEach(function(c) { pigHtml += '<div class="cor-crud-row"><div class="cor-crud-swatch" style="background:' + c.hex + '"></div><span class="cor-crud-nome">' + c.nome + '</span><span class="cor-crud-hex">' + c.hex + '</span><div class="cor-crud-actions"><button class="btn-icon" onclick="openEditarCor(\'' + c.id + '\')"><i class="fa-solid fa-pen"></i></button><button class="btn-icon btn-danger" onclick="confirmarExcluirCor(\'' + c.id + '\')"><i class="fa-solid fa-trash"></i></button></div></div>'; }); }
  pigHtml += '</div></div>';
  // Configuração de Quantidades
  var configHtml = '<div class="cores-section qtd-config-section" style="margin-top:16px"><div class="cores-section-header"><h4><i class="fa-solid fa-palette"></i> Quantidades por Cor</h4></div>';
  configHtml += '<p class="qtd-config-desc">Defina como as quantidades serão selecionadas no agendamento para cada tipo de cor deste serviço:</p>';
  var cfgBase = (corConfigPorServico[gerenciarCoresServicoId] || {}).base;
  var cfgPig = (corConfigPorServico[gerenciarCoresServicoId] || {}).pigmento;
  configHtml += '<div class="qtd-config-grid">';
  configHtml += renderCorConfigRow('base', cfgBase);
  configHtml += renderCorConfigRow('pigmento', cfgPig);
  configHtml += '</div>';
  configHtml += '<div class="qtd-config-footer"><div class="qtd-config-footer-left"><i class="fa-solid fa-sparkles"></i><div><div class="footer-title">Configuração de quantidades</div><div class="footer-desc">Salve as configurações de intervalo para aplicá-las no agendamento.</div></div></div><button type="button" class="btn-submit" onclick="salvarCorConfig()"><i class="fa-solid fa-check"></i> Salvar configuração</button></div>';
  configHtml += '</div>';
  container.innerHTML = baseHtml + pigHtml + configHtml;
  initQtdConfigState();
}

/* ===== DIRTY STATE para config de quantidades ===== */
var _qtdConfigInitialState = {};
var _qtdConfigDirty = false;

function _getQtdConfigCurrentState() {
  var state = {};
  ['base', 'pigmento'].forEach(function(tipo) {
    var prefix = 'cfg-' + tipo;
    var minEl = document.getElementById(prefix + '-min');
    var maxEl = document.getElementById(prefix + '-max');
    var stepEl = document.getElementById(prefix + '-step');
    var unidadeEl = document.getElementById(prefix + '-unidade');
    if (minEl && maxEl && stepEl && unidadeEl) {
      state[tipo] = {
        min: minEl.value,
        max: maxEl.value,
        step: stepEl.value,
        unidade: unidadeEl.value
      };
    }
  });
  return JSON.stringify(state);
}

function _checkQtdDirty() {
  var current = _getQtdConfigCurrentState();
  _qtdConfigDirty = (current !== JSON.stringify(_qtdConfigInitialState));
}

function _updateQtdPreview(tipo) {
  var prefix = 'cfg-' + tipo;
  var minEl = document.getElementById(prefix + '-min');
  var maxEl = document.getElementById(prefix + '-max');
  var stepEl = document.getElementById(prefix + '-step');
  var unidadeEl = document.getElementById(prefix + '-unidade');
  if (!minEl || !maxEl || !stepEl || !unidadeEl) return;
  var min = parseInt(minEl.value) || 0;
  var max = parseInt(maxEl.value) || 0;
  var step = parseInt(stepEl.value) || 1;
  var unidade = unidadeEl.value ? unidadeEl.value.trim() : 'g';
  var previewEl = document.getElementById(prefix + '-preview');
  var countEl = document.getElementById(prefix + '-count');
  if (!previewEl) return;
  if (step <= 0 || min > max || min <= 0) {
    previewEl.textContent = 'Parâmetros inválidos';
    if (countEl) countEl.textContent = '';
    return;
  }
  var total = Math.floor((max - min) / step) + 1;
  if (countEl) countEl.textContent = total + ' opções serão geradas';
  // Smart preview: show max 4 first + ... + last
  if (total <= 6) {
    var parts = [];
    for (var v = min; v <= max; v += step) parts.push(v + unidade);
    previewEl.textContent = parts.join(' • ');
  } else {
    var parts = [];
    for (var j = 0; j < 4; j++) parts.push((min + j * step) + unidade);
    parts.push('...');
    parts.push(max + unidade);
    previewEl.textContent = parts.join(' • ');
  }
}

function _onQtdFieldChange(tipo) {
  _checkQtdDirty();
  _updateQtdPreview(tipo);
}

function renderCorConfigRow(tipo, cfg) {
  var tipoLabel = tipo === 'base' ? 'Base' : 'Pigmentação';
  var min = cfg ? (cfg.qtd_min || 5) : (tipo === 'base' ? 5 : 1);
  var max = cfg ? (cfg.qtd_max || 120) : (tipo === 'base' ? 120 : 10);
  var step = cfg ? (cfg.qtd_step || 5) : (tipo === 'base' ? 5 : 1);
  var unidade = cfg ? (cfg.unidade || 'g') : 'g';
  var prefix = 'cfg-' + tipo;
  var icon = tipo === 'base' ? 'fa-droplet' : 'fa-pen-fancy';

  var html = '<div class="qtd-config-card">';
  // Header
  html += '<div class="qtd-config-card-header">';
  html += '<div class="qtd-config-card-header-left">';
  html += '<div class="qtd-config-card-icon"><i class="fa-solid ' + icon + '"></i></div>';
  html += '<div><div class="qtd-config-card-title">' + tipoLabel + '</div>';
  html += '<div class="qtd-config-card-subtitle">Configuração de quantidade</div></div>';
  html += '</div>';
  html += '<div class="qtd-config-toggle"><span>Ativo</span><button type="button" class="toggle-switch active" id="' + prefix + '-toggle" onclick="_toggleQtdCard(\'' + tipo + '\')"></button></div>';
  html += '</div>';
  // Type bar (visual)
  html += '<div class="qtd-config-type-bar">';
  html += '<div class="qtd-config-type-item active"><i class="fa-solid fa-chart-bar"></i> Intervalo</div>';
  
  
  html += '</div>';
  // Fields
  html += '<div class="qtd-config-fields" id="' + prefix + '-fields">';
  html += '<div class="qtd-config-field"><label>Mínimo</label><input type="number" id="' + prefix + '-min" value="' + min + '" oninput="_onQtdFieldChange(\'' + tipo + '\')"></div>';
  html += '<div class="qtd-config-field"><label>Máximo</label><input type="number" id="' + prefix + '-max" value="' + max + '" oninput="_onQtdFieldChange(\'' + tipo + '\')"></div>';
  html += '<div class="qtd-config-field"><label>Step</label><input type="number" id="' + prefix + '-step" value="' + step + '" oninput="_onQtdFieldChange(\'' + tipo + '\')"></div>';
  html += '<div class="qtd-config-field"><label>Unidade</label><select id="' + prefix + '-unidade" onchange="_onQtdFieldChange(\'' + tipo + '\')"><option value="g"' + (unidade === 'g' ? ' selected' : '') + '>g</option><option value="ml"' + (unidade === 'ml' ? ' selected' : '') + '>ml</option><option value="un"' + (unidade === 'un' ? ' selected' : '') + '>un</option></select></div>';
  html += '</div>';
  // Preview
  html += '<div class="qtd-preview-section" id="' + prefix + '-preview-section">';
  html += '<div class="qtd-preview-top"><span class="qtd-preview-badge"><i class="fa-solid fa-eye"></i> Prévia</span><span class="qtd-preview-count" id="' + prefix + '-count"></span></div>';
  html += '<div class="qtd-preview-box"><div class="qtd-preview-text" id="' + prefix + '-preview"></div></div>';
  html += '</div>';
  html += '</div>';
  return html;
}



function _toggleQtdCard(tipo) {
  var prefix = 'cfg-' + tipo;
  var btn = document.getElementById(prefix + '-toggle');
  var fields = document.getElementById(prefix + '-fields');
  var preview = document.getElementById(prefix + '-preview-section');
  if (!btn) return;
  var isActive = btn.classList.contains('active');
  if (isActive) {
    btn.classList.remove('active');
    if (fields) fields.classList.add('qtd-config-fields-disabled');
    if (preview) preview.style.opacity = '0.4';
  } else {
    btn.classList.add('active');
    if (fields) fields.classList.remove('qtd-config-fields-disabled');
    if (preview) preview.style.opacity = '1';
  }
  _checkQtdDirty();
}

function initQtdConfigState() {
  setTimeout(function() {
    _updateQtdPreview('base');
    _updateQtdPreview('pigmento');
    _qtdConfigInitialState = JSON.parse(_getQtdConfigCurrentState());
    _qtdConfigDirty = false;
  }, 50);
}

async function salvarCorConfig() {
  var tenantId = getCurrentTenantId();
  var servicoId = gerenciarCoresServicoId;

  for (var i = 0; i < 2; i++) {
    var tipo = i === 0 ? 'base' : 'pigmento';
    var prefix = 'cfg-' + tipo;
    var unidade = document.getElementById(prefix + '-unidade').value.trim() || 'g';
    var payload = {
      servico_id: servicoId,
      tipo: tipo,
      tipo_quantidade: 'intervalo',
      unidade: unidade,
      tenant_id: tenantId,
      updated_at: new Date().toISOString(),
      qtd_min: parseInt(document.getElementById(prefix + '-min').value) || 5,
      qtd_max: parseInt(document.getElementById(prefix + '-max').value) || 120,
      qtd_step: parseInt(document.getElementById(prefix + '-step').value) || 5,
      qtd_lista: []
    };
    var existing = (corConfigPorServico[servicoId] || {})[tipo];
    if (existing && existing.id) {
      var resp = await supabaseClient.from('servico_cor_config').update(payload).eq('id', existing.id);
      if (resp.error) { showToast('Erro ao salvar: ' + resp.error.message); return; }
    } else {
      payload.created_at = new Date().toISOString();
      var resp = await supabaseClient.from('servico_cor_config').insert([payload]);
      if (resp.error) { showToast('Erro ao salvar: ' + resp.error.message); return; }
    }
  }
  await loadCorConfig();
  _qtdConfigInitialState = JSON.parse(_getQtdConfigCurrentState());
  _qtdConfigDirty = false;
  showToast('Configuração salva!');
  renderListaCoresServico();
}

function tentarFecharModalCores() {
  _checkQtdDirty();
  if (_qtdConfigDirty) {
    openModal('modal-confirmar-descarte-qtd');
  } else {
    closeModal('modal-gerenciar-cores');
  }
}

function descartarAlteracoesQtd() {
  _qtdConfigDirty = false;
  closeModal('modal-confirmar-descarte-qtd');
  closeModal('modal-gerenciar-cores');
}

function continuarEditandoQtd() {
  closeModal('modal-confirmar-descarte-qtd');
}

var editingCorTipo = 'base';

function openCriarCor(tipo) {
  editingCorTipo = tipo;
  document.getElementById('cor-crud-id').value = '';
  document.getElementById('cor-crud-nome').value = '';
  document.getElementById('cor-crud-hex').value = '#888888';
  document.getElementById('cor-crud-picker').value = '#888888';
  document.getElementById('cor-crud-preview').style.background = '#888888';
  document.getElementById('modal-crud-cor-titulo').textContent = 'Nova Cor (' + (tipo === 'base' ? 'Base' : 'Pigmentação') + ')';
  openModal('modal-crud-cor');
}

function openEditarCor(corId) {
  var cor = null; var tipo = '';
  Object.keys(coresPorServico).forEach(function(sid) {
    coresPorServico[sid].base.forEach(function(c) { if (c.id === corId) { cor = c; tipo = 'base'; } });
    coresPorServico[sid].pigmento.forEach(function(c) { if (c.id === corId) { cor = c; tipo = 'pigmento'; } });
  });
  if (!cor) return;
  editingCorTipo = tipo;
  document.getElementById('cor-crud-id').value = cor.id;
  document.getElementById('cor-crud-nome').value = cor.nome;
  document.getElementById('cor-crud-hex').value = cor.hex;
  document.getElementById('cor-crud-picker').value = cor.hex;
  document.getElementById('cor-crud-preview').style.background = cor.hex;
  document.getElementById('modal-crud-cor-titulo').textContent = 'Editar Cor';
  openModal('modal-crud-cor');
}

function onCorPickerChange(picker) {
  document.getElementById('cor-crud-hex').value = picker.value;
  document.getElementById('cor-crud-preview').style.background = picker.value;
}
function onCorHexInput(input) {
  var hex = input.value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    document.getElementById('cor-crud-picker').value = hex;
    document.getElementById('cor-crud-preview').style.background = hex;
  }
}

async function salvarCorCrud(e) {
  e.preventDefault();
  var id = document.getElementById('cor-crud-id').value;
  var nome = document.getElementById('cor-crud-nome').value.trim();
  var hex = document.getElementById('cor-crud-hex').value.trim();
  if (!nome) { showToast('Nome obrigatório!'); return; }
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) { showToast('HEX inválido!'); return; }
  if (id) {
    var ok = await editarCor(id, nome, hex);
    if (!ok) { showToast('Erro!'); return; }
    showToast('Cor atualizada!');
  } else {
    var result = await criarCor(nome, hex, editingCorTipo, gerenciarCoresServicoId);
    if (!result) { showToast('Erro!'); return; }
    showToast('Cor criada!');
  }
  closeModal('modal-crud-cor');
  await loadCores();
  await loadCorConfig();
  renderListaCoresServico();
  renderListaServicos();
}

async function confirmarExcluirCor(corId) {
  if (!confirm('Excluir esta cor?')) return;
  var resultado = await excluirCor(corId);
  if (!resultado.ok) {
    var err = resultado.error || {};
    var code = err.code || '';
    var msg = String(err.message || '').toLowerCase();
    // 23503 = foreign_key_violation no Postgres; 409 Conflict no PostgREST
    var ehVinculo = code === '23503'
      || msg.indexOf('foreign key') !== -1
      || msg.indexOf('violates foreign key') !== -1
      || msg.indexOf('still referenced') !== -1
      || msg.indexOf('conflict') !== -1;
    if (ehVinculo) {
      showToast('Esta cor está sendo usada em agendamentos e não pode ser excluída.');
    } else {
      showToast('Não foi possível excluir a cor. Tente novamente.');
    }
    return;
  }
  showToast('Cor removida!');
  await loadCores();
  renderListaCoresServico();
  renderListaServicos();
}

function shouldCountHistoricoInDashboard(status) {
  var normalized = String(status || '').trim().toLowerCase();
  // Só histórico de atendimento efetivamente concluído entra no dashboard.
  // Exclusões/cancelamentos não são faturamento real e não devem contaminar as métricas.
  return normalized === 'concluido' || normalized === 'concluído' || normalized === 'finalizado' || normalized === 'atendido';
}

function getCalendarVisibleDateRange() {
  var start = new Date(currentYear, currentMonth, 1);
  var end = new Date(currentYear, currentMonth + 1, 0);
  return {
    start: formatDateInput(start),
    end: formatDateInput(end)
  };
}

function getCalendarVisibleAppointments(selectedProfId) {
  var range = getCalendarVisibleDateRange();
  var profNomeToId = {};
  (allProfissionais || []).forEach(function(p) { profNomeToId[p.nome] = p.id; });

  return (appointments || []).filter(function(a) {
    if (!a || !a.data) return false;
    if (a.data < range.start || a.data > range.end) return false;

    // Regra principal: o dashboard só enxerga o que a agenda enxerga.
    if (!appointmentMatchesFilter(a)) return false;

    // Refino opcional do select do dashboard.
    if (selectedProfId && selectedProfId !== '__all__') {
      var profs = getAppointmentProfessionals(a);
      return profs.some(function(nome) { return profNomeToId[nome] === selectedProfId; });
    }

    return true;
  });
}

/* ===== DASHBOARD ===== */
function initDashboard() {
  var range = getCalendarVisibleDateRange();
  document.getElementById('dash-inicio').value = range.start;
  document.getElementById('dash-fim').value = range.end;

  // Popula select de profissionais respeitando o role.
  // O dashboard espelha a agenda: o select apenas refina o que já está visível nela.
  populateDashProfSelect();

  loadDashboard();
}

function populateDashProfSelect() {
  var select = document.getElementById('dash-prof-select');
  if (!select) return;

  var isColab = currentUser.role === 'colaborador';
  var profs = (allProfissionais || []).slice();

  // Colaborador: só o profissional vinculado, select travado
  if (isColab) {
    select.innerHTML = '';
    var prof = profs.find(function(p) { return p.id === currentUser.profissionalId; });
    if (prof) {
      var opt = document.createElement('option');
      opt.value = prof.id;
      opt.textContent = prof.nome;
      select.appendChild(opt);
      select.value = prof.id;
    }
    select.disabled = true;
    select.title = 'Você só pode visualizar dados do seu profissional vinculado.';
  } else {
    // Admin / master_admin: lista completa + opção "Todos"
    select.disabled = false;
    select.title = '';
    select.innerHTML = '<option value="__all__">Todos os profissionais</option>';
    profs.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nome;
      select.appendChild(opt);
    });
    select.value = '__all__';
  }

  // Liga o change uma única vez para recarregar automaticamente
  if (!select.dataset.bound) {
    select.addEventListener('change', function() { loadDashboard(); });
    select.dataset.bound = '1';
  }
}

async function loadDashboard() {
  // IMPORTANTE: os campos de data passam a refletir o mês visível da agenda.
  // Mesmo que o usuário altere manualmente, o dashboard é recalculado com base
  // no calendário para garantir consistência absoluta entre as duas telas.
  var range = getCalendarVisibleDateRange();
  var inicio = range.start;
  var fim = range.end;
  var dashInicio = document.getElementById('dash-inicio');
  var dashFim = document.getElementById('dash-fim');
  if (dashInicio) dashInicio.value = inicio;
  if (dashFim) dashFim.value = fim;

  var selectEl = document.getElementById('dash-prof-select');
  var selectedProfId = selectEl ? selectEl.value : '__all__';

  if (currentUser.role === 'colaborador') {
    if (!currentUser.profissionalId) {
      showToast('Usuário sem profissional vinculado. Acesso ao dashboard bloqueado.', 'error');
      return;
    }
    selectedProfId = currentUser.profissionalId;
  }

  var profIdToNome = {};
  var profNomeToId = {};
  (allProfissionais || []).forEach(function(p) {
    profIdToNome[p.id] = p.nome;
    profNomeToId[p.nome] = p.id;
  });

  var appointmentsInRange = getCalendarVisibleAppointments(selectedProfId);

  var totalAg = 0;
  var totalFaturamento = 0;
  var totalServicos = 0;
  var profData = {};
  var servicoCount = {};
  var clienteCount = {};
  var profHoraFat = {};

  if (selectedProfId === '__all__') {
    (activeFilters || []).forEach(function(nome) { profHoraFat[nome] = {}; });
  } else {
    var nomeFiltrado = profIdToNome[selectedProfId] || '';
    if (nomeFiltrado) profHoraFat[nomeFiltrado] = {};
  }

  appointmentsInRange.forEach(function(a) {
    totalAg++;
    var hora = (a.hora || '').substring(0, 2);
    var clienteNomeDash = a.cliente || a.cliente_nome || '';
    clienteCount[clienteNomeDash] = (clienteCount[clienteNomeDash] || 0) + 1;

    var servicos = getAppointmentServicos(a);
    var profsDoAgendamento = getAppointmentProfessionals(a);
    var profPrincipal = profsDoAgendamento[0] || a.profissional || '';

    if (!profData[profPrincipal]) profData[profPrincipal] = { atendimentos: 0, servicos: 0, faturamento: 0 };
    profData[profPrincipal].atendimentos++;

    if (!servicos || servicos.length === 0) return;

    servicos.forEach(function(s) {
      var profNome = s.profissional || profPrincipal || '';
      var svcProfId = profNomeToId[profNome] || null;

      if (selectedProfId && selectedProfId !== '__all__' && svcProfId !== selectedProfId) {
        return;
      }

      var svcNome = s.servico || '';
      var preco = parseFloat(s.preco) || 0;

      if (!profData[profNome]) profData[profNome] = { atendimentos: 0, servicos: 0, faturamento: 0 };
      totalFaturamento += preco;
      totalServicos++;
      profData[profNome].servicos++;
      profData[profNome].faturamento += preco;

      if (profHoraFat[profNome]) {
        if (!profHoraFat[profNome][hora]) profHoraFat[profNome][hora] = 0;
        profHoraFat[profNome][hora] += preco;
      }

      if (svcNome) {
        if (!servicoCount[svcNome]) servicoCount[svcNome] = { qtd: 0, valor: 0 };
        servicoCount[svcNome].qtd++;
        servicoCount[svcNome].valor += preco;
      }
    });
  });

  var ticketMedio = totalAg > 0 ? totalFaturamento / totalAg : 0;
  document.getElementById('dash-total-ag').textContent = totalAg;
  document.getElementById('dash-ticket').textContent = formatCurrency(ticketMedio);
  document.getElementById('dash-total-servicos').textContent = totalServicos;
  document.getElementById('dash-faturamento').textContent = formatCurrency(totalFaturamento);

  renderLineChart(profHoraFat);

  var profTbody = document.getElementById('dash-prof-tbody');
  profTbody.innerHTML = '';
  Object.keys(profData).forEach(function(name) {
    if (!name) return;
    var d = profData[name];
    if ((d.atendimentos || 0) === 0 && (d.servicos || 0) === 0 && (d.faturamento || 0) === 0) return;
    profTbody.innerHTML += '<tr><td>' + name + '</td><td>' + d.atendimentos + '</td><td>' + d.servicos + '</td><td>' + formatCurrency(d.faturamento) + '</td></tr>';
  });

  var svcArr = Object.keys(servicoCount).map(function(k) { return { nome: k, qtd: servicoCount[k].qtd, valor: servicoCount[k].valor }; });
  svcArr.sort(function(a, b) { return b.qtd - a.qtd; });
  var topSvc = document.getElementById('dash-top-servicos');
  topSvc.innerHTML = '';
  if (svcArr.length === 0) {
    topSvc.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:16px;">Sem dados no mês visível da agenda</td></tr>';
  } else {
    svcArr.slice(0, 10).forEach(function(s) { topSvc.innerHTML += '<tr><td>' + s.nome + '</td><td>' + s.qtd + '</td><td>' + formatCurrency(s.valor) + '</td></tr>'; });
  }

  var topCli = document.getElementById('dash-top-clientes');
  if (topCli) {
    topCli.innerHTML = '';
    var cliArr = Object.keys(clienteCount)
      .filter(function(nome) { return nome && nome.trim() !== ''; })
      .map(function(nome) { return { nome: nome, qtd: clienteCount[nome] }; });
    cliArr.sort(function(a, b) { return b.qtd - a.qtd; });
    if (cliArr.length === 0) {
      topCli.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);padding:16px;">Sem dados no mês visível da agenda</td></tr>';
    } else {
      cliArr.slice(0, 10).forEach(function(c) {
        topCli.innerHTML += '<tr><td>' + c.nome + '</td><td>' + c.qtd + '</td></tr>';
      });
    }
  }
}

function renderLineChart(profHoraFat) {
  var chartDiv = document.getElementById('dash-chart-horarios');
  if (!chartDiv) return;
  var allHours = [];
  Object.keys(profHoraFat).forEach(function(prof) {
    Object.keys(profHoraFat[prof]).forEach(function(h) {
      if (allHours.indexOf(h) === -1) allHours.push(h);
    });
  });
  allHours.sort();
  if (allHours.length === 0) { chartDiv.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0;">Sem dados</p>'; return; }
  var maxVal = 0;
  Object.keys(profHoraFat).forEach(function(prof) { allHours.forEach(function(h) { var v = profHoraFat[prof][h] || 0; if (v > maxVal) maxVal = v; }); });
  if (maxVal === 0) maxVal = 100;
  var width = 800, height = 280, padLeft = 80, padRight = 20, padTop = 20, padBottom = 40;
  var chartW = width - padLeft - padRight, chartH = height - padTop - padBottom;
  var legendHtml = '<div class="dash-chart-legend">';
  Object.keys(professionals).forEach(function(name) { legendHtml += '<div class="dash-legend-item"><div class="dash-legend-dot" style="background:' + (profColors[name] || '#888') + '"></div>' + name + '</div>'; });
  legendHtml += '</div>';
  var svg = '<svg class="dash-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet">';
  for (var yi = 0; yi <= 5; yi++) {
    var yVal = (maxVal / 5) * yi;
    var yPos = padTop + chartH - (yi / 5) * chartH;
    svg += '<line x1="' + padLeft + '" y1="' + yPos + '" x2="' + (width - padRight) + '" y2="' + yPos + '" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>';
    svg += '<text x="' + (padLeft - 8) + '" y="' + (yPos + 4) + '" text-anchor="end" fill="#888" font-size="11" font-family="Inter, sans-serif">' + formatCurrencyShort(yVal) + '</text>';
  }
  allHours.forEach(function(h, i) {
    var x = padLeft + (i / (allHours.length - 1 || 1)) * chartW;
    svg += '<text x="' + x + '" y="' + (height - 8) + '" text-anchor="middle" fill="#888" font-size="11" font-family="Inter, sans-serif">' + h + 'H</text>';
  });
  Object.keys(professionals).forEach(function(name) {
    var color = profColors[name] || '#888';
    var points = [];
    allHours.forEach(function(h, i) {
      var val = profHoraFat[name][h] || 0;
      var x = padLeft + (i / (allHours.length - 1 || 1)) * chartW;
      var y = padTop + chartH - (val / maxVal) * chartH;
      points.push({ x: x, y: y, val: val });
    });
    if (points.length > 1) {
      var pathD = 'M' + points[0].x + ',' + points[0].y;
      for (var pi = 1; pi < points.length; pi++) {
        var prev = points[pi - 1], curr = points[pi];
        var cpx = (prev.x + curr.x) / 2;
        pathD += ' C' + cpx + ',' + prev.y + ' ' + cpx + ',' + curr.y + ' ' + curr.x + ',' + curr.y;
      }
      svg += '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round"/>';
    }
    points.forEach(function(p) { if (p.val > 0) svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="5" fill="' + color + '" stroke="#141414" stroke-width="2"/>'; });
  });
  svg += '</svg>';
  chartDiv.innerHTML = legendHtml + '<div class="dash-chart-canvas">' + svg + '</div>';
}

function formatCurrency(val) { return 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatCurrencyShort(val) {
  if (val >= 1000) return 'R$ ' + (val / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + 'k';
  return 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* ===== MODAL ===== */
function openModal(id) { document.getElementById(id).classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('active'); var anyOpen = document.querySelector('.modal-overlay.active'); if (!anyOpen) document.body.style.overflow = ''; }

/* ===== TOAST (top-center, verde sucesso / vermelho erro) ===== */
(function ensureToastStyles() {
  if (document.getElementById('bs-toast-styles')) return;
  var style = document.createElement('style');
  style.id = 'bs-toast-styles';
  style.textContent = ''
    + '.toast{position:fixed !important;top:24px !important;left:50% !important;transform:translateX(-50%) translateY(-20px) !important;'
    + 'background:#16A34A !important;background-color:#16A34A !important;color:#fff !important;padding:12px 20px !important;border-radius:10px !important;font-size:0.9rem !important;'
    + 'font-weight:500 !important;box-shadow:0 10px 30px rgba(0,0,0,0.25) !important;display:flex !important;align-items:center !important;'
    + 'gap:10px !important;z-index:99999 !important;opacity:0 !important;transition:opacity .25s ease, transform .25s ease !important;'
    + 'max-width:calc(100vw - 32px) !important;font-family:inherit !important;border:none !important;outline:none !important;'
    + 'background-image:none !important;}'
    + '.toast.show{opacity:1 !important;transform:translateX(-50%) translateY(0) !important;}'
    + '.toast.toast-success{background:#16A34A !important;background-color:#16A34A !important;color:#fff !important;}'
    + '.toast.toast-error{background:#DC2626 !important;background-color:#DC2626 !important;color:#fff !important;}'
    + '.toast.toast-warning{background:#E67E22 !important;background-color:#E67E22 !important;color:#fff !important;}'
    + '.toast.toast-info{background:#3B82F6 !important;background-color:#3B82F6 !important;color:#fff !important;}'
    + '.toast i,.toast span{color:#fff !important;fill:#fff !important;}'
    + '.toast i{font-size:1.05rem !important;}';
  (document.head || document.documentElement).appendChild(style);
})();

function showToast(msg, type) {
  type = type || 'success';
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();

  var colors = {
    success: { bg: '#16a34a', icon: 'fa-circle-check' },
    error:   { bg: '#dc2626', icon: 'fa-circle-xmark' },
    warning: { bg: '#d97706', icon: 'fa-triangle-exclamation' },
    info:    { bg: '#2563eb', icon: 'fa-circle-info' }
  };
  var conf = colors[type] || colors.success;

  var div = document.createElement('div');
  div.className = 'toast toast-' + type;
  // Estilos inline para garantir aparência correta mesmo com CSS legado em cache
  div.style.cssText = [
    'position:fixed',
    'top:24px',
    'left:50%',
    'transform:translateX(-50%) translateY(-20px)',
    'background:' + conf.bg,
    'color:#ffffff',
    'border:none',
    'border-radius:10px',
    'padding:14px 22px',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'font-size:0.95rem',
    'font-weight:500',
    'z-index:99999',
    'opacity:0',
    'pointer-events:none',
    'transition:opacity 0.25s ease, transform 0.25s ease',
    'box-shadow:0 10px 30px rgba(0,0,0,0.18)',
    'max-width:calc(100vw - 32px)'
  ].join(';') + ';';

  div.innerHTML = '<i class="fa-solid ' + conf.icon + '" style="color:#ffffff;font-size:1.2rem;"></i>' +
                  '<span style="color:#ffffff;">' + msg + '</span>';

  document.body.appendChild(div);
  requestAnimationFrame(function() {
    div.style.opacity = '1';
    div.style.transform = 'translateX(-50%) translateY(0)';
    div.style.pointerEvents = 'auto';
    div.classList.add('show');
  });
  setTimeout(function() {
    div.style.opacity = '0';
    div.style.transform = 'translateX(-50%) translateY(-20px)';
    div.classList.remove('show');
    setTimeout(function() { div.remove(); }, 300);
  }, 3000);
}

/* ===== UTILS ===== */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function formatDateInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

/* ===== CONFIGURAÇÕES ===== */
var allUsuarios = [];
var currentAuthUser = null;
var currentUsuarioDb = null;

async function initConfiguracoes() {
  var sessionResp = await supabaseClient.auth.getSession();
  if (sessionResp.data.session) { currentAuthUser = sessionResp.data.session.user; }
  await loadCurrentUsuario();
  renderMeuPerfil();

  var tabUsuarios = document.querySelector('.config-tab[data-config-tab="usuarios"]');
  if (tabUsuarios) { tabUsuarios.style.display = isAdmin() ? '' : 'none'; }

  document.querySelectorAll('.master-only-tab').forEach(function(el) {
    el.style.display = isMasterAdmin() ? '' : 'none';
  });
  document.querySelectorAll('.master-only-panel').forEach(function(el) {
    el.style.display = isMasterAdmin() ? '' : 'none';
  });

  if (isAdmin()) { await loadUsuarios(); renderUsuarios(); }
}

async function loadCurrentUsuario() {
  if (!currentAuthUser) return;
  var resp = await supabaseClient.from('usuarios').select('*').eq('id', currentAuthUser.id).maybeSingle();
  if (resp.data) { currentUsuarioDb = resp.data; }
}

async function loadUsuarios() {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('usuarios').select('*').order('created_at');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro usuarios:', resp.error); return; }
  allUsuarios = resp.data || [];

  // Enriquecer com roles do banco
  for (var i = 0; i < allUsuarios.length; i++) {
    var roleResp = await supabaseClient.from('user_roles').select('role, tenant_id').eq('user_id', allUsuarios[i].id);
    allUsuarios[i].role = resolveUserRoleRows(roleResp.data || [], tenantId);
  }
}

function renderMeuPerfil() {
  if (currentUsuarioDb) {
    document.getElementById('perfil-nome').value = currentUsuarioDb.nome || '';
    document.getElementById('perfil-email').value = currentUsuarioDb.email || '';
  } else if (currentAuthUser) {
    document.getElementById('perfil-email').value = currentAuthUser.email || '';
  }
}

/* ===== Filtros de Usuários (Configurações) ===== */
/* Estado de inativo agora vem do banco: usuarios.ativo (boolean). */
function isUsuarioInactiveMock(user) {
  if (!user) return false;
  return user.ativo === false;
}


function getUsuariosFilterState() {
  var searchEl = document.getElementById('users-filter-search-input');
  var permEl   = document.getElementById('users-filter-permissao-select');
  var inactEl  = document.getElementById('users-filter-show-inactive');
  return {
    search: searchEl ? searchEl.value.trim().toLowerCase() : '',
    permissao: permEl ? permEl.value : 'todos',
    showInactive: inactEl ? !!inactEl.checked : false
  };
}

function onUsuariosFilterChange() {
  renderUsuarios();
}

function renderUsuarios() {
  var tbody = document.getElementById('usuarios-tbody');
  var cardsContainer = document.getElementById('usuarios-cards');
  var badgeAtivos = document.getElementById('users-count-ativos');
  var badgeInativos = document.getElementById('users-count-inativos');
  if (!tbody || !cardsContainer) return;

  tbody.innerHTML = '';
  cardsContainer.innerHTML = '';

  // 1) Anota inativo em cada usuário (mock)
  var enriched = (allUsuarios || []).map(function(u) {
    return Object.assign({}, u, { _inactive: isUsuarioInactiveMock(u) });
  });

  // 2) Contagem GERAL (não filtrada)
  var totalAtivos = 0, totalInativos = 0;
  enriched.forEach(function(u) {
    if (u._inactive) totalInativos++; else totalAtivos++;
  });
  if (badgeAtivos)   badgeAtivos.textContent   = totalAtivos + ' ativos';
  if (badgeInativos) badgeInativos.textContent = totalInativos + ' inativos';

  // 3) Aplica filtros: busca → permissão → flag inativos
  var f = getUsuariosFilterState();
  var filtered = enriched
    .filter(function(u) {
      if (!f.search) return true;
      var nome  = (u.nome  || '').toLowerCase();
      var email = (u.email || '').toLowerCase();
      return nome.indexOf(f.search) !== -1 || email.indexOf(f.search) !== -1;
    })
    .filter(function(u) {
      if (f.permissao === 'todos') return true;
      return u.role === f.permissao;
    })
    .filter(function(u) {
      if (f.showInactive) return true;
      return !u._inactive;
    });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="users-empty-row"><td colspan="4">Nenhum usuário encontrado.</td></tr>';
    cardsContainer.innerHTML = '<div class="user-card" style="text-align:center;color:var(--text-muted);font-style:italic;">Nenhum usuário encontrado.</div>';
    return;
  }

  filtered.forEach(function(u) {
    var roleBadge = '<span class="role-badge ' + u.role + '">' + u.role + '</span>';
    var profBadge = u.profissional_id
      ? ' <span class="role-badge" style="background:rgba(72,187,120,0.15);color:#48bb78;font-size:0.7rem;padding:2px 6px;"><i class=\'fa-solid fa-link\' style=\'font-size:0.6rem;\'></i></span>'
      : '';
    var inactiveTag = u._inactive ? ' <span class="user-inactive-tag">Inativo</span>' : '';

    var toggleLabel = u._inactive ? 'Ativar usuário' : 'Inativar usuário';
    var toggleActiveClass = u._inactive ? '' : ' is-active';
    var toggleHtml =
      '<button type="button" class="user-toggle-switch' + toggleActiveClass + '" ' +
        'title="' + toggleLabel + '" aria-label="' + toggleLabel + '" ' +
        'onclick="toggleUsuarioAtivo(\x27' + u.id + '\x27)">' +
        '<span class="track"></span><span class="thumb"></span>' +
      '</button>';
    var actions =
      '<div class="servico-crud-actions">' +
        '<button class="btn-icon" title="Editar" onclick="openEditarUsuario(\x27' + u.id + '\x27)"><i class="fa-solid fa-pen"></i></button>' +
        toggleHtml +
      '</div>';

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (u.nome || '') + inactiveTag + '</td>' +
      '<td>' + (u.email || '') + '</td>' +
      '<td>' + roleBadge + profBadge + '</td>' +
      '<td>' + actions + '</td>';
    tbody.appendChild(tr);

    var card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML =
      '<div class="user-card-header">' +
        '<span class="user-card-name">' + (u.nome || '') + inactiveTag + '</span>' +
        roleBadge + profBadge +
      '</div>' +
      '<div class="user-card-email">' + (u.email || '') + '</div>' +
      '<div class="user-card-footer">' + actions + '</div>';
    cardsContainer.appendChild(card);
  });
}

/* Toggle inativar/ativar — persistência real no Supabase (usuarios.ativo) */
var _pendingToggleUserId = null;
var _pendingToggleAction = null; // 'ativar' | 'inativar'
var MAX_USUARIOS_ATIVOS = 3;

function toggleUsuarioAtivo(userId) {
  var user = (allUsuarios || []).find(function(u) { return u.id === userId; });
  if (!user) return;
  _pendingToggleUserId = userId;
  var isInactive = user.ativo === false;
  _pendingToggleAction = isInactive ? 'ativar' : 'inativar';
  var modalId = isInactive ? 'modal-confirmar-ativar-usuario' : 'modal-confirmar-inativar-usuario';
  if (typeof openModal === 'function') {
    openModal(modalId);
  } else {
    var el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  }
}

async function confirmToggleUsuarioAtivo() {
  var userId = _pendingToggleUserId;
  var action = _pendingToggleAction;
  if (!userId || !action) return;
  var user = (allUsuarios || []).find(function(u) { return u.id === userId; });

  // Helper para fechar QUALQUER modal de confirmação aberto (ativar/inativar)
  function fecharModaisConfirmacao() {
    try { if (typeof closeModal === 'function') closeModal('modal-confirmar-ativar-usuario'); } catch (_) {}
    try { if (typeof closeModal === 'function') closeModal('modal-confirmar-inativar-usuario'); } catch (_) {}
  }

  if (!user) {
    fecharModaisConfirmacao();
    _pendingToggleUserId = null;
    _pendingToggleAction = null;
    return;
  }

  // 🔒 Limite: no máximo 3 usuários ativos por tenant
  if (action === 'ativar') {
    var usuariosAtivos = (allUsuarios || []).filter(function(u) { return u.ativo !== false; }).length;
    if (usuariosAtivos >= MAX_USUARIOS_ATIVOS) {
      // Fecha o modal ANTES de mostrar o toast (UX consistente)
      fecharModaisConfirmacao();
      _pendingToggleUserId = null;
      _pendingToggleAction = null;
      if (typeof showToast === 'function') {
        showToast('Limite de usuários ativos atingido (' + MAX_USUARIOS_ATIVOS + '). Inative um usuário antes de ativar outro.', 'error');
      }
      return;
    }
  }

  var novoAtivo = (action === 'ativar');
  var resp = await supabaseClient.from('usuarios').update({ ativo: novoAtivo }).eq('id', userId);
  if (resp.error) {
    console.error('Erro ao atualizar usuarios.ativo:', resp.error);
    fecharModaisConfirmacao();
    _pendingToggleUserId = null;
    _pendingToggleAction = null;
    if (typeof showToast === 'function') showToast('Erro ao atualizar usuário. Tente novamente.', 'error');
    return;
  }

  // Atualiza estado local sem precisar recarregar tudo
  user.ativo = novoAtivo;

  // 1) Fecha o modal de confirmação IMEDIATAMENTE
  fecharModaisConfirmacao();

  // 2) Toast verde com mensagem padronizada
  if (typeof showToast === 'function') {
    showToast(novoAtivo ? 'Usuário ativado com sucesso!' : 'Usuário inativado com sucesso!', 'success');
  }

  _pendingToggleUserId = null;
  _pendingToggleAction = null;
  renderUsuarios();

  // 🔄 Reatividade: profissionais visíveis dependem de usuarios.ativo (background)
  try {
    await loadProfissionais();
    if (typeof renderProfessionals === 'function') renderProfessionals();
    if (typeof renderAgenda === 'function') renderAgenda();
  } catch (e) {
    console.warn('Falha ao recarregar profissionais após toggle:', e);
  }
}

// Aliases de compatibilidade (versões antigas com sufixo Mock)
var toggleUsuarioAtivoMock = toggleUsuarioAtivo;
var confirmToggleUsuarioAtivoMock = confirmToggleUsuarioAtivo;


async function salvarPerfil() {
  var nome = document.getElementById('perfil-nome').value.trim();
  if (!nome) { showToast('Nome obrigatório!'); return; }
  if (!currentUsuarioDb) { showToast('Erro: usuário não encontrado.'); return; }
  var resp = await supabaseClient.from('usuarios').update({ nome: nome }).eq('id', currentUsuarioDb.id);
  if (resp.error) { showToast('Erro ao salvar!'); return; }
  currentUsuarioDb.nome = nome;
  currentUser.nome = nome;
  var userAvatarHtml = getAvatarHtml(nome, 'avatar--sidebar');
  document.getElementById('user-info').innerHTML = userAvatarHtml + '<div class="user-details"><span class="user-name">' + nome + '</span><span class="user-role">' + currentUser.role + '</span></div>';
  showToast('Perfil atualizado!');
}

async function salvarNovaSenha(e) {
  e.preventDefault();
  var senhaAtual = document.getElementById('senha-atual').value;
  var senhaNova = document.getElementById('senha-nova').value;
  var senhaConfirmar = document.getElementById('senha-confirmar').value;
  var feedback = document.getElementById('senha-feedback');
  if (senhaNova.length < 6) { feedback.style.display = 'block'; feedback.style.color = '#e74c3c'; feedback.textContent = 'Mínimo 6 caracteres.'; return; }
  if (senhaNova !== senhaConfirmar) { feedback.style.display = 'block'; feedback.style.color = '#e74c3c'; feedback.textContent = 'Senhas não coincidem.'; return; }
  feedback.style.display = 'block'; feedback.style.color = 'var(--text-muted)'; feedback.textContent = 'Verificando...';
  var email = currentAuthUser ? currentAuthUser.email : '';
  var loginResp = await supabaseClient.auth.signInWithPassword({ email: email, password: senhaAtual });
  if (loginResp.error) { feedback.style.color = '#e74c3c'; feedback.textContent = 'Senha atual incorreta.'; return; }
  var updateResp = await supabaseClient.auth.updateUser({ password: senhaNova });
  if (updateResp.error) { feedback.style.color = '#e74c3c'; feedback.textContent = 'Erro: ' + updateResp.error.message; return; }
  feedback.style.display = 'none';
  closeModal('modal-alterar-senha');
  document.getElementById('senha-atual').value = '';
  document.getElementById('senha-nova').value = '';
  document.getElementById('senha-confirmar').value = '';
  showToast('Senha alterada!');
}


// ===== VÍNCULO USUÁRIO ↔ PROFISSIONAL =====
function selectProfVinculo(cardEl, tipo, context) {
  // context = 'novo' or 'edit'
  var prefix = context === 'novo' ? 'novo-user' : 'edit-user';
  var container = context === 'novo' ? 'novo-user-prof-options' : 'edit-user-prof-options';

  // Update radio
  var radio = cardEl.querySelector('input[type="radio"]');
  radio.checked = true;

  // Update card visuals
  document.querySelectorAll('#' + container + ' .prof-vinculo-card').forEach(function(c) {
    c.classList.remove('selected');
  });
  cardEl.classList.add('selected');

  // Toggle sub-panels
  var selectWrapper = document.getElementById(prefix + '-prof-select-wrapper');
  selectWrapper.classList.toggle('visible', tipo === 'existente');

  if (context === 'novo') {
    var preview = document.getElementById('novo-user-prof-criar-preview');
    preview.classList.toggle('visible', tipo === 'criar');
    // Show/hide foto upload for "criar automático"
    var fotoUpload = document.getElementById('novo-user-prof-foto-upload');
    if (fotoUpload) {
      fotoUpload.classList.toggle('visible', tipo === 'criar');
      if (tipo !== 'criar') {
        // Reset foto when switching away
        novoUserProfFotoFile = null;
        var fotoPreview = document.getElementById('novo-user-prof-foto-preview');
        if (fotoPreview) fotoPreview.innerHTML = '<i class="fa-solid fa-camera"></i>';
        var fotoInput = document.getElementById('novo-user-prof-foto-input');
        if (fotoInput) fotoInput.value = '';
      }
    }
    if (tipo === 'criar') {
      var nome = document.getElementById('novo-user-nome').value.trim() || '(digite o nome acima)';
      document.getElementById('novo-user-prof-criar-nome').textContent = nome;
    }
  }
}

// Update preview name as user types
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'novo-user-nome') {
    var tipo = document.querySelector('input[name="novo-user-prof-tipo"]:checked');
    if (tipo && tipo.value === 'criar') {
      document.getElementById('novo-user-prof-criar-nome').textContent = e.target.value.trim() || '(digite o nome acima)';
    }
  }
});

function populateProfSelect(selectId, excludeUserId) {
  var select = document.getElementById(selectId);
  select.innerHTML = '<option value="">-- Selecione um profissional --</option>';
  var vinculados = {};
  allUsuarios.forEach(function(u) {
    if (u.profissional_id && u.id !== excludeUserId) vinculados[u.profissional_id] = true;
  });
  allProfissionais.forEach(function(p) {
    if (!vinculados[p.id]) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nome;
      select.appendChild(opt);
    }
  });
}

function openModalCriarUsuario() {
  document.getElementById('novo-user-nome').value = '';
  document.getElementById('novo-user-email').value = '';
  document.getElementById('novo-user-role').value = 'colaborador';
  // Reset cards
  document.querySelectorAll('#novo-user-prof-options .prof-vinculo-card').forEach(function(c, i) {
    c.classList.toggle('selected', i === 0);
    c.querySelector('input[type="radio"]').checked = (i === 0);
  });
  document.getElementById('novo-user-prof-select-wrapper').classList.remove('visible');
  document.getElementById('novo-user-prof-criar-preview').classList.remove('visible');
  // Reset foto upload
  novoUserProfFotoFile = null;
  var fotoUploadEl = document.getElementById('novo-user-prof-foto-upload');
  if (fotoUploadEl) fotoUploadEl.classList.remove('visible');
  var fotoPreviewEl = document.getElementById('novo-user-prof-foto-preview');
  if (fotoPreviewEl) fotoPreviewEl.innerHTML = '<i class="fa-solid fa-camera"></i>';
  var fotoInputEl = document.getElementById('novo-user-prof-foto-input');
  if (fotoInputEl) fotoInputEl.value = '';
  populateProfSelect('novo-user-profissional-id', null);
  var feedback = document.getElementById('criar-user-feedback');
  feedback.style.display = 'none';
  // Aplica regra inicial baseada na role default (colaborador)
  aplicarRegraVinculoPorRole('novo');
  openModal('modal-criar-usuario');
}

/* ===== REGRA: Colaborador → vínculo automático (oculto e forçado) ===== */
function aplicarRegraVinculoPorRole(context) {
  var prefix = context === 'novo' ? 'novo-user' : 'edit-user';
  var roleEl = document.getElementById(prefix + '-role');
  if (!roleEl) return;
  var role = roleEl.value;
  var grid = document.getElementById(prefix + '-prof-options');
  var section = grid ? grid.closest('.config-form-section, div') : null;
  // Localiza a seção visualmente (parent que contém o título "Vínculo com Profissional")
  var wrapper = grid ? grid.parentElement : null;

  if (role === 'colaborador') {
    // Oculta o grid de seleção
    if (grid) grid.style.display = 'none';
    // Oculta sub-painel "Vincular existente"
    var sub = document.getElementById(prefix + '-prof-select-wrapper');
    if (sub) sub.classList.remove('visible');
    // No modal "novo": mostra preview + permite foto opcional
    if (context === 'novo') {
      // Marca radio "criar" mesmo oculto
      var radioCriar = document.querySelector('input[name="novo-user-prof-tipo"][value="criar"]');
      if (radioCriar) radioCriar.checked = true;
      var preview = document.getElementById('novo-user-prof-criar-preview');
      if (preview) preview.classList.add('visible');
      var fotoUp = document.getElementById('novo-user-prof-foto-upload');
      if (fotoUp) fotoUp.classList.add('visible');
      var nomeAtual = (document.getElementById('novo-user-nome').value || '').trim() || '(digite o nome acima)';
      var nomeEl = document.getElementById('novo-user-prof-criar-nome');
      if (nomeEl) nomeEl.textContent = nomeAtual;
    }
    // Mostra aviso explicativo (cria/atualiza)
    if (wrapper) {
      var aviso = wrapper.querySelector('.colab-auto-aviso');
      if (!aviso) {
        aviso = document.createElement('div');
        aviso.className = 'colab-auto-aviso';
        aviso.style.cssText = 'background:var(--gold-bg,rgba(108,58,237,0.08));border:1px solid var(--gold-border,rgba(108,58,237,0.20));border-radius:8px;padding:10px 12px;font-size:0.82rem;color:var(--text);margin-top:8px;display:flex;align-items:center;gap:8px;';
        aviso.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--gold);"></i><span>Será criado um <strong>profissional automaticamente</strong> com o nome do usuário.</span>';
        // Insere antes do grid
        if (grid && grid.parentNode) grid.parentNode.insertBefore(aviso, grid);
      }
      aviso.style.display = 'flex';
    }
  } else {
    // Admin: comportamento normal
    if (grid) grid.style.display = '';
    var aviso2 = wrapper ? wrapper.querySelector('.colab-auto-aviso') : null;
    if (aviso2) aviso2.style.display = 'none';
    // No edit: garante que select existente reapareça se aplicável
  }
}

/* Listener: troca de role no modal "novo" */
document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'novo-user-role') aplicarRegraVinculoPorRole('novo');
  if (e.target && e.target.id === 'edit-user-role') aplicarRegraVinculoPorRole('edit');
});

var _criarUsuarioEmAndamento = false;
var _signupCooldownAte = 0;
var _signupCooldownTimer = null;

async function salvarNovoUsuario(e) {
  e.preventDefault();

  var form = document.querySelector('#modal-criar-usuario form');
  var btnSubmit = form ? form.querySelector('button[type="submit"]') : null;
  var feedback = document.getElementById('criar-user-feedback');
  var emailInput = document.getElementById('novo-user-email');

  var nome = (document.getElementById('novo-user-nome').value || '').trim();
  var email = (((emailInput ? emailInput.value : '') || '').trim()).toLowerCase();
  var roleEl = document.getElementById('novo-user-role');
  var role = roleEl ? (roleEl.value || '').trim() : '';
  // Guarda dura: só aceita roles válidos. Sem fallback silencioso para 'admin'.
  if (role !== 'admin' && role !== 'colaborador') {
    role = 'colaborador';
  }
  console.log('[criarUsuario] role selecionada no formulário =', role);
  var profTipoEl = document.querySelector('input[name="novo-user-prof-tipo"]:checked');
  var profTipo = profTipoEl ? profTipoEl.value : 'nenhum';
  var profIdSel = document.getElementById('novo-user-profissional-id').value || '';
  var tenantId = getCurrentTenantId();

  // 🔒 REGRA: Colaborador SEMPRE cria profissional automaticamente
  if (role === 'colaborador') {
    profTipo = 'criar';
    profIdSel = '';
    console.log('[criarUsuario] role=colaborador → forçando profTipo=criar');
  }

  // --- Helpers internos ---
  function setFeedback(message, color) {
    if (!feedback) return;
    feedback.style.display = 'block';
    feedback.style.color = color;
    feedback.textContent = message;
  }

  function clearFeedback() {
    if (!feedback) return;
    feedback.style.display = 'none';
    feedback.textContent = '';
  }

  function lockButton(label) {
    if (!btnSubmit) return;
    if (!btnSubmit.dataset.originalText) btnSubmit.dataset.originalText = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = label || 'Salvando...';
  }

  function resetButton() {
    if (!btnSubmit) return;
    btnSubmit.disabled = false;
    btnSubmit.textContent = btnSubmit.dataset.originalText || 'Salvar';
  }

  function aplicarCooldown(segundos) {
    var total = parseInt(segundos, 10);
    if (!total || total < 1) total = 60;
    _signupCooldownAte = Date.now() + (total * 1000);
    if (_signupCooldownTimer) { clearInterval(_signupCooldownTimer); _signupCooldownTimer = null; }

    function renderCooldown() {
      var restante = Math.max(0, Math.ceil((_signupCooldownAte - Date.now()) / 1000));
      if (restante <= 0) {
        _signupCooldownAte = 0;
        if (_signupCooldownTimer) { clearInterval(_signupCooldownTimer); _signupCooldownTimer = null; }
        resetButton();
        return;
      }
      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Aguarde (' + restante + 's)'; }
    }

    renderCooldown();
    _signupCooldownTimer = setInterval(renderCooldown, 1000);
  }

  async function parseJsonSafe(response) {
    try { return await response.json(); } catch (_) { return null; }
  }

  // --- Validações ---
  if (_criarUsuarioEmAndamento) {
    setFeedback('Aguarde, já existe uma criação em andamento.', '#e67e22');
    return;
  }

  if (_signupCooldownAte > Date.now()) {
    var restante = Math.ceil((_signupCooldownAte - Date.now()) / 1000);
    setFeedback('Servidor temporariamente limitado. Aguarde ' + restante + 's para tentar novamente.', '#e67e22');
    lockButton('Aguarde (' + restante + 's)');
    return;
  }

  if (!nome || !email) { setFeedback('Preencha todos os campos.', '#e74c3c'); return; }
  if (!tenantId) { setFeedback('Tenant não identificado. Recarregue a página.', '#e74c3c'); return; }

  // Validação de email via browser + regex
  if (emailInput && !emailInput.checkValidity()) { setFeedback('E-mail inválido. Verifique o formato.', '#e74c3c'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setFeedback('E-mail inválido. Verifique o formato.', '#e74c3c'); return; }

  if (profTipo === 'existente' && !profIdSel) { setFeedback('Selecione um profissional existente.', '#e74c3c'); return; }

  _criarUsuarioEmAndamento = true;
  lockButton('Validando...');
  setFeedback('Validando dados...', 'var(--text-muted)');

  try {
    // Checar duplicado no cache local primeiro (sem gastar request)
    var usuarioEmCache = Array.isArray(allUsuarios)
      ? allUsuarios.find(function(u) { return (u.email || '').trim().toLowerCase() === email; })
      : null;

    if (usuarioEmCache) { setFeedback('Já existe um usuário com esse e-mail.', '#e74c3c'); return; }

    // Se cache vazio, checar via banco (query leve, NÃO usa Auth)
    if (!Array.isArray(allUsuarios) || allUsuarios.length === 0) {
      setFeedback('Verificando e-mail...', 'var(--text-muted)');
      var usuarioResp = await supabaseClient.from('usuarios').select('id').eq('email', email).maybeSingle();
      if (usuarioResp.error) { throw new Error('Não foi possível validar o e-mail agora.'); }
      if (usuarioResp.data) { setFeedback('Já existe um usuário com esse e-mail.', '#e74c3c'); return; }
    }

    // Upload de foto (se opção "criar" selecionada)
    var fotoUrl = null;
    if (profTipo === 'criar' && novoUserProfFotoFile) {
      lockButton('Enviando foto...');
      setFeedback('Enviando foto do profissional...', 'var(--text-muted)');
      fotoUrl = await uploadProfFoto(novoUserProfFotoFile, nome);
    }

    // Obter sessão do admin logado
    var sessionResp = await supabaseClient.auth.getSession();
    var session = sessionResp && sessionResp.data ? sessionResp.data.session : null;
    if (!session || !session.access_token) { throw new Error('Sua sessão expirou. Faça login novamente.'); }

    lockButton('Criando usuário...');
    setFeedback('Criando acesso e vínculo...', 'var(--text-muted)');

    // *** CHAMADA ÚNICA à Edge Function (usa Admin API no backend, sem rate limit público) ***
    var response = await fetch(SUPABASE_URL + '/functions/v1/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        nome: nome,
        email: email,
        role: role,
        tenant_id: tenantId,
        profissional: {
          tipo: profTipo,
          id: profTipo === 'existente' ? profIdSel : null,
          foto_url: fotoUrl
        }
      })
    });

    var payload = await parseJsonSafe(response);

    if (response.status === 409) {
      setFeedback((payload && payload.message) || 'Já existe um usuário com esse e-mail.', '#e74c3c');
      return;
    }

    if (response.status === 429) {
      var retryAfter = parseInt(response.headers.get('Retry-After') || (payload && payload.retry_after) || '60', 10);
      setFeedback((payload && payload.message) || 'Muitas tentativas. Aguarde um pouco.', '#e67e22');
      aplicarCooldown(retryAfter);
      return;
    }

    if (response.status === 401 || response.status === 403) {
      setFeedback((payload && payload.message) || 'Sem permissão para criar usuários.', '#e74c3c');
      return;
    }

    if (!response.ok) {
      console.error('[admin-create-user] HTTP', response.status, 'payload=', payload);
      throw new Error((payload && (payload.message || payload.error)) || ('Erro ao criar usuário. HTTP ' + response.status));
    }

    // ===== SUCESSO =====
    // 1) Limpa feedback inline (esconde DOM + zera texto) e fecha modal IMEDIATAMENTE
    try { clearFeedback(); } catch (_) {}
    try {
      var fb = document.getElementById('criar-user-feedback');
      if (fb) { fb.style.display = 'none'; fb.textContent = ''; fb.innerHTML = ''; }
    } catch (_) {}
    try { closeModal('modal-criar-usuario'); } catch (_) {}

    // 2) Toast verde no topo (padrão do select-tenant.html)
    showToast('Usuário criado com sucesso! Convite enviado para ' + email, 'success');

    // 3) Guard anti-fallback de role (em background, não bloqueia o toast)
    try {
      var newUserId = payload && (payload.user_id || payload.id || (payload.user && payload.user.id));
      if (newUserId && tenantId) {
        var checkRole = await supabaseClient
          .from('user_roles')
          .select('role')
          .eq('user_id', newUserId)
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (!checkRole.error && checkRole.data && checkRole.data.role !== role) {
          console.warn('[criarUsuario] Role divergente detectada. Banco=', checkRole.data.role, 'Esperado=', role, '. Corrigindo...');
          await supabaseClient.from('user_roles').delete().eq('user_id', newUserId).eq('tenant_id', tenantId);
          await supabaseClient.from('user_roles').insert([{
            user_id: newUserId,
            role: role,
            tenant_id: tenantId
          }]);
        }
      }
    } catch (guardErr) {
      console.warn('[criarUsuario] Falha ao validar role pós-criação:', guardErr);
    }

    // 4) Recarrega listas (sem afetar o toast já exibido)
    try {
      await loadUsuarios();
      renderUsuarios();
      if (profTipo === 'criar') { await loadProfissionais(); renderProfessionals(); }
    } catch (reloadErr) {
      console.warn('[criarUsuario] Falha ao recarregar listas:', reloadErr);
    }

  } catch (err) {
    var msg = err && err.message ? err.message : 'Erro inesperado ao criar usuário.';
    console.error('[criarUsuario] erro final:', err);
    setFeedback(msg, '#e74c3c');
  } finally {
    _criarUsuarioEmAndamento = false;
    if (!_signupCooldownAte || _signupCooldownAte <= Date.now()) { resetButton(); }
  }
}

function openEditarUsuario(id) {
  var user = allUsuarios.find(function(u) { return u.id === id; });
  if (!user) return;
  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-nome').value = user.nome;
  document.getElementById('edit-user-role').value = user.role;

  // Preencher vínculo profissional
  var hasProf = !!user.profissional_id;
  var cards = document.querySelectorAll('#edit-user-prof-options .prof-vinculo-card');
  cards.forEach(function(c) {
    var radio = c.querySelector('input[type="radio"]');
    var isMatch = hasProf ? radio.value === 'existente' : radio.value === 'nenhum';
    radio.checked = isMatch;
    c.classList.toggle('selected', isMatch);
  });
  document.getElementById('edit-user-prof-select-wrapper').classList.toggle('visible', hasProf);
  populateProfSelect('edit-user-profissional-id', user.id);
  if (hasProf) {
    document.getElementById('edit-user-profissional-id').value = user.profissional_id;
  }

  aplicarRegraVinculoPorRole('edit');
  openModal('modal-editar-usuario');
}

async function salvarEdicaoUsuario(e) {
  e.preventDefault();
  var id = document.getElementById('edit-user-id').value;
  var nome = document.getElementById('edit-user-nome').value.trim();
  var role = document.getElementById('edit-user-role').value;
  if (!nome) { showToast('Nome obrigatório!'); return; }

  var resp = await supabaseClient.from('usuarios').update({ nome: nome }).eq('id', id);
  if (resp.error) { showToast('Erro!'); return; }

  // Atualizar vínculo profissional
  var profTipo = document.querySelector('input[name="edit-user-prof-tipo"]:checked').value;
  var profIdSel = profTipo === 'existente' ? document.getElementById('edit-user-profissional-id').value : null;

  // 🔒 REGRA: Colaborador SEMPRE precisa de profissional vinculado.
  // Se já tem, mantém; se não tem, cria automaticamente (idempotente).
  if (role === 'colaborador') {
    var userAtual = allUsuarios.find(function(u) { return u.id === id; });
    if (userAtual && userAtual.profissional_id) {
      profIdSel = userAtual.profissional_id; // mantém vínculo existente
    } else {
      var tenantIdEdit = getCurrentTenantId();
      var novoProfResp = await supabaseClient.from('profissionais')
        .insert([{ nome: nome, foto_url: '', tenant_id: tenantIdEdit }])
        .select('id').single();
      if (novoProfResp.error || !novoProfResp.data) {
        showToast('Erro ao criar profissional!');
        return;
      }
      profIdSel = novoProfResp.data.id;
      console.log('[edit] Colaborador sem profissional → criado automaticamente:', profIdSel);
    }
  }

  await supabaseClient.from('usuarios').update({ profissional_id: profIdSel || null }).eq('id', id);

  // Atualizar role em user_roles sem acumular duplicatas por tenant
  var tenantId = getCurrentTenantId();
  await supabaseClient.from('user_roles').delete().eq('user_id', id).eq('tenant_id', tenantId);
  await supabaseClient.from('user_roles').insert([{
    user_id: id,
    role: role,
    tenant_id: tenantId
  }]);

  closeModal('modal-editar-usuario');
  showToast('Usuário atualizado!');
  await loadUsuarios();
  renderUsuarios();
}


/* ==========================================================
   PACOTES DE SERVIÇOS — Cadastro, venda e uso no agendamento
   Fixes: sugestão de venda, preview reativo, ações sem box
   ========================================================== */
var pacoteCrudEditId = null;
var pacoteServicosCache = [];

function pacoteMoney(v) {
  var n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function pacoteNumber(v) {
  var n = parseFloat(String(v || '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function pacoteTodayISO() {
  return new Date().toISOString().slice(0, 10);
}
function pacoteAddDaysISO(dateISO, days) {
  var d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
function pacoteFormatDate(iso) {
  if (!iso) return '-';
  var p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}
function pacoteEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function pacoteGetServicoById(id) {
  return (allServicos || []).find(function(s) { return String(s.id) === String(id); }) || null;
}
function pacoteGetServicoByNome(nome) {
  return (allServicos || []).find(function(s) { return String(s.nome) === String(nome); }) || null;
}
function pacoteGetClienteAtualId() {
  var nome = (document.getElementById('ag-cliente') || {}).value || '';
  var tel = (document.getElementById('ag-telefone') || {}).value || '';
  var telDigits = tel.replace(/\D/g, '');
  var cliente = (clients || []).find(function(c) {
    return c.nome === nome && String(c.telefone || '').replace(/\D/g, '') === telDigits;
  }) || (clients || []).find(function(c) { return c.nome === nome; });
  return cliente ? cliente.id : null;
}

async function buscarPacotesDisponiveis(clienteId, servicoId) {
  var tenantId = getCurrentTenantId();
  if (!clienteId || !servicoId) return [];
  var query = supabaseClient
    .from('cliente_pacotes')
    .select('*, pacotes!inner(id, nome, servico_id, ativo)')
    .eq('cliente_id', clienteId)
    .eq('status', 'ativo')
    .gt('quantidade_restante', 0)
    .gte('data_expiracao', pacoteTodayISO())
    .eq('pacotes.servico_id', servicoId)
    .eq('pacotes.ativo', true)
    .order('data_expiracao', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) {
    console.warn('Erro ao buscar pacotes disponíveis:', resp.error);
    return [];
  }
  return resp.data || [];
}

async function buscarPacoteAtivoParaVenda(servicoId) {
  var tenantId = getCurrentTenantId();
  if (!servicoId) return null;
  var query = supabaseClient
    .from('pacotes')
    .select('*, servicos(id, nome, preco)')
    .eq('servico_id', servicoId)
    .eq('ativo', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) {
    console.warn('Erro ao buscar pacote para venda:', resp.error);
    return null;
  }
  return (resp.data || [])[0] || null;
}

function pacoteDesmarcarOutrasOpcoes(input) {
  var box = input.closest('.pacote-sugestao');
  if (!box) return;
  box.querySelectorAll('input[type="checkbox"]').forEach(function(el) {
    if (el !== input) el.checked = false;
  });
}

async function renderPacoteSugestao(block) {
  if (!block) return;
  var svcSelect = block.querySelector('.svc-servico');
  var extras = block.querySelector('.svc-extras');
  if (!extras || !svcSelect) return;

  var container = block.querySelector('.pacote-sugestao');
  if (!container) {
    container = document.createElement('div');
    container.className = 'pacote-sugestao';
    extras.appendChild(container);
  }

  var svcObj = pacoteGetServicoByNome(svcSelect.value);
  var clienteId = pacoteGetClienteAtualId();
  if (!svcObj || !clienteId) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = '<div class="pacote-loading"><i class="fa-solid fa-spinner fa-spin"></i> Verificando pacotes...</div>';

  var results = await Promise.all([
    buscarPacotesDisponiveis(clienteId, svcObj.id),
    buscarPacoteAtivoParaVenda(svcObj.id)
  ]);
  var disponiveis = results[0] || [];
  var venda = results[1] || null;

  var html = '';
  if (disponiveis.length > 0) {
    html += '<div class="pacote-grupo"><div class="pacote-grupo-titulo">Pacotes disponíveis</div>';
    disponiveis.forEach(function(cp) {
      html += '<label class="pacote-opcao pacote-existente">' +
        '<input type="checkbox" class="pacote-checkbox" data-pacote-acao="usar" data-cliente-pacote-id="' + pacoteEscapeHtml(cp.id) + '" onchange="pacoteDesmarcarOutrasOpcoes(this)">' +
        '<span><strong>Usar pacote</strong> ' + pacoteEscapeHtml((cp.pacotes && cp.pacotes.nome) || 'Pacote') +
        ' <small>(' + cp.quantidade_restante + ' restantes | ' + pacoteMoney(cp.preco_unitario) + ' por uso | expira em ' + pacoteFormatDate(cp.data_expiracao) + ')</small></span>' +
        '</label>';
    });
    html += '</div>';
  }

  if (venda) {
    html += '<div class="pacote-grupo"><div class="pacote-grupo-titulo">Sugestão de venda</div>' +
      '<label class="pacote-opcao pacote-oferta">' +
      '<input type="checkbox" class="pacote-checkbox" data-pacote-acao="vender" data-pacote-def-id="' + pacoteEscapeHtml(venda.id) + '" onchange="pacoteDesmarcarOutrasOpcoes(this)">' +
      '<span><strong>Vender pacote</strong> ' + pacoteEscapeHtml(venda.nome) +
      ' <small>(' + venda.quantidade_total + ' usos | ' + pacoteMoney(venda.preco_total) + ' total | ' + pacoteMoney(venda.preco_unitario_final) + ' por uso)</small></span>' +
      '</label></div>';
  }

  if (!html) {
    container.innerHTML = '';
    container.style.display = 'none';
  } else {
    container.innerHTML = html;
  }
}

var pacoteOriginalOnSvcServicoChange = typeof onSvcServicoChange === 'function' ? onSvcServicoChange : null;
onSvcServicoChange = async function(selectEl) {
  if (pacoteOriginalOnSvcServicoChange) pacoteOriginalOnSvcServicoChange(selectEl);
  var block = selectEl.closest('.servico-block');
  if (block) await renderPacoteSugestao(block);
};

var pacoteOriginalAdicionarBlocoServicoComDados = typeof adicionarBlocoServicoComDados === 'function' ? adicionarBlocoServicoComDados : null;
adicionarBlocoServicoComDados = function(dados) {
  if (pacoteOriginalAdicionarBlocoServicoComDados) pacoteOriginalAdicionarBlocoServicoComDados(dados);
  var blocks = document.querySelectorAll('.servico-block');
  var block = blocks[blocks.length - 1];
  if (block) renderPacoteSugestao(block);
};
adicionarBlocoServico = function() { adicionarBlocoServicoComDados(null); };

function collectServicosComPacotes() {
  var blocks = document.querySelectorAll('.servico-block');
  var servicos = [];
  blocks.forEach(function(block) {
    var prof = block.querySelector('.svc-profissional').value;
    if (currentUser.role === 'colaborador' && currentUser.profissionalNome) prof = currentUser.profissionalNome;
    var servico = block.querySelector('.svc-servico').value;
    if (!prof || !servico) return;
    var svc = { profissional: prof, servico: servico, bases: [], pigmentacoes: [], cores: [], pacote: null };
    block.querySelectorAll('.base-item').forEach(function(bi) {
      if (bi.dataset.cor) svc.bases.push({ cor: bi.dataset.cor, qtd: parseInt(bi.dataset.qtd) || 0 });
    });
    block.querySelectorAll('.pig-item').forEach(function(pi) {
      if (pi.dataset.cor) svc.pigmentacoes.push({ cor: pi.dataset.cor, qtd: parseInt(pi.dataset.qtd) || 0 });
    });
    block.querySelectorAll('.cores-container .cor-select-wrapper').forEach(function(cw) {
      if (cw.dataset.cor && cw.dataset.cor !== 'Nenhuma') svc.cores.push(cw.dataset.cor);
    });
    var pacoteInput = block.querySelector('.pacote-sugestao input[type="checkbox"]:checked');
    if (pacoteInput) {
      svc.pacote = {
        acao: pacoteInput.dataset.pacoteAcao,
        clientePacoteId: pacoteInput.dataset.clientePacoteId || null,
        pacoteDefId: pacoteInput.dataset.pacoteDefId || null
      };
    }
    servicos.push(svc);
  });
  return servicos;
}
collectServicos = collectServicosComPacotes;

async function consumirPacoteExistente(clientePacoteId) {
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('cliente_pacotes').select('*').eq('id', clientePacoteId).maybeSingle();
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error || !resp.data) throw new Error('Pacote do cliente não encontrado.');
  var cp = resp.data;
  if (cp.status !== 'ativo' || Number(cp.quantidade_restante) <= 0 || cp.data_expiracao < pacoteTodayISO()) {
    throw new Error('Pacote expirado ou sem saldo.');
  }
  var restante = Number(cp.quantidade_restante) - 1;
  var novoStatus = restante <= 0 ? 'concluido' : 'ativo';
  var upd = await supabaseClient.from('cliente_pacotes')
    .update({ quantidade_restante: restante, status: novoStatus })
    .eq('id', clientePacoteId)
    .gt('quantidade_restante', 0)
    .select()
    .maybeSingle();
  if (upd.error || !upd.data) throw new Error('Não foi possível consumir o pacote. Tente novamente.');
  return { id: cp.id, preco_unitario: Number(cp.preco_unitario || 0) };
}

async function criarClientePacoteParaAgendamento(pacoteDefId, clienteId, dataAgendamento) {
  var tenantId = getCurrentTenantId();
  var defQuery = supabaseClient.from('pacotes').select('*').eq('id', pacoteDefId).eq('ativo', true).maybeSingle();
  if (tenantId) defQuery = defQuery.eq('tenant_id', tenantId);
  var defResp = await defQuery;
  if (defResp.error || !defResp.data) throw new Error('Pacote ativo não encontrado para venda.');
  var p = defResp.data;
  var inicio = dataAgendamento || pacoteTodayISO();
  var expiracao = pacoteAddDaysISO(inicio, p.validade_dias || 0);
  var restante = Math.max(Number(p.quantidade_total || 0) - 1, 0);
  var row = {
    tenant_id: tenantId,
    cliente_id: clienteId,
    pacote_id: p.id,
    quantidade_total: p.quantidade_total,
    quantidade_restante: restante,
    preco_unitario: p.preco_unitario_final,
    preco_total: p.preco_total,
    data_inicio: inicio,
    data_expiracao: expiracao,
    status: restante <= 0 ? 'concluido' : 'ativo'
  };
  var ins = await supabaseClient.from('cliente_pacotes').insert([row]).select().single();
  if (ins.error || !ins.data) throw new Error('Não foi possível vender o pacote.');
  return { id: ins.data.id, preco_unitario: Number(ins.data.preco_unitario || 0) };
}

async function devolverCreditosPacoteDoAgendamento(agendamentoId) {
  if (!agendamentoId) return true;
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('agendamento_servicos').select('cliente_pacote_id').eq('agendamento_id', agendamentoId).not('cliente_pacote_id', 'is', null);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) {
    console.warn('Erro ao buscar créditos para devolução:', resp.error);
    return false;
  }
  for (var i = 0; i < (resp.data || []).length; i++) {
    var cpId = resp.data[i].cliente_pacote_id;
    var cpQuery = supabaseClient.from('cliente_pacotes').select('*').eq('id', cpId).maybeSingle();
    if (tenantId) cpQuery = cpQuery.eq('tenant_id', tenantId);
    var cpResp = await cpQuery;
    if (!cpResp.data) continue;
    var novoSaldo = Math.min(Number(cpResp.data.quantidade_restante || 0) + 1, Number(cpResp.data.quantidade_total || 0));
    await supabaseClient.from('cliente_pacotes').update({ quantidade_restante: novoSaldo, status: 'ativo' }).eq('id', cpId);
  }
  return true;
}

insertAppointment = async function(apt) {
  var tenantId = getCurrentTenantId();
  var clienteObj = clients.find(function(c) { return c.nome === apt.cliente; });
  var clienteId = clienteObj ? clienteObj.id : null;
  if (!clienteId) { console.error('Cliente não encontrado:', apt.cliente); return false; }
  var profObj = allProfissionais.find(function(p) { return p.nome === apt.profissional; });
  var profId = profObj ? profObj.id : null;
  if (!profId) { console.error('Profissional não encontrado:', apt.profissional); return false; }

  var row = {
    cliente_id: clienteId,
    cliente_nome: apt.cliente,
    cliente_telefone: apt.telefone,
    profissional_id: profId,
    data: apt.data,
    hora: apt.hora,
    observacoes: apt.observacoes || '',
    tenant_id: tenantId
  };
  var resp = await supabaseClient.from('agendamentos').insert([row]).select();
  if (resp.error) { console.error('Erro inserir agendamento:', resp.error); return false; }
  var agId = resp.data[0].id;

  for (var i = 0; i < (apt.servicos || []).length; i++) {
    var s = apt.servicos[i];
    var svcObj = pacoteGetServicoByNome(s.servico);
    if (!svcObj) continue;
    var svcProfObj = allProfissionais.find(function(p) { return p.nome === s.profissional; });
    var svcProfId = svcProfObj ? svcProfObj.id : profId;
    var precoServico = Number(svcObj.preco || 0);
    var clientePacoteId = null;
    try {
      if (s.pacote && s.pacote.acao === 'usar') {
        var usado = await consumirPacoteExistente(s.pacote.clientePacoteId);
        precoServico = usado.preco_unitario;
        clientePacoteId = usado.id;
      } else if (s.pacote && s.pacote.acao === 'vender') {
        var vendido = await criarClientePacoteParaAgendamento(s.pacote.pacoteDefId, clienteId, apt.data);
        precoServico = vendido.preco_unitario;
        clientePacoteId = vendido.id;
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Erro ao aplicar pacote.', 'error');
      return false;
    }
    var svcRow = {
      agendamento_id: agId,
      servico_id: svcObj.id,
      profissional_id: svcProfId,
      preco: precoServico,
      duracao: svcObj.duracao,
      cor_id: null,
      cliente_pacote_id: clientePacoteId,
      tenant_id: tenantId
    };
    var svcResp = await supabaseClient.from('agendamento_servicos').insert([svcRow]).select();
    if (svcResp.error) { console.error('Erro inserir agendamento_servicos:', svcResp.error); return false; }
    await saveServiceColors(svcResp.data[0].id, s, tenantId);
  }
  return true;
};

updateAppointment = async function(id, apt) {
  await devolverCreditosPacoteDoAgendamento(id);
  var tenantId = getCurrentTenantId();
  var profObj = allProfissionais.find(function(p) { return p.nome === apt.profissional; });
  var profId = profObj ? profObj.id : null;
  var row = {
    profissional_id: profId,
    data: apt.data,
    hora: apt.hora,
    observacoes: apt.observacoes || '',
    updated_at: new Date().toISOString()
  };
  var resp = await supabaseClient.from('agendamentos').update(row).eq('id', id);
  if (resp.error) { console.error('Erro atualizar agendamento:', resp.error); return false; }
  await supabaseClient.from('agendamento_servicos').delete().eq('agendamento_id', id);

  var clienteObj = clients.find(function(c) { return c.nome === apt.cliente; });
  var clienteId = clienteObj ? clienteObj.id : null;
  for (var i = 0; i < (apt.servicos || []).length; i++) {
    var s = apt.servicos[i];
    var svcObj = pacoteGetServicoByNome(s.servico);
    if (!svcObj) continue;
    var svcProfObj = allProfissionais.find(function(p) { return p.nome === s.profissional; });
    var svcProfId = svcProfObj ? svcProfObj.id : profId;
    var precoServico = Number(svcObj.preco || 0);
    var clientePacoteId = null;
    try {
      if (s.pacote && s.pacote.acao === 'usar') {
        var usado = await consumirPacoteExistente(s.pacote.clientePacoteId);
        precoServico = usado.preco_unitario;
        clientePacoteId = usado.id;
      } else if (s.pacote && s.pacote.acao === 'vender') {
        var vendido = await criarClientePacoteParaAgendamento(s.pacote.pacoteDefId, clienteId, apt.data);
        precoServico = vendido.preco_unitario;
        clientePacoteId = vendido.id;
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Erro ao aplicar pacote.', 'error');
      return false;
    }
    var svcRow = {
      agendamento_id: id,
      servico_id: svcObj.id,
      profissional_id: svcProfId,
      preco: precoServico,
      duracao: svcObj.duracao,
      cor_id: null,
      cliente_pacote_id: clientePacoteId,
      tenant_id: tenantId
    };
    var svcResp = await supabaseClient.from('agendamento_servicos').insert([svcRow]).select();
    if (svcResp.error) { console.error('Erro inserir agendamento_servicos:', svcResp.error); return false; }
    await saveServiceColors(svcResp.data[0].id, s, tenantId);
  }
  return true;
};

var pacoteOriginalDeleteAppointment = typeof deleteAppointment === 'function' ? deleteAppointment : null;
deleteAppointment = async function(id) {
  await devolverCreditosPacoteDoAgendamento(id);
  return pacoteOriginalDeleteAppointment ? pacoteOriginalDeleteAppointment(id) : false;
};

saveAppointment = async function(e) {
  e.preventDefault();
  if (currentUser.role === 'colaborador' && !currentUser.profissionalNome) {
    showToast('Seu usuário não está vinculado a um profissional. Contate o administrador.');
    return;
  }
  var servicos = collectServicosComPacotes();
  if (servicos.length === 0) { showToast('Adicione pelo menos um serviço!'); return; }
  var apt = {
    cliente: document.getElementById('ag-cliente').value.trim(),
    telefone: document.getElementById('ag-telefone').value.trim(),
    profissional: servicos[0].profissional,
    servico: servicos[0].servico,
    data: document.getElementById('ag-data').value,
    hora: document.getElementById('ag-hora-h').value + ':' + document.getElementById('ag-minuto').value,
    servicos: servicos
  };
  if (!apt.cliente || !apt.data || !apt.hora) return;
  var ok = editingAppointmentId ? await updateAppointment(editingAppointmentId, apt) : await insertAppointment(apt);
  if (!ok) { showToast('Erro ao salvar!'); return; }
  showToast(editingAppointmentId ? 'Agendamento atualizado!' : 'Agendamento criado!');
  closeModal('modal-agendamento');
  await loadAppointments();
  renderCalendar();
  renderDayDetail();
};

/* ===== CRUD PACOTES ===== */
function initPacotesUi() {
  ['pacote-servico-id', 'pacote-quantidade-total', 'pacote-tipo-desconto', 'pacote-valor-desconto'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && !el.dataset.previewBound) {
      el.dataset.previewBound = '1';
      el.addEventListener('input', atualizarPreviewPacote);
      el.addEventListener('change', atualizarPreviewPacote);
    }
  });
}

async function populatePacoteServicoSelect() {
  var select = document.getElementById('pacote-servico-id');
  if (!select) return;
  pacoteServicosCache = (allServicos || []).filter(function(s) { return s.ativo !== false; });
  if (pacoteServicosCache.length === 0) {
    await loadServicos();
    pacoteServicosCache = (allServicos || []).filter(function(s) { return s.ativo !== false; });
  }
  select.innerHTML = '<option value="">Selecione...</option>';
  pacoteServicosCache.forEach(function(s) {
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.nome + ' — ' + pacoteMoney(s.preco);
    opt.dataset.preco = s.preco;
    select.appendChild(opt);
  });
}

function calcularValoresPacoteForm() {
  var servicoId = (document.getElementById('pacote-servico-id') || {}).value;
  var svc = pacoteGetServicoById(servicoId);
  var precoOriginal = Number((svc && svc.preco) || 0);
  var qtd = parseInt((document.getElementById('pacote-quantidade-total') || {}).value, 10) || 0;
  var tipo = (document.getElementById('pacote-tipo-desconto') || {}).value || 'percentual';
  var desconto = pacoteNumber((document.getElementById('pacote-valor-desconto') || {}).value);
  var precoUnitario = 0;
  if (qtd > 0) {
    precoUnitario = tipo === 'percentual'
      ? precoOriginal * (1 - desconto / 100)
      : ((precoOriginal * qtd) - desconto) / qtd;
  }
  if (precoUnitario < 0) precoUnitario = 0;
  return { precoOriginal: precoOriginal, quantidade: qtd, tipo: tipo, desconto: desconto, precoUnitario: precoUnitario, precoTotal: precoUnitario * qtd };
}

function atualizarPreviewPacote() {
  var box = document.getElementById('pacote-preview');
  if (!box) return;
  var v = calcularValoresPacoteForm();
  box.innerHTML =
    '<div><span>Preço original</span><strong>' + pacoteMoney(v.precoOriginal) + '</strong></div>' +
    '<div><span>Preço por uso</span><strong>' + pacoteMoney(v.precoUnitario) + '</strong></div>' +
    '<div><span>Total do pacote</span><strong>' + pacoteMoney(v.precoTotal) + '</strong></div>';
}

async function loadPacotes() {
  var tbody = document.getElementById('pacotes-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">Carregando...</td></tr>';
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('pacotes').select('*, servicos(id, nome, preco)').order('created_at', { ascending: false });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) {
    console.error('Erro pacotes:', resp.error);
    tbody.innerHTML = '<tr><td colspan="7">Erro ao carregar pacotes.</td></tr>';
    return;
  }
  renderPacotes(resp.data || []);
}

function renderPacotes(rows) {
  var tbody = document.getElementById('pacotes-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr class="pacotes-empty-row"><td colspan="7">Nenhum pacote cadastrado.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(p) {
    return '<tr>' +
      '<td>' + pacoteEscapeHtml(p.nome) + '</td>' +
      '<td>' + pacoteEscapeHtml((p.servicos && p.servicos.nome) || '-') + '</td>' +
      '<td>' + p.quantidade_total + '</td>' +
      '<td>' + pacoteMoney(p.preco_total) + '</td>' +
      '<td>' + p.validade_dias + ' dias</td>' +
      '<td><span class="status-badge ' + (p.ativo ? 'ativo' : 'inativo') + '">' + (p.ativo ? 'Ativo' : 'Inativo') + '</span></td>' +
      '<td class="pacote-acoes">' +
        '<button class="pacote-icon-btn" type="button" title="Editar" onclick="editarPacote(\'' + p.id + '\')"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="pacote-toggle-switch ' + (p.ativo ? 'is-active' : '') + '" type="button" title="Ativar/Inativar" onclick="togglePacoteAtivo(\'' + p.id + '\', ' + (!p.ativo) + ')"><span class="track"></span><span class="thumb"></span></button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

async function openModalNovoPacote() {
  pacoteCrudEditId = null;
  var form = document.getElementById('form-pacote');
  if (form) form.reset();
  var ativo = document.getElementById('pacote-ativo');
  if (ativo) ativo.checked = true;
  var title = document.getElementById('modal-pacote-titulo');
  if (title) title.textContent = 'Novo Pacote';
  await populatePacoteServicoSelect();
  var svcSel = document.getElementById('pacote-servico-id');
  if (svcSel) svcSel.disabled = false;
  initPacotesUi();
  atualizarPreviewPacote();
  openModal('modal-pacote');
}

async function editarPacote(id) {
  pacoteCrudEditId = id;
  await populatePacoteServicoSelect();
  var tenantId = getCurrentTenantId();
  var query = supabaseClient.from('pacotes').select('*').eq('id', id).maybeSingle();
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error || !resp.data) { showToast('Pacote não encontrado.', 'error'); return; }
  var p = resp.data;
  document.getElementById('pacote-nome').value = p.nome || '';
  document.getElementById('pacote-servico-id').value = p.servico_id || '';
  document.getElementById('pacote-servico-id').disabled = true;
  document.getElementById('pacote-quantidade-total').value = p.quantidade_total || 1;
  document.getElementById('pacote-quantidade-total').disabled = true;
  document.getElementById('pacote-tipo-desconto').value = p.tipo_desconto || 'percentual';
  document.getElementById('pacote-valor-desconto').value = p.valor_desconto || 0;
  document.getElementById('pacote-validade-dias').value = p.validade_dias || 30;
  document.getElementById('pacote-ativo').checked = !!p.ativo;
  document.getElementById('modal-pacote-titulo').textContent = 'Editar Pacote';
  initPacotesUi();
  atualizarPreviewPacote();
  openModal('modal-pacote');
}

async function salvarPacoteCrud(e) {
  e.preventDefault();
  var tenantId = getCurrentTenantId();
  var nome = document.getElementById('pacote-nome').value.trim();
  var servicoId = document.getElementById('pacote-servico-id').value;
  var qtd = parseInt(document.getElementById('pacote-quantidade-total').value, 10) || 0;
  var validade = parseInt(document.getElementById('pacote-validade-dias').value, 10) || 0;
  var ativo = document.getElementById('pacote-ativo').checked;
  var valores = calcularValoresPacoteForm();
  if (!nome || !servicoId) { showToast('Preencha nome e serviço.', 'error'); return; }
  if (qtd <= 0) { showToast('Quantidade deve ser maior que zero.', 'error'); return; }
  if (validade <= 0) { showToast('Validade deve ser maior que zero.', 'error'); return; }
  var row = {
    nome: nome,
    tipo_desconto: valores.tipo,
    valor_desconto: valores.desconto,
    validade_dias: validade,
    ativo: ativo,
    preco_original_unitario: valores.precoOriginal,
    preco_unitario_final: valores.precoUnitario,
    preco_total: valores.precoTotal
  };
  var resp;
  if (pacoteCrudEditId) {
    resp = await supabaseClient.from('pacotes').update(row).eq('id', pacoteCrudEditId);
  } else {
    row.tenant_id = tenantId;
    row.servico_id = servicoId;
    row.quantidade_total = qtd;
    resp = await supabaseClient.from('pacotes').insert([row]);
  }
  if (resp.error) { console.error('Erro salvar pacote:', resp.error); showToast('Erro ao salvar pacote.', 'error'); return; }
  showToast(pacoteCrudEditId ? 'Pacote atualizado!' : 'Pacote criado!');
  closeModal('modal-pacote');
  await loadPacotes();
}

async function togglePacoteAtivo(id, ativo) {
  var resp = await supabaseClient.from('pacotes').update({ ativo: ativo }).eq('id', id);
  if (resp.error) { showToast('Erro ao alterar status.', 'error'); return; }
  showToast(ativo ? 'Pacote ativado!' : 'Pacote inativado!');
  await loadPacotes();
}

var pacoteOriginalSwitchPage = typeof switchPage === 'function' ? switchPage : null;
switchPage = function(page) {
  if (pacoteOriginalSwitchPage) pacoteOriginalSwitchPage(page);
  if (page === 'pacotes') {
    initPacotesUi();
    populatePacoteServicoSelect();
    loadPacotes();
  }
};

document.addEventListener('DOMContentLoaded', function() {
  initPacotesUi();
  var formPacote = document.getElementById('form-pacote');
  if (formPacote && !formPacote.dataset.bound) {
    formPacote.dataset.bound = '1';
    formPacote.addEventListener('submit', salvarPacoteCrud);
  }
});
