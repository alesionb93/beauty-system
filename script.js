/* ===== DATA (agora dinâmico — carregado do Supabase) ===== */
var professionals = {};
var servicePrices = {};
var allServicos = [];
var allProfissionais = [];

/* ===== CORES DINÂMICAS (carregadas do Supabase) ===== */
var coresPorServico = {};
var colorOptions = [];
var pigmentOptions = [];
var professionalAvatars = {};

var clients = [];
var appointments = [];
var editingAppointmentId = null;
var pendingClienteFromIdentificacao = null;
var currentUser = { nome: '', role: '', tenantId: null };
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
  var query = supabaseClient.from('agendamentos').select('*, agendamento_servicos(id, servico_id, preco, duracao, cor_id, servicos(id, nome, preco, duracao), cores(id, nome, hex), agendamento_servico_cores(id, cor_id, tipo, quantidade, cores(id, nome, hex)))');
  if (tenantId) query = query.eq('tenant_id', tenantId);
  var resp = await query;
  if (resp.error) { console.error('Erro agendamentos:', resp.error); return; }

  // Build profissional id->nome map
  var profIdToNome = {};
  allProfissionais.forEach(function(p) { profIdToNome[p.id] = p.nome; });

  appointments = resp.data.map(function(a) {
    var profNome = profIdToNome[a.profissional_id] || '';
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
      return {
        profissional: profNome,
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
      profissional: profNome,
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
  allProfissionais = resp.data || [];

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
  if (resp.error) { console.error('Erro excluir cor:', resp.error); return false; }
  return true;
}

/* Helpers de permissão — SEMPRE baseados na role carregada do banco */
function isAdmin() {
  return currentUser.role === 'admin' || currentUser.role === 'master_admin';
}
function isMasterAdmin() {
  return currentUser.role === 'master_admin';
}

function getProfServiceNames(prof) {
  return (professionals[prof] || []).map(function(s) { return s.nome; });
}

async function insertAppointment(apt) {
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
  if (apt.servicos && apt.servicos.length > 0) {
    for (var i = 0; i < apt.servicos.length; i++) {
      var s = apt.servicos[i];
      var svcObj = allServicos.find(function(sv) { return sv.nome === s.servico; });
      if (!svcObj) continue;
      var svcRow = {
        agendamento_id: agId,
        servico_id: svcObj.id,
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
      var svcRow = {
        agendamento_id: id,
        servico_id: svcObj.id,
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
  if (ag) {
    var histRow = {
      agendamento_id: ag.id,
      cliente_id: ag.cliente_id || null,
      cliente_nome: ag.cliente,
      cliente_telefone: ag.telefone,
      profissional_id: ag.profissional_id || null,
      profissional_nome: ag.profissional,
      status: ag.status || 'agendado',
      data: ag.data,
      hora: ag.hora,
      observacoes: ag.observacoes || '',
      tenant_id: tenantId
    };
    var histResp = await supabaseClient.from('historico_atendimentos').insert([histRow]).select();
    // Save services to historico_servicos
    if (histResp.data && histResp.data[0] && ag.servicos && ag.servicos.length > 0) {
      var histId = histResp.data[0].id;
      var histSvcRows = ag.servicos.map(function(s) {
        return {
          historico_atendimento_id: histId,
          servico_nome: s.servico,
          preco: s.preco || 0,
          duracao: s.duracao || 30,
          cor_nome: s.cor || null,
          cor_hex: null,
          tenant_id: tenantId
        };
      });
      await supabaseClient.from('historico_servicos').insert(histSvcRows);
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
  if (session && session.user) {
    var usuarioResp = await supabaseClient.from('usuarios').select('profissional_id').eq('id', session.user.id).maybeSingle();
    if (usuarioResp.data && usuarioResp.data.profissional_id) {
      var linkedProf = allProfissionais.find(function(p) { return p.id === usuarioResp.data.profissional_id; });
      if (linkedProf) linkedProfName = linkedProf.nome;
    }
  }
  activeFilters = linkedProfName ? [linkedProfName] : (allProfissionais.length > 0 ? [allProfissionais[0].nome] : []);
  await loadServicos();
  await loadProfissionalServicos();
  await loadCores();
  await loadClients();
  await loadAppointments();

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var page = this.dataset.page;
      if (page === 'dashboard' && !isAdmin()) return;
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

  var baseQtdSelect = document.getElementById('base-qtd-select');
  for (var g = 5; g <= 120; g += 5) {
    var opt = document.createElement('option');
    opt.value = g; opt.textContent = g + 'g';
    baseQtdSelect.appendChild(opt);
  }

  var pigQtdSelect = document.getElementById('pigmento-qtd-select');
  for (var pg = 1; pg <= 10; pg += 1) {
    var opt2 = document.createElement('option');
    opt2.value = pg; opt2.textContent = pg + 'g';
    pigQtdSelect.appendChild(opt2);
  }

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
  Object.keys(professionals).forEach(function(name) {
    var chip = document.createElement('button');
    chip.className = 'filter-chip' + (activeFilters.indexOf(name) >= 0 ? ' active' : '');
    var avatarHtml = getAvatarHtml(name, 'avatar--chip');
    chip.innerHTML = avatarHtml + '<span>' + name + '</span>';
    chip.onclick = function() {
      var idx = activeFilters.indexOf(name);
      if (idx >= 0) { activeFilters.splice(idx, 1); } else { activeFilters.push(name); }
      renderFilterChips();
      renderCalendar();
      renderDayDetail();
    };
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

  var showMultiAgenda = isAdmin() && activeFilters.length > 1;

  if (showMultiAgenda) {
    renderMultiAgenda(container, dayAppointments, dateStr);
  } else {
    renderSingleTimeline(container, dayAppointments);
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

function computeOverlapGroups(apps) {
  // Sort by start time
  var sorted = apps.slice().sort(function(a, b) { return a.hora.localeCompare(b.hora); });
  var groups = [];
  sorted.forEach(function(a) {
    var aParts = a.hora.split(':');
    var aStart = parseInt(aParts[0]) * 60 + parseInt(aParts[1] || 0);
    var aEnd = aStart + getAppointmentDuration(a);
    var placed = false;
    for (var g = 0; g < groups.length; g++) {
      var overlaps = false;
      for (var i = 0; i < groups[g].length; i++) {
        var b = groups[g][i];
        var bParts = b.hora.split(':');
        var bStart = parseInt(bParts[0]) * 60 + parseInt(bParts[1] || 0);
        var bEnd = bStart + getAppointmentDuration(b);
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
      var lEnd = lStart + getAppointmentDuration(lastInCol);
      if (aStart >= lEnd) { columns[c] = a; result[a.id] = c; placed = true; break; }
    }
    if (!placed) { result[a.id] = columns.length; columns.push(a); }
  });
  return { map: result, totalCols: columns.length };
}

function renderSingleTimeline(container, dayAppointments) {
  container.className = 'timeline-container';
  var html = '<div class="timeline">';
  for (var h = 7; h <= 21; h++) {
    html += '<div class="timeline-row"><div class="timeline-hour">' + pad(h) + ':00</div><div class="timeline-slot" data-hour="' + h + '"></div></div>';
  }
  html += '<div class="timeline-blocks" id="timeline-blocks"></div></div>';
  container.innerHTML = html;

  var blocksContainer = document.getElementById('timeline-blocks');
  var groups = computeOverlapGroups(dayAppointments);
  groups.forEach(function(group) {
    var cols = assignColumns(group);
    group.forEach(function(a) {
      renderTimelineBlock(blocksContainer, a, cols.map[a.id], cols.totalCols);
    });
  });
}

function renderMultiAgenda(container, dayAppointments, dateStr) {
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

  activeFilters.forEach(function(name, colIdx) {
    var profApps = dayAppointments.filter(function(a) { return getAppointmentProfessionals(a).indexOf(name) >= 0; });
    var blocksEl = container.querySelector('.multi-agenda-blocks[data-prof-col="' + name + '"]');
    var groups = computeOverlapGroups(profApps);
    groups.forEach(function(group) {
      var cols = assignColumns(group);
      var totalSubCols = cols.totalCols;
      var colWidth = 100 / activeFilters.length;
      group.forEach(function(a) {
        var subCol = cols.map[a.id];
        renderTimelineBlockMulti(blocksEl, a, colIdx, activeFilters.length, subCol, totalSubCols);
      });
    });
  });
}

function renderTimelineBlockMulti(container, a, colIdx, totalCols, subCol, totalSubCols) {
  var parts = a.hora.split(':');
  var hourNum = parseInt(parts[0]);
  var minNum = parseInt(parts[1] || 0);
  var startMinutes = (hourNum - 7) * 60 + minNum;
  var duration = getAppointmentDuration(a);
  var topPx = startMinutes;
  var heightPx = Math.max(duration, 20);

  var endTime = computeEndTime(a.hora, duration);
  var servicos = getAppointmentServicos(a);
  var serviceNames = servicos.map(function(s) { return s.servico; }).join(', ');

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

  buildBlockContent(block, a, heightPx, endTime, serviceNames);
  block.onclick = function() { openAgendamentoParaEditar(a); };
  container.appendChild(block);
}

function renderTimelineBlock(container, a, colIdx, totalCols) {
  var parts = a.hora.split(':');
  var hourNum = parseInt(parts[0]);
  var minNum = parseInt(parts[1] || 0);
  var startMinutes = (hourNum - 7) * 60 + minNum;
  var duration = getAppointmentDuration(a);
  var topPx = startMinutes;
  var heightPx = Math.max(duration, 20);

  var endTime = computeEndTime(a.hora, duration);
  var servicos = getAppointmentServicos(a);
  var serviceNames = servicos.map(function(s) { return s.servico; }).join(', ');

  var block = document.createElement('div');
  block.className = 'timeline-block';
  block.style.top = topPx + 'px';
  block.style.height = heightPx + 'px';
  block.style.overflow = 'hidden';

  if (totalCols > 1) {
    var colWidth = 100 / totalCols;
    block.style.left = (colIdx * colWidth) + '%';
    block.style.width = colWidth + '%';
    if (totalCols > 1) {
      block.style.zIndex = 10 + colIdx;
      block.style.boxShadow = '-2px 0 4px rgba(0,0,0,0.15)';
    }
  }

  buildBlockContent(block, a, heightPx, endTime, serviceNames);
  block.onclick = function() { openAgendamentoParaEditar(a); };
  container.appendChild(block);
}

function buildBlockContent(block, a, heightPx, endTime, serviceNames) {
  var timeRange = a.hora + ' \u2013 ' + endTime;
  var serviceText = serviceNames ? ' - ' + serviceNames : '';
  block.style.display = 'flex';
  block.style.flexDirection = 'column';
  block.style.justifyContent = 'center';
  if (heightPx <= 38) {
    block.innerHTML = '<div class="tb-row-compact">' +
      '<span class="tb-time">' + timeRange + '</span> <span class="tb-client">' + a.cliente + '</span><span class="tb-service">' + serviceText + '</span></div>';
  } else if (heightPx <= 55) {
    block.innerHTML = '<div class="tb-time tb-truncate">' + timeRange + '</div>' +
      '<div class="tb-row-compact"><span class="tb-client">' + a.cliente + '</span><span class="tb-service">' + serviceText + '</span></div>';
  } else {
    block.innerHTML = '<div class="tb-time tb-truncate">' + timeRange + '</div>' +
      '<div class="tb-client tb-truncate">' + a.cliente + '</div>' +
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
  var prof = block.querySelector('.svc-profissional').value;
  var servico = selectEl.value;
  var extrasDiv = block.querySelector('.svc-extras');
  extrasDiv.innerHTML = '';

  var isColoracao = servico === 'Coloração';
  var isRubia = prof === 'Rubia';

  if (isColoracao) {
    var cores = getCoresDoServico('Coloração');

    if (isRubia) {
      extrasDiv.innerHTML =
        '<div class="form-group"><label>Base</label>' +
        '<div class="bases-container"></div>' +
        '<button type="button" class="btn-add-cor" onclick="adicionarCampoBase(this)"><i class="fa-solid fa-circle-plus"></i> Adicionar outra base</button>' +
        '</div>' +
        '<div class="form-group"><label>Pigmentação</label>' +
        '<div class="pig-container"></div>' +
        '<button type="button" class="btn-add-cor" onclick="adicionarPigmentacao(this)"><i class="fa-solid fa-circle-plus"></i> Adicionar pigmentação</button>' +
        '</div>';
      adicionarCampoBase(extrasDiv.querySelector('.btn-add-cor'));
    } else {
      extrasDiv.innerHTML =
        '<div class="form-group"><label>Cores</label>' +
        '<div class="cores-container"></div>' +
        '<button type="button" class="btn-add-cor" onclick="adicionarCorSimples(this)"><i class="fa-solid fa-circle-plus"></i> Adicionar cor</button>' +
        '</div>';
      adicionarCorSimples(extrasDiv.querySelector('.btn-add-cor'));
    }
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
  var cores = getCoresDoServico('Coloração');
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
        wrapper.dataset.qtd = qtd;
        qtdBadge.textContent = qtd + 'g';
      };
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
  var cores = getCoresDoServico('Coloração');
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
        wrapper.dataset.qtd = qtd;
        qtdBadge.textContent = qtd + 'g';
      };
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
  var cores = getCoresDoServico('Coloração');
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

  var query1 = supabaseClient.from('historico_atendimentos').select('*, historico_servicos(*)').eq('cliente_nome', cliente.nome).order('data', { ascending: false });
  if (tenantId) query1 = query1.eq('tenant_id', tenantId);
  var resp = await query1;
  var historico = resp.data || [];

  var query2 = supabaseClient.from('agendamentos').select('*, agendamento_servicos(servico_id, preco, duracao, cor_id, servicos(nome), cores(nome, hex))').eq('cliente_nome', cliente.nome).order('data', { ascending: false });
  if (tenantId) query2 = query2.eq('tenant_id', tenantId);
  var resp2 = await query2;
  var agendamentos = resp2.data || [];

  // Normalize agendamentos to have .servicos array like historico
  agendamentos.forEach(function(ag) {
    if (ag.agendamento_servicos && ag.agendamento_servicos.length > 0) {
      var profNomeMap = {};
      allProfissionais.forEach(function(p) { profNomeMap[p.id] = p.nome; });
      ag.profissional = profNomeMap[ag.profissional_id] || '';
      ag.servicos = ag.agendamento_servicos.map(function(as) {
        return { profissional: ag.profissional, servico: as.servicos ? as.servicos.nome : '', bases: [], pigmentacoes: [], cores: as.cores ? [as.cores.nome] : [] };
      });
    }
  });
  // Normalize historico to have .servicos from historico_servicos
  historico.forEach(function(h) {
    if (h.historico_servicos && h.historico_servicos.length > 0 && !h.servicos) {
      h.servicos = h.historico_servicos.map(function(hs) {
        return { profissional: h.profissional_nome || '', servico: hs.servico_nome, bases: [], pigmentacoes: [], cores: hs.cor_nome ? [hs.cor_nome] : [] };
      });
    }
  });
  var todos = historico.concat(agendamentos);
  todos.sort(function(a, b) { return (b.data || '').localeCompare(a.data || ''); });

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
              var opt = colorOptions.find(function(o) { return o.code === b.cor; });
              var hex = opt ? opt.hex : '#888';
              svcLine += '<span class="hist-cor-badge"><span class="hist-cor-swatch" style="background:' + hex + '"></span>' + b.cor;
              if (b.qtd) svcLine += ' (' + b.qtd + 'g)';
              svcLine += '</span>';
              if (idx < s.bases.length - 1) svcLine += ' ';
            });
          }
          if (s.pigmentacoes && s.pigmentacoes.length > 0) {
            svcLine += ' — Pigmentação: ';
            s.pigmentacoes.forEach(function(p, idx) {
              var opt = pigmentOptions.find(function(o) { return o.code === p.cor; });
              var hex = opt ? opt.hex : '#888';
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
      html += '<li><span class="hist-data">' + dataF + '</span>' + svcList.join('<br>') + '</li>';
    });
    html += '</ul>';
  }
  conteudo.innerHTML = html;
}

/* ===== PROFESSIONALS PAGE ===== */
function renderProfessionals() {
  // FIX: garantir que todos os profissionais de allProfissionais estejam no dict
  allProfissionais.forEach(function(p) {
    if (!professionals[p.nome]) professionals[p.nome] = [];
  });
  var container = document.getElementById('professionals-grid');
  container.innerHTML = '';
  Object.keys(professionals).forEach(function(name) {
    var card = document.createElement('div');
    card.className = 'professional-card';
    var services = professionals[name].map(function(s) {
      var dur = s.duracao ? s.duracao + 'min' : '';
      var preco = s.preco ? ' R$' + s.preco.toFixed(0) : '';
      return '<li><i class="fa-solid fa-scissors"></i>' + s.nome + (dur ? ' <span class="svc-dur">(' + dur + preco + ')</span>' : '') + '</li>';
    }).join('');
    var editBtn = '';
    if (isAdmin()) {
      editBtn = '<button class="btn-edit-prof" onclick="openModalEditarProfissional(\'' + name.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-pen"></i></button>';
    }
    var avatarHtml = getAvatarHtml(name, '');
    // Verificar se profissional está vinculado a um usuário
    var profObj = allProfissionais.find(function(p) { return p.nome === name; });
    var linkedUser = profObj ? allUsuarios.find(function(u) { return u.profissional_id === profObj.id; }) : null;
    var linkedBadge = linkedUser ? '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(108,58,237,0.07);color:var(--gold,#6C3AED);font-size:0.68rem;font-weight:500;padding:2px 8px 2px 6px;border-radius:20px;margin-left:6px;border:1px solid rgba(108,58,237,0.12);letter-spacing:0.01em;"><i class=\'fa-solid fa-link\' style=\'font-size:0.55rem;opacity:0.7;\'></i>' + linkedUser.nome + '</span>' : '';
    card.innerHTML = '<div class="card-header">' + avatarHtml + '<span class="name">' + name + '</span>' + linkedBadge + editBtn + '</div><ul class="services-list">' + services + '</ul>';
    container.appendChild(card);
  });
  if (Object.keys(professionals).length === 0) {
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
  container.innerHTML = baseHtml + pigHtml;
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
  renderListaCoresServico();
  renderListaServicos();
}

async function confirmarExcluirCor(corId) {
  if (!confirm('Excluir esta cor?')) return;
  var ok = await excluirCor(corId);
  if (!ok) { showToast('Erro!'); return; }
  showToast('Cor removida!');
  await loadCores();
  renderListaCoresServico();
  renderListaServicos();
}

/* ===== DASHBOARD ===== */
function initDashboard() {
  var hoje = new Date();
  var inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  document.getElementById('dash-inicio').value = formatDateInput(inicio);
  document.getElementById('dash-fim').value = formatDateInput(hoje);
  loadDashboard();
}

async function loadDashboard() {
  var inicio = document.getElementById('dash-inicio').value;
  var fim = document.getElementById('dash-fim').value;
  if (!inicio || !fim) return;
  var tenantId = getCurrentTenantId();

  // Build profissional id->nome map
  var profIdToNome = {};
  allProfissionais.forEach(function(p) { profIdToNome[p.id] = p.nome; });

  // Query agendamentos WITH services joined
  var q1 = supabaseClient.from('agendamentos')
    .select('*, agendamento_servicos(servico_id, preco, duracao, servicos(id, nome, preco, duracao))')
    .gte('data', inicio).lte('data', fim);
  if (tenantId) q1 = q1.eq('tenant_id', tenantId);

  // Query historico
  var q2 = supabaseClient.from('historico_atendimentos')
    .select('*, historico_servicos(servico_nome, preco, duracao)')
    .gte('data', inicio).lte('data', fim);
  if (tenantId) q2 = q2.eq('tenant_id', tenantId);

  var resp1 = await q1;
  var resp2 = await q2;

  var totalAg = 0;
  var totalFaturamento = 0;
  var totalServicos = 0;
  var profData = {};
  var servicoCount = {};
  var clienteCount = {};
  var profHoraFat = {};
  allProfissionais.forEach(function(p) { profHoraFat[p.nome] = {}; });

  // Process agendamentos (with joined services)
  (resp1.data || []).forEach(function(a) {
    totalAg++;
    var hora = (a.hora || '').substring(0, 2);
    var clienteNomeDash = a.cliente_nome || '';
    clienteCount[clienteNomeDash] = (clienteCount[clienteNomeDash] || 0) + 1;
    var profNome = profIdToNome[a.profissional_id] || '';

    var svcs = a.agendamento_servicos || [];
    if (svcs.length === 0) {
      // Fallback: count as 1 service with no price
      if (!profData[profNome]) profData[profNome] = { atendimentos: 0, servicos: 0, faturamento: 0 };
      profData[profNome].atendimentos++;
    } else {
      if (!profData[profNome]) profData[profNome] = { atendimentos: 0, servicos: 0, faturamento: 0 };
      profData[profNome].atendimentos++;
      svcs.forEach(function(as) {
        var svcNome = as.servicos ? as.servicos.nome : '';
        var preco = parseFloat(as.preco) || 0;
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
    }
  });

  // Process historico_atendimentos (with joined historico_servicos)
  (resp2.data || []).forEach(function(h) {
    totalAg++;
    var hora = (h.hora || '').substring(0, 2);
    var clienteNomeDash = h.cliente_nome || '';
    clienteCount[clienteNomeDash] = (clienteCount[clienteNomeDash] || 0) + 1;
    var profNome = h.profissional_nome || '';

    var svcs = h.historico_servicos || [];
    if (!profData[profNome]) profData[profNome] = { atendimentos: 0, servicos: 0, faturamento: 0 };
    profData[profNome].atendimentos++;

    if (svcs.length > 0) {
      svcs.forEach(function(hs) {
        var preco = parseFloat(hs.preco) || 0;
        totalFaturamento += preco;
        totalServicos++;
        profData[profNome].servicos++;
        profData[profNome].faturamento += preco;
        if (profHoraFat[profNome]) {
          if (!profHoraFat[profNome][hora]) profHoraFat[profNome][hora] = 0;
          profHoraFat[profNome][hora] += preco;
        }
        var svcNome = hs.servico_nome || '';
        if (svcNome) {
          if (!servicoCount[svcNome]) servicoCount[svcNome] = { qtd: 0, valor: 0 };
          servicoCount[svcNome].qtd++;
          servicoCount[svcNome].valor += preco;
        }
      });
    }
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
    profTbody.innerHTML += '<tr><td>' + name + '</td><td>' + d.atendimentos + '</td><td>' + d.servicos + '</td><td>' + formatCurrency(d.faturamento) + '</td></tr>';
  });

  var svcArr = Object.keys(servicoCount).map(function(k) { return { nome: k, qtd: servicoCount[k].qtd, valor: servicoCount[k].valor }; });
  svcArr.sort(function(a, b) { return b.qtd - a.qtd; });
  var topSvc = document.getElementById('dash-top-servicos');
  topSvc.innerHTML = '';
  svcArr.slice(0, 10).forEach(function(s) { topSvc.innerHTML += '<tr><td>' + s.nome + '</td><td>' + s.qtd + '</td><td>' + formatCurrency(s.valor) + '</td></tr>'; });

  var cliArr = Object.keys(clienteCount).map(function(k) { return { nome: k, qtd: clienteCount[k] }; });
  cliArr.sort(function(a, b) { return b.qtd - a.qtd; });
  var topCli = document.getElementById('dash-top-clientes');
  topCli.innerHTML = '';
  cliArr.slice(0, 10).forEach(function(c) { topCli.innerHTML += '<tr><td>' + c.nome + '</td><td>' + c.qtd + '</td></tr>'; });
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

/* ===== TOAST ===== */
function showToast(msg, type) {
  type = type || 'success';
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();
  var div = document.createElement('div');
  div.className = 'toast toast-' + type;
  var icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };
  div.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.success) + '"></i>' + msg;
  document.body.appendChild(div);
  setTimeout(function() { div.classList.add('hide'); setTimeout(function() { div.remove(); }, 300); }, 3000);
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

function renderUsuarios() {
  var tbody = document.getElementById('usuarios-tbody');
  var cardsContainer = document.getElementById('usuarios-cards');
  var countEl = document.getElementById('config-users-count');
  tbody.innerHTML = '';
  cardsContainer.innerHTML = '';
  countEl.textContent = allUsuarios.length + ' usuários';

  allUsuarios.forEach(function(u) {
    var tr = document.createElement('tr');
    var roleBadge = '<span class="role-badge ' + u.role + '">' + u.role + '</span>';
    var profBadge = u.profissional_id ? ' <span class="role-badge" style="background:rgba(72,187,120,0.15);color:#48bb78;font-size:0.7rem;">\u{1F464} Profissional</span>' : '';
    var actions = '<div class="servico-crud-actions"><button class="btn-icon" onclick="openEditarUsuario(\x27' + u.id + '\x27)"><i class="fa-solid fa-pen"></i></button></div>';
    tr.innerHTML = '<td>' + u.nome + '</td><td>' + u.email + '</td><td>' + roleBadge + profBadge + '</td><td>' + actions + '</td>';
    tbody.appendChild(tr);
    var card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = '<div class="user-card-header"><span class="user-card-name">' + u.nome + '</span>' + roleBadge + profBadge + '</div><div class="user-card-email">' + u.email + '</div><div class="user-card-footer">' + actions + '</div>';
    cardsContainer.appendChild(card);
  });
}

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
  openModal('modal-criar-usuario');
}

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
  var role = document.getElementById('novo-user-role').value;
  var profTipoEl = document.querySelector('input[name="novo-user-prof-tipo"]:checked');
  var profTipo = profTipoEl ? profTipoEl.value : 'nenhum';
  var profIdSel = document.getElementById('novo-user-profissional-id').value || '';
  var tenantId = getCurrentTenantId();

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
      throw new Error((payload && payload.message) || 'Erro ao criar usuário.');
    }

    // Sucesso!
    clearFeedback();
    closeModal('modal-criar-usuario');
    showToast('Usuário criado com sucesso!');

    var senhaInfo = (payload && payload.senha_provisoria) || '(definida no backend)';
    alert('Usuário criado!\n\nEmail: ' + email + '\nSenha: ' + senhaInfo + '\n\nAnote e entregue ao usuário.');

    await loadUsuarios();
    renderUsuarios();
    if (profTipo === 'criar') { await loadProfissionais(); renderProfessionals(); }

  } catch (err) {
    var msg = err && err.message ? err.message : 'Erro inesperado ao criar usuário.';
    if (/429|rate.?limit/i.test(msg)) {
      setFeedback('Servidor temporariamente limitado. Aguarde e tente novamente.', '#e67e22');
      aplicarCooldown(60);
      return;
    }
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
