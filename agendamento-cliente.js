/* ============================================================
   AGENDAMENTO-CLIENTE v4
   - Lê tenantId do PATH (/agendar/{id}) E da querystring
   - Consulta tabelas reais do schema (sem RPCs/views inexistentes)
   - Valida feature flag tenant_settings.permitir_agendamento_cliente
   - Timeout em todas as chamadas Supabase (resolve loading infinito)
   - Fallback mock APENAS em modo DEMO real (sem Supabase configurado)
   ============================================================ */

(function () {
  'use strict';

  /* Normaliza nome para comparação: trim, colapsa espaços, lower, remove acentos */
  function normalizeName(n) {
    return String(n || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }


  /* Busca bloqueios do tenant para a data e profissionais informados,
     convertendo cada bloqueio em uma "ocupação" (mesmo formato dos agendamentos).
     Se a tabela não existir ainda no banco, retorna array vazio (graceful). */
  async function fetchBloqueiosClienteAsOcupacoes(sb, tenantId, dataISO, profissionalIds) {
    if (!sb || !tenantId || !dataISO || !profissionalIds || !profissionalIds.length) return [];

    function toOcup(rows) {
      return (rows || []).map(function(b){
        var p1 = String(b.hora_inicio||'00:00').split(':');
        var p2 = String(b.hora_fim||'00:00').split(':');
        var ini = parseInt(p1[0],10)*60 + parseInt(p1[1]||'0',10);
        var fim = parseInt(p2[0],10)*60 + parseInt(p2[1]||'0',10);
        var dur = Math.max(fim - ini, 1);
        return {
          profissional_id: b.profissional_id,
          hora: String(b.hora_inicio||'').slice(0,5),
          duracao_total: dur
        };
      });
    }

    // 1) Caminho preferido: RPC pública (anon-friendly, SECURITY DEFINER).
    //    Necessário pois RLS de `agenda_bloqueios` bloqueia leitura anônima.
    try {
      var rpc = await sb.rpc('get_public_agenda_bloqueios', {
        _tenant_id: tenantId,
        _data: dataISO,
        _profissional_ids: profissionalIds
      });
      if (!rpc.error && Array.isArray(rpc.data)) {
        return toOcup(rpc.data);
      }
      if (rpc.error) {
        console.warn('[ac] RPC bloqueios indisponivel, tentando SELECT:', rpc.error.message);
      }
    } catch (e) {
      console.warn('[ac] RPC bloqueios erro:', e && e.message);
    }

    // 2) Fallback: SELECT direto (funciona quando a sessao tem permissao).
    try {
      var resp = await sb
        .from('agenda_bloqueios')
        .select('profissional_id, hora_inicio, hora_fim')
        .eq('tenant_id', tenantId)
        .eq('data', dataISO)
        .in('profissional_id', profissionalIds);
      if (resp.error) {
        console.warn('[ac] bloqueios indisponiveis:', resp.error.message);
        return [];
      }
      return toOcup(resp.data);
    } catch(e) {
      console.warn('[ac] fetchBloqueiosClienteAsOcupacoes erro:', e && e.message);
      return [];
    }
  }

  /* ============================================================
     0. UTILS
     ============================================================ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function brl(n) { return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ','); }
  function formatDateBR(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function formatDuracao(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m ? pad(m) : '');
  }
  function avatarInitials(nome) {
    var parts = String(nome || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }
  function todayISO(offset) {
    var d = new Date(); d.setDate(d.getDate() + (offset || 0));
    return d.toISOString().slice(0, 10);
  }

  /**
   * Lê o tenantId de:
   *  1) /agendar/{tenantId}            (path-based — formato novo)
   *  2) ?tenantId=... ou ?tenant=...   (querystring — compat antigo)
   *  3) último segmento do path se for um UUID
   */
  function getTenantIdFromUrl() {
    try {
      var u = new URL(window.location.href);
      // 1) /agendar/{tenantId}
      var m = u.pathname.match(/\/agendar\/([^\/?#]+)/i);
      if (m && m[1]) return decodeURIComponent(m[1]);
      // 2) querystring
      var qs = u.searchParams.get('tenantId') || u.searchParams.get('tenant');
      if (qs) return qs;
      // 3) último segmento se parece com UUID
      var segs = u.pathname.split('/').filter(Boolean);
      var last = segs[segs.length - 1] || '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last)) return last;
      return null;
    } catch (e) { return null; }
  }

  function showToast(msg, type) {
    var el = $('#ac-toast');
    el.className = 'ac-toast ' + (type || '');
    el.textContent = msg;
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  // Promise.race com timeout — IMPRESCINDÍVEL para nunca travar o boot
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout: ' + (label || 'request') + ' (' + ms + 'ms)')); }, ms);
      })
    ]);
  }

  /* ============================================================
     1. SUPABASE CLIENT (lazy init)
     ============================================================ */
  var supabase = null;
  function initSupabase() {
    if (supabase) return supabase;
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;
    var url = (window.SUPABASE_URL) || (window.CONFIG && window.CONFIG.SUPABASE_URL);
    var key = (window.SUPABASE_ANON_KEY) || (window.CONFIG && window.CONFIG.SUPABASE_ANON_KEY);
    if (!url || !key) return null;
    try {
      supabase = window.supabase.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      return supabase;
    } catch (e) {
      console.warn('[ac] supabase init failed', e);
      return null;
    }
  }

  /* ============================================================
     2. MOCK (apenas modo DEMO — sem Supabase configurado)
     ============================================================ */
  var MOCK = {
    tenant: {
      tenant_id: 'mock', nome: 'Studio Beauty Premium (DEMO)',
      endereco: 'Av. Paulista, 1500 - São Paulo, SP',
      logo_url: '', cover_url: '',
      habilitado: true, horario_inicio: '09:00', horario_fim: '19:00', slot_minutos: 15
    },
    servicos: [
      { id: 'srv-1', nome: 'Corte Feminino',     descricao: 'Corte personalizado com finalização e escova.',     preco: 80,  duracao: 60 },
      { id: 'srv-2', nome: 'Coloração',          descricao: 'Coloração completa com produtos profissionais.',    preco: 180, duracao: 120 },
      { id: 'srv-3', nome: 'Manicure',           descricao: 'Cuidado completo das unhas com esmaltação.',        preco: 45,  duracao: 45 },
      { id: 'srv-4', nome: 'Pedicure',           descricao: 'Tratamento dos pés com hidratação e esmaltação.',   preco: 55,  duracao: 60 },
      { id: 'srv-5', nome: 'Sobrancelha',        descricao: 'Design de sobrancelhas com henna opcional.',        preco: 40,  duracao: 30 },
      { id: 'srv-6', nome: 'Hidratação Capilar', descricao: 'Tratamento profundo para cabelos ressecados.',      preco: 95,  duracao: 75 },
      { id: 'srv-7', nome: 'Escova Progressiva', descricao: 'Alisamento e tratamento dos fios em uma sessão.',   preco: 250, duracao: 180 },
      { id: 'srv-8', nome: 'Maquiagem Social',   descricao: 'Maquiagem para eventos e ocasiões especiais.',      preco: 120, duracao: 60 }
    ],
    profissionais: [
      { id: 'prof-1', nome: 'Lucas Almeida', foto_url: '' },
      { id: 'prof-2', nome: 'João Pereira',  foto_url: '' },
      { id: 'prof-3', nome: 'Julio Santos',  foto_url: '' },
      { id: 'prof-4', nome: 'Ana Costa',     foto_url: '' }
    ],
    profServicos: {
      'srv-1': ['prof-1','prof-2','prof-3'],
      'srv-2': ['prof-1','prof-3'],
      'srv-3': ['prof-4'],
      'srv-4': ['prof-4'],
      'srv-5': ['prof-2','prof-4'],
      'srv-6': ['prof-1','prof-3'],
      'srv-7': ['prof-1'],
      'srv-8': ['prof-2','prof-4']
    },
    agendamentos: [
      { profissional_id: 'prof-1', data: todayISO(),  hora: '10:00', duracao_total: 60 },
      { profissional_id: 'prof-2', data: todayISO(),  hora: '14:30', duracao_total: 45 },
      { profissional_id: 'prof-3', data: todayISO(1), hora: '09:00', duracao_total: 120 }
    ]
  };

  /* ============================================================
     3. TENANT DATA SERVICE — usa tabelas REAIS do schema
     ============================================================ */
  var REQ_TIMEOUT = 6000; // 6s — qualquer requisição que passar disso falha graceful

  var TenantDataService = {
    tenantId: null,
    usingMock: false,

    /**
     * Carrega dados do tenant + tenant_settings.
     * Retorna { habilitado:false } se feature flag desligada.
     */
    async carregarTenant(tenantId) {
      this.tenantId = tenantId;
      var sb = initSupabase();

      if (!sb || !tenantId) {
        this.usingMock = true;
        return Object.assign({}, MOCK.tenant, { tenant_id: tenantId || 'mock' });
      }

      try {
        console.log('[ac] carregarTenant: tentando RPC pública para tenantId=', tenantId);
        var rpcResp = await withTimeout(
          sb.rpc('get_public_booking_tenant', { _tenant_id: tenantId }),
          REQ_TIMEOUT,
          'rpc:get_public_booking_tenant'
        );

        var rpcRow = Array.isArray(rpcResp && rpcResp.data) ? rpcResp.data[0] : (rpcResp && rpcResp.data);
        if (!rpcResp.error && rpcRow) {
          console.log('[ac] carregarTenant: RPC pública OK');
          return {
            tenant_id: rpcRow.id || tenantId,
            nome: rpcRow.nome_fantasia || rpcRow.nome || 'Estabelecimento',
            endereco: rpcRow.endereco || '',
            logo_url: rpcRow.logo_url || '',
            cover_url: rpcRow.cover_url || '',
            habilitado: !!rpcRow.permitir_agendamento_cliente,
            horario_inicio: String(rpcRow.horario_inicio || '09:00:00').slice(0, 5),
            horario_fim: String(rpcRow.horario_fim || '19:00:00').slice(0, 5),
            // Novo: horários por dia da semana (jsonb). Pode vir nulo se a RPC for antiga.
            horarios_semanais: rpcRow.horarios_semanais || null,
            slot_minutos: Number(rpcRow.slot_minutos || 15)
          };
        }

        console.warn('[ac] carregarTenant: RPC indisponível ou sem retorno; tentando fallback por tabelas');

        var results = await Promise.all([
          withTimeout(
            sb.from('tenants')
              .select('id, nome, nome_fantasia, logo_url')
              .eq('id', tenantId)
              .maybeSingle(),
            REQ_TIMEOUT, 'tenants'
          ),
          withTimeout(
            sb.from('tenant_settings')
              .select('permitir_agendamento_cliente, horario_inicio, horario_fim, slot_minutos, horarios_semanais')
              .eq('tenant_id', tenantId)
              .maybeSingle(),
            REQ_TIMEOUT, 'tenant_settings'
          )
        ]);

        var tenantRow = results[0] && results[0].data;
        var settingsRow = results[1] && results[1].data;
        console.log('[ac] carregarTenant: tenantRow=', tenantRow, 'settingsRow=', settingsRow);

        if (!tenantRow) {
          console.warn('[ac] tenant não encontrado no banco — testando se é RLS...');
          try {
            var diag = await withTimeout(
              sb.from('tenants').select('id', { count: 'exact', head: true }),
              REQ_TIMEOUT, 'tenants-count'
            );
            console.warn('[ac] DIAG: SELECT count(*) em tenants retornou count=', diag.count, 'error=', diag.error);
            if (diag.count === 0) {
              console.warn('[ac] DIAG: RLS está bloqueando leitura anônima da tabela `tenants`. Instale as RPCs públicas do fluxo de agendamento.');
            } else if (diag.count > 0) {
              console.warn('[ac] DIAG: leitura funciona, mas o tenantId', tenantId, 'não existe na tabela.');
            }
          } catch (e) { console.warn('[ac] DIAG falhou:', e); }
          return null;
        }

        var habilitado = !!(settingsRow && settingsRow.permitir_agendamento_cliente === true);
        return {
          tenant_id: tenantRow.id,
          nome: tenantRow.nome_fantasia || tenantRow.nome || 'Estabelecimento',
          endereco: '',
          logo_url: tenantRow.logo_url || '',
          cover_url: '',
          habilitado: habilitado,
          horario_inicio: (settingsRow && String(settingsRow.horario_inicio || '09:00:00').slice(0,5)) || '09:00',
          horario_fim: (settingsRow && String(settingsRow.horario_fim || '19:00:00').slice(0,5)) || '19:00',
          horarios_semanais: (settingsRow && settingsRow.horarios_semanais) || null,
          slot_minutos: (settingsRow && settingsRow.slot_minutos) || 15
        };
      } catch (e) {
        console.error('[ac] carregarTenant falhou:', e && e.message);
        return null;
      }
    },

    /* ============================================================
       IMAGENS DO CARROSSEL (tabela public.tenant_images)
       Retorna [] em qualquer falha (fallback gracioso = gradiente).
       ============================================================ */
    async getTenantImages(tenantId) {
      if (this.usingMock) {
        return [
          { id: 'm1', image_url: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1200&q=80', order: 0 },
          { id: 'm2', image_url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&q=80', order: 1 },
          { id: 'm3', image_url: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=1200&q=80', order: 2 }
        ];
      }
      var sb = initSupabase();
      if (!sb || !tenantId) return [];
      try {
        var resp = await withTimeout(
          sb.from('tenant_images')
            .select('id, image_url, "order"')
            .eq('tenant_id', tenantId)
            .order('order', { ascending: true })
            .limit(10),
          REQ_TIMEOUT,
          'tenant_images'
        );
        if (resp.error) {
          console.warn('[ac] getTenantImages erro:', resp.error.message);
          return [];
        }
        return (resp.data || []).filter(function (r) { return !!r.image_url; });
      } catch (e) {
        console.warn('[ac] getTenantImages falhou:', e && e.message);
        return [];
      }
    },

    async listarServicos() {
      if (this.usingMock) return MOCK.servicos.slice();
      var sb = initSupabase();
      try {
        var rpcResp = await withTimeout(
          sb.rpc('get_public_booking_services', { _tenant_id: this.tenantId }),
          REQ_TIMEOUT,
          'rpc:get_public_booking_services'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          return rpcResp.data.map(function (row) {
            return { id: row.id, nome: row.nome, descricao: row.descricao || '', preco: Number(row.preco || 0), duracao: Number(row.duracao || 30) };
          });
        }

        var r = await withTimeout(
          sb.from('servicos')
            .select('id, nome, preco, duracao, ativo')
            .eq('tenant_id', this.tenantId)
            .eq('ativo', true)
            .order('nome', { ascending: true }),
          REQ_TIMEOUT, 'servicos'
        );
        if (r.error) { console.warn('[ac] listarServicos error', r.error); return []; }
        return (r.data || []).map(function (s) {
          return { id: s.id, nome: s.nome, descricao: '', preco: Number(s.preco || 0), duracao: Number(s.duracao || 30) };
        });
      } catch (e) {
        console.error('[ac] listarServicos timeout/erro', e && e.message);
        return [];
      }
    },

    async listarProfissionais(servicoId) {
      if (this.usingMock) {
        var ids = MOCK.profServicos[servicoId] || MOCK.profissionais.map(function (p) { return p.id; });
        return MOCK.profissionais.filter(function (p) { return ids.indexOf(p.id) >= 0; });
      }
      var sb = initSupabase();
      try {
        var rpcResp = await withTimeout(
          sb.rpc('get_public_booking_professionals', { _tenant_id: this.tenantId, _servico_id: servicoId }),
          REQ_TIMEOUT,
          'rpc:get_public_booking_professionals'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          return rpcResp.data.map(function (p) {
            return { id: p.id, nome: p.nome, foto_url: p.foto_url || '' };
          });
        }

        var rPS = await withTimeout(
          sb.from('profissional_servicos')
            .select('profissional_id')
            .eq('tenant_id', this.tenantId)
            .eq('servico_id', servicoId),
          REQ_TIMEOUT, 'profissional_servicos'
        );
        if (rPS.error) { console.warn('[ac] profissional_servicos error', rPS.error); return []; }
        var profIds = (rPS.data || []).map(function (x) { return x.profissional_id; });
        if (profIds.length === 0) return [];

        var rP = await withTimeout(
          sb.from('profissionais')
            .select('id, nome, foto_url, ativo')
            .eq('tenant_id', this.tenantId)
            .eq('ativo', true)
            .in('id', profIds)
            .order('nome', { ascending: true }),
          REQ_TIMEOUT, 'profissionais'
        );
        if (rP.error) { console.warn('[ac] profissionais error', rP.error); return []; }
        return (rP.data || []).map(function (p) {
          return { id: p.id, nome: p.nome, foto_url: p.foto_url || '' };
        });
      } catch (e) {
        console.error('[ac] listarProfissionais timeout/erro', e && e.message);
        return [];
      }
    },

    async listarAgendamentosDoDia(dataISO, profissionalIds) {
      if (this.usingMock) {
        return MOCK.agendamentos.filter(function (a) {
          return a.data === dataISO && profissionalIds.indexOf(a.profissional_id) >= 0;
        });
      }
      if (!profissionalIds || profissionalIds.length === 0) return [];
      var sb = initSupabase();
      try {
        var rpcResp = await withTimeout(
          sb.rpc('get_public_busy_slots', {
            _tenant_id: this.tenantId,
            _data: dataISO,
            _profissional_ids: profissionalIds
          }),
          REQ_TIMEOUT,
          'rpc:get_public_busy_slots'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          var ocupRpc = rpcResp.data.map(function (a) {
            return {
              profissional_id: a.profissional_id,
              hora: String(a.hora).slice(0, 5),
              duracao_total: Number(a.duracao_total || 30)
            };
          });
          var blqRpc = await fetchBloqueiosClienteAsOcupacoes(sb, this.tenantId, dataISO, profissionalIds);
          return ocupRpc.concat(blqRpc);
        }

        var rA = await withTimeout(
          sb.from('agendamentos')
            .select('id, profissional_id, hora, status')
            .eq('tenant_id', this.tenantId)
            .eq('data', dataISO)
            .in('profissional_id', profissionalIds)
            .neq('status', 'cancelado'),
          REQ_TIMEOUT, 'agendamentos'
        );
        if (rA.error || !rA.data) return [];
        if (rA.data.length === 0) return [];

        var ids = rA.data.map(function (a) { return a.id; });
        var rS = await withTimeout(
          sb.from('agendamento_servicos')
            .select('agendamento_id, duracao')
            .in('agendamento_id', ids),
          REQ_TIMEOUT, 'agendamento_servicos'
        );
        var durMap = {};
        if (!rS.error && rS.data) {
          rS.data.forEach(function (row) {
            durMap[row.agendamento_id] = (durMap[row.agendamento_id] || 0) + Number(row.duracao || 0);
          });
        }
        var ocupFb = rA.data.map(function (a) {
          return {
            profissional_id: a.profissional_id,
            hora: String(a.hora).slice(0, 5),
            duracao_total: durMap[a.id] || 30
          };
        });
        var blqFb = await fetchBloqueiosClienteAsOcupacoes(sb, this.tenantId, dataISO, profissionalIds);
        return ocupFb.concat(blqFb);
      } catch (e) {
        console.error('[ac] listarAgendamentosDoDia timeout/erro', e && e.message);
        return [];
      }
    },

    async listarRecomendacoes(servicoId) {
      if (this.usingMock) return [];
      var sb = initSupabase();
      if (!sb || !servicoId) return [];
      try {
        // RPC pública (preferida)
        var rpcResp = await withTimeout(
          sb.rpc('get_public_service_recommendations', { _tenant_id: this.tenantId, _servico_id: servicoId }),
          REQ_TIMEOUT, 'rpc:get_public_service_recommendations'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          return rpcResp.data.map(function (r) {
            return { id: r.id, nome: r.nome, preco: Number(r.preco || 0), duracao: Number(r.duracao || 30) };
          });
        }
        console.warn('[ac] RPC recomendações indisponível, tentando fallback', rpcResp.error && rpcResp.error.message);
      } catch (e) {
        console.warn('[ac] listarRecomendacoes timeout/erro', e && e.message);
      }
      // Fallback (pode falhar se RLS não permitir leitura anônima)
      try {
        var sb2 = initSupabase();
        var r = await withTimeout(
          sb2.from('service_recommendations')
            .select('recommended_service_id, servicos!service_recommendations_rec_service_fkey(id, nome, preco, duracao, ativo)')
            .eq('tenant_id', this.tenantId)
            .eq('service_id', servicoId),
          REQ_TIMEOUT, 'service_recommendations'
        );
        if (r.error) return [];
        return (r.data || [])
          .map(function (row) { return row.servicos; })
          .filter(function (s) { return s && s.ativo !== false; })
          .map(function (s) { return { id: s.id, nome: s.nome, preco: Number(s.preco || 0), duracao: Number(s.duracao || 30) }; });
      } catch (e) { return []; }
    },

    async criarAgendamento(payload) {
      if (this.usingMock) {
        MOCK.agendamentos.push({
          profissional_id: payload.profissional_id, data: payload.data,
          hora: payload.hora, duracao_total: payload.duracao
        });
        return 'mock-' + Date.now();
      }
      var sb = initSupabase();

      try {
        var rpcResp = await withTimeout(
          sb.rpc('create_public_booking', {
            _tenant_id: this.tenantId,
            _cliente_nome: payload.cliente_nome,
            _cliente_telefone: payload.cliente_telefone,
            _servico_id: payload.servico_id,
            _profissional_id: payload.profissional_id,
            _data: payload.data,
            _hora: payload.hora,
            _duracao: payload.duracao,
            _preco: payload.preco
          }),
          REQ_TIMEOUT,
          'rpc:create_public_booking'
        );
        if (!rpcResp.error && rpcResp.data) {
          var agId = Array.isArray(rpcResp.data) ? rpcResp.data[0] : rpcResp.data;
          // Inserir serviços extras (recomendados aceitos) — RPC só cria o principal
          if (agId && Array.isArray(payload.servicos_extras) && payload.servicos_extras.length > 0) {
            try {
              var extraRows = payload.servicos_extras.map(function (ex) {
                return {
                  tenant_id: this.tenantId,
                  agendamento_id: agId,
                  servico_id: ex.id,
                  profissional_id: payload.profissional_id,
                  preco: ex.preco,
                  duracao: ex.duracao
                };
              }.bind(this));
              await sb.from('agendamento_servicos').insert(extraRows);
            } catch (exErr) {
              console.warn('[ac] falha ao inserir serviços extras (upsell):', exErr && exErr.message);
            }
          }
          return agId;
        }
        // Se a RPC retornou um erro de regra de negócio, NÃO tentar fallback (evita bypass)
        if (rpcResp.error) {
          var msg = String(rpcResp.error.message || '');
          if (msg.indexOf('CLIENTE_NOME_DIVERGENTE') >= 0) {
            // Formato esperado: "CLIENTE_NOME_DIVERGENTE:Nome Existente"
            var nomeExistente = msg.split('CLIENTE_NOME_DIVERGENTE:')[1] || '';
            nomeExistente = nomeExistente.split('\n')[0].trim();
            throw new Error('Cliente já cadastrado com este telefone' + (nomeExistente ? ': ' + nomeExistente : '.'));
          }
          // Outros erros da RPC: tenta fallback abaixo
          console.warn('[ac] create_public_booking RPC erro; tentando fallback por tabelas', msg);
        }
      } catch (rpcErr) {
        // Repropaga erros de regra de negócio
        if (rpcErr && /Cliente já cadastrado com este telefone/.test(rpcErr.message || '')) {
          throw rpcErr;
        }
        console.warn('[ac] create_public_booking RPC indisponível; tentando fallback por tabelas', rpcErr && rpcErr.message);
      }

      var clienteId = null;
      try {
        var rExist = await withTimeout(
          sb.from('clientes')
            .select('id, nome')
            .eq('tenant_id', this.tenantId)
            .eq('telefone', payload.cliente_telefone)
            .maybeSingle(),
          REQ_TIMEOUT, 'clientes-find'
        );
        if (rExist.data && rExist.data.id) {
          // Telefone já existe: validar nome SEM sobrescrever em hipótese alguma
          var nomeExistente = rExist.data.nome || '';
          if (normalizeName(nomeExistente) !== normalizeName(payload.cliente_nome)) {
            throw new Error('Cliente já cadastrado com este telefone: ' + nomeExistente);
          }
          clienteId = rExist.data.id;
        } else {
          var rIns = await withTimeout(
            sb.from('clientes').insert({
              tenant_id: this.tenantId,
              nome: payload.cliente_nome,
              telefone: payload.cliente_telefone
            }).select('id').single(),
            REQ_TIMEOUT, 'clientes-insert'
          );
          if (rIns.error) throw rIns.error;
          clienteId = rIns.data.id;
        }
      } catch (e) {
        // Preservar mensagem amigável da regra de unicidade
        if (e && /Cliente já cadastrado com este telefone/.test(e.message || '')) {
          throw e;
        }
        throw new Error('Falha ao registrar cliente: ' + (e.message || e));
      }

      var rAg = await withTimeout(
        sb.from('agendamentos').insert({
          tenant_id: this.tenantId,
          cliente_id: clienteId,
          cliente_nome: payload.cliente_nome,
          cliente_telefone: payload.cliente_telefone,
          profissional_id: payload.profissional_id,
          data: payload.data,
          hora: payload.hora,
          status: 'agendado'
        }).select('id').single(),
        REQ_TIMEOUT, 'agendamentos-insert'
      );
      if (rAg.error) throw rAg.error;

      var asRows = [{
        tenant_id: this.tenantId,
        agendamento_id: rAg.data.id,
        servico_id: payload.servico_id,
        profissional_id: payload.profissional_id,
        preco: payload.preco,
        duracao: payload.duracao
      }];
      if (Array.isArray(payload.servicos_extras)) {
        payload.servicos_extras.forEach(function (ex) {
          asRows.push({
            tenant_id: this.tenantId,
            agendamento_id: rAg.data.id,
            servico_id: ex.id,
            profissional_id: payload.profissional_id,
            preco: ex.preco,
            duracao: ex.duracao
          });
        }.bind(this));
      }
      var rAS = await withTimeout(
        sb.from('agendamento_servicos').insert(asRows),
        REQ_TIMEOUT, 'agendamento_servicos-insert'
      );
      if (rAS.error) throw rAS.error;

      return rAg.data.id;
    }
  };

  /* ============================================================
     4. RODÍZIO (round-robin) por tenant
     ============================================================ */
  var Rodizio = {
    key: function () { return 'ac_rotation_queue:' + (TenantDataService.tenantId || 'default'); },
    pick: function (allIds, availableIds) {
      var queue;
      try { queue = JSON.parse(localStorage.getItem(this.key()) || '[]'); } catch (e) { queue = []; }
      allIds.forEach(function (id) { if (queue.indexOf(id) < 0) queue.push(id); });
      queue = queue.filter(function (id) { return allIds.indexOf(id) >= 0; });
      for (var i = 0; i < queue.length; i++) {
        if (availableIds.indexOf(queue[i]) >= 0) {
          var chosen = queue[i];
          queue.splice(i, 1); queue.push(chosen);
          try { localStorage.setItem(this.key(), JSON.stringify(queue)); } catch (e) {}
          return chosen;
        }
      }
      return availableIds[0] || null;
    }
  };

  /* ============================================================
     5. ESTADO
     ============================================================ */
  var state = {
    step: 1,
    tenant: null,
    servicos: [],
    profissionais: [],
    selectedServico: null,
    selectedProfissional: null,
    selectedDate: null,
    selectedSlot: null,
    autoChosenProf: null,
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    ocupacoesCache: [],
    recomendacoes: [],      // serviços sugeridos para o serviço atual
    acceptedUpsells: []     // serviços extras aceitos pelo cliente
  };

  /* ============================================================
     6. CÁLCULO DE SLOTS
     ============================================================ */

  /* Mapeia ISO 'YYYY-MM-DD' (ou Date) para o horário daquele dia da semana,
     respeitando state.tenant.horarios_semanais (jsonb).
     Retorna { ativo, inicio, fim }. Fallback = horario_inicio/fim "globais". */
  var DIA_KEYS_AC = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
  function getHorarioForDate(isoOrDate) {
    var dt;
    if (isoOrDate instanceof Date) {
      dt = isoOrDate;
    } else {
      var p = String(isoOrDate).split('-');
      dt = new Date(parseInt(p[0],10), parseInt(p[1],10) - 1, parseInt(p[2],10));
    }
    var dow = dt.getDay();
    var fbInicio = (state.tenant && state.tenant.horario_inicio) || '09:00';
    var fbFim    = (state.tenant && state.tenant.horario_fim)    || '19:00';
    var hs = state.tenant && state.tenant.horarios_semanais;
    if (!hs) {
      return { ativo: true, inicio: fbInicio, fim: fbFim };
    }
    var key = DIA_KEYS_AC[dow];
    var d = hs[key];
    if (!d) return { ativo: true, inicio: fbInicio, fim: fbFim };
    return {
      ativo: d.ativo !== false,
      inicio: d.inicio ? String(d.inicio).slice(0,5) : fbInicio,
      fim:    d.fim    ? String(d.fim).slice(0,5)    : fbFim
    };
  }

  function buildAllSlots(horarioDia) {
    var hd = horarioDia || (state.selectedDate ? getHorarioForDate(state.selectedDate) : { inicio: state.tenant.horario_inicio, fim: state.tenant.horario_fim, ativo: true });
    if (!hd.ativo) return [];
    var hi = parseInt(String(hd.inicio || '09:00').split(':')[0], 10);
    var hfStr = String(hd.fim || '19:00').split(':');
    var hf = parseInt(hfStr[0], 10);
    if (parseInt(hfStr[1] || '0', 10) > 0) hf = hf + 1; // engloba 18:30 → vai até 19
    var step = state.tenant.slot_minutos || 15;
    var slots = [];
    for (var h = hi; h < hf; h++) {
      for (var m = 0; m < 60; m += step) slots.push(pad(h) + ':' + pad(m));
    }
    return slots;
  }
  function slotToMinutes(hhmm) { var p = hhmm.split(':'); return parseInt(p[0],10)*60 + parseInt(p[1],10); }
  function isProfFree(profId, slot, duracao, ocupacoes, horarioDia) {
    var inicio = slotToMinutes(slot), fim = inicio + duracao;
    var hd = horarioDia || (state.selectedDate ? getHorarioForDate(state.selectedDate) : { fim: state.tenant.horario_fim, ativo: true });
    if (!hd.ativo) return false;
    var fimParts = String(hd.fim || '19:00').split(':');
    var fimExp = parseInt(fimParts[0], 10) * 60 + parseInt(fimParts[1] || '0', 10);
    if (fim > fimExp) return false;
    return !ocupacoes.filter(function (a) { return a.profissional_id === profId; })
      .some(function (a) {
        var oi = slotToMinutes(a.hora), of = oi + (a.duracao_total || 30);
        return inicio < of && fim > oi;
      });
  }
  function profsLivresNoSlot(slot, duracao, ocupacoes, candidatos, horarioDia) {
    return candidatos.filter(function (p) { return isProfFree(p.id, slot, duracao, ocupacoes, horarioDia); });
  }

  /* ============================================================
     7. RENDER: Header / Serviços / Profissionais / Calendário / Slots
     ============================================================ */
  function renderTenant() {
    console.log('[ac] renderTenant: inicio');
    var nomeEl = $('#ac-tenant-nome');
    if (nomeEl) nomeEl.textContent = state.tenant.nome;
    else console.warn('[ac] renderTenant: #ac-tenant-nome ausente');

    var endSpan = $('#ac-tenant-endereco span') || $('#ac-tenant-endereco');
    if (endSpan) endSpan.textContent = state.tenant.endereco || '';

    var logoEl = $('#ac-logo-wrap');
    if (logoEl) {
      if (state.tenant.logo_url) {
        logoEl.innerHTML = '<img src="' + escapeHtml(state.tenant.logo_url) + '" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">';
      } else {
        logoEl.textContent = avatarInitials(state.tenant.nome);
      }
    } else {
      console.warn('[ac] renderTenant: #ac-logo-wrap ausente');
    }

    var coverEl = $('#ac-cover');
    if (coverEl && state.tenant.cover_url) {
      coverEl.src = state.tenant.cover_url;
    } else if (!coverEl) {
      console.warn('[ac] renderTenant: #ac-cover ausente (ok, ignorando)');
    }

    // Carrossel de imagens (tenant_images). Não bloqueia o restante.
    initCarousel();

    console.log('[ac] renderTenant: fim');
  }

  /* ============================================================
     7.b CARROSSEL DO HEADER
     - Auto-play 4s
     - Prev/Next + dots
     - Swipe touch (mobile)
     - Pausa ao interagir; retoma após 8s
     - Fallback: vazio = gradiente padrão (oculta o carrossel)
     ============================================================ */
  var Carousel = (function () {
    var images = [];
    var idx = 0;
    var timer = null;
    var resumeTimer = null;
    var AUTOPLAY_MS = 4000;
    var RESUME_MS = 8000;

    function el(id) { return document.getElementById(id); }

    function render() {
      var root  = el('ac-carousel');
      var track = el('ac-carousel-track');
      var dots  = el('ac-carousel-dots');
      var prev  = el('ac-carousel-prev');
      var next  = el('ac-carousel-next');
      var legacyCover = el('ac-cover');
      if (!root || !track || !dots) return;

      if (!images.length) {
        root.setAttribute('data-empty', 'true');
        track.innerHTML = '';
        dots.innerHTML = '';
        if (prev) prev.hidden = true;
        if (next) next.hidden = true;
        return;
      }
      root.setAttribute('data-empty', 'false');
      // Quando há imagens novas, esconde a img legada de cover
      if (legacyCover) { legacyCover.removeAttribute('src'); legacyCover.style.display = 'none'; }

      track.innerHTML = images.map(function (im) {
        return '<li><img src="' + escapeHtml(im.image_url) + '" alt="" loading="lazy" /></li>';
      }).join('');

      dots.innerHTML = images.map(function (_, i) {
        return '<button type="button" class="ac-carousel-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '" aria-label="Imagem ' + (i + 1) + '"></button>';
      }).join('');

      var multi = images.length > 1;
      if (prev) prev.hidden = !multi;
      if (next) next.hidden = !multi;

      idx = 0;
      apply(false);
    }

    function apply(animate) {
      var track = el('ac-carousel-track');
      var dots  = el('ac-carousel-dots');
      if (!track) return;
      track.style.transition = animate === false ? 'none' : '';
      track.style.transform = 'translateX(' + (-idx * 100) + '%)';
      if (dots) {
        Array.prototype.forEach.call(dots.children, function (d, i) {
          d.classList.toggle('active', i === idx);
        });
      }
      if (animate === false) {
        // força reflow para re-habilitar transição
        void track.offsetWidth;
        track.style.transition = '';
      }
    }

    function go(delta) {
      if (images.length < 2) return;
      idx = (idx + delta + images.length) % images.length;
      apply(true);
    }
    function goTo(i) {
      if (images.length < 2) return;
      idx = ((i % images.length) + images.length) % images.length;
      apply(true);
    }

    function startAuto() {
      stopAuto();
      if (images.length < 2) return;
      timer = setInterval(function () { go(1); }, AUTOPLAY_MS);
    }
    function stopAuto() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    function pauseAndResume() {
      stopAuto();
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startAuto, RESUME_MS);
    }

    function bind() {
      var root = el('ac-carousel');
      var prev = el('ac-carousel-prev');
      var next = el('ac-carousel-next');
      var dots = el('ac-carousel-dots');
      if (!root || root.dataset.bound === '1') return;
      root.dataset.bound = '1';

      if (prev) prev.addEventListener('click', function () { go(-1); pauseAndResume(); });
      if (next) next.addEventListener('click', function () { go(1);  pauseAndResume(); });
      if (dots) dots.addEventListener('click', function (e) {
        var b = e.target.closest('.ac-carousel-dot'); if (!b) return;
        goTo(parseInt(b.getAttribute('data-i'), 10) || 0);
        pauseAndResume();
      });

      // Swipe touch
      var startX = null, dx = 0;
      root.addEventListener('touchstart', function (e) {
        if (!e.touches || !e.touches[0]) return;
        startX = e.touches[0].clientX; dx = 0; stopAuto();
      }, { passive: true });
      root.addEventListener('touchmove', function (e) {
        if (startX == null) return;
        dx = e.touches[0].clientX - startX;
      }, { passive: true });
      root.addEventListener('touchend', function () {
        if (startX == null) return;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        startX = null; dx = 0;
        pauseAndResume();
      });

      // Pausa quando aba fica oculta
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopAuto(); else startAuto();
      });
    }

    function setImages(list) {
      images = Array.isArray(list) ? list.slice(0, 10) : [];
      bind();
      render();
      startAuto();
    }

    return { setImages: setImages };
  })();

  function initCarousel() {
    var tid = state.tenant && state.tenant.tenant_id;
    TenantDataService.getTenantImages(tid).then(function (imgs) {
      console.log('[ac] carrossel: imagens =', imgs.length);
      Carousel.setImages(imgs || []);
    }).catch(function (e) {
      console.warn('[ac] carrossel falhou:', e);
      Carousel.setImages([]);
    });
  }

  function renderServicos(filter) {
    console.log('[ac] renderServicos: inicio, total=', state.servicos.length, 'filter=', filter);
    var list = $('#ac-servicos-list');
    var empty = $('#ac-servicos-empty');
    if (!list) {
      console.error('[ac] renderServicos: #ac-servicos-list NAO existe no DOM — abortando');
      return;
    }
    if (!empty) {
      console.warn('[ac] renderServicos: #ac-servicos-empty ausente — criando placeholder');
      empty = document.createElement('div');
      empty.id = 'ac-servicos-empty';
      empty.hidden = true;
      empty.innerHTML = '<p>Nenhum servico encontrado</p>';
      list.parentNode && list.parentNode.appendChild(empty);
    }
    var term = (filter || '').trim().toLowerCase();
    var rows = (state.servicos || []).filter(function (s) {
      if (!term) return true;
      return (s.nome || '').toLowerCase().indexOf(term) >= 0
          || (s.descricao || '').toLowerCase().indexOf(term) >= 0;
    });
    console.log('[ac] renderServicos: rows apos filtro=', rows.length);
    if (rows.length === 0) { list.innerHTML = ''; empty.hidden = false; console.log('[ac] renderServicos: nenhum resultado'); return; }
    empty.hidden = true;
    list.innerHTML = rows.map(function (s) {
      return '<article class="ac-servico-card" data-servico-id="' + escapeHtml(s.id) + '">' +
        '<div class="ac-servico-info">' +
          '<h3 class="ac-servico-nome">' + escapeHtml(s.nome) + '</h3>' +
          (s.descricao ? '<p class="ac-servico-desc">' + escapeHtml(s.descricao) + '</p>' : '') +
          '<div class="ac-servico-meta">' +
            '<span class="price">' + brl(s.preco) + '</span>' +
            '<span class="dur"><i class="far fa-clock"></i> ' + formatDuracao(s.duracao) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ac-servico-action"><button type="button" class="ac-btn-agendar">Agendar</button></div>' +
      '</article>';
    }).join('');
    $$('.ac-servico-card', list).forEach(function (card) {
      card.addEventListener('click', function () {
        selectServico(card.getAttribute('data-servico-id'));
      });
    });
    console.log('[ac] renderServicos: fim — cards renderizados=', rows.length);
  }

  function renderProfissionais() {
    var grid = $('#ac-prof-grid');
    $('#ac-prof-sub').textContent = 'Para o serviço: ' + state.selectedServico.nome;
    var html = '<button type="button" class="ac-prof-card" data-prof-id="__no_pref__">' +
      '<div class="ac-prof-avatar no-pref"><i class="fas fa-user-friends"></i></div>' +
      '<div class="ac-prof-nome">Sem preferência</div>' +
      '<div class="ac-prof-tag">Atribuição automática</div>' +
    '</button>';
    state.profissionais.forEach(function (p) {
      var avatar = p.foto_url
        ? '<img src="' + escapeHtml(p.foto_url) + '" alt="' + escapeHtml(p.nome) + '">'
        : avatarInitials(p.nome);
      html += '<button type="button" class="ac-prof-card" data-prof-id="' + escapeHtml(p.id) + '">' +
        '<div class="ac-prof-avatar">' + avatar + '</div>' +
        '<div class="ac-prof-nome">' + escapeHtml(p.nome) + '</div>' +
      '</button>';
    });
    grid.innerHTML = html;
    $$('.ac-prof-card', grid).forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.ac-prof-card', grid).forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        var id = btn.getAttribute('data-prof-id');
        if (id === '__no_pref__') {
          state.selectedProfissional = { id: '__no_pref__', nome: 'Sem preferência' };
        } else {
          state.selectedProfissional = state.profissionais.filter(function (p) { return p.id === id; })[0];
        }
        setTimeout(function () { goToStep(3); }, 200);
      });
    });
  }

  function renderCalendar() {
    var months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    $('#ac-cal-month').textContent = months[state.calMonth] + ' ' + state.calYear;
    var cal = $('#ac-calendar');
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    var dows = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    var todayD = new Date(); todayD.setHours(0,0,0,0);
    var html = '';
    for (var d = 1; d <= daysInMonth; d++) {
      var dt = new Date(state.calYear, state.calMonth, d);
      var iso = state.calYear + '-' + pad(state.calMonth+1) + '-' + pad(d);
      var dow = dows[dt.getDay()];
      // Dia desabilitado se: passado OU estabelecimento fechado naquele dia da semana
      var horarioDow = getHorarioForDate(dt);
      var fechadoNoDow = !horarioDow.ativo;
      var disabled = (dt < todayD || fechadoNoDow) ? 'disabled' : '';
      var closedCls = fechadoNoDow ? 'ac-cal-closed' : '';
      var isToday = dt.getTime() === todayD.getTime() ? 'today' : '';
      var sel = state.selectedDate === iso ? 'selected' : '';
      var title = fechadoNoDow ? ' title="Fechado neste dia"' : '';
      html += '<button type="button" class="ac-cal-day ' + disabled + ' ' + closedCls + ' ' + isToday + ' ' + sel + '" data-date="' + iso + '"' + title + '>' +
        '<span class="dow">' + dow + '</span><span class="num">' + d + '</span></button>';
    }
    cal.innerHTML = html;
    $$('.ac-cal-day:not(.disabled)', cal).forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.ac-cal-day', cal).forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        state.selectedDate = btn.getAttribute('data-date');
        renderSlots();
      });
    });
    var target = $('.ac-cal-day.selected', cal) || $('.ac-cal-day.today', cal) || $('.ac-cal-day:not(.disabled)', cal);
    if (target) cal.scrollLeft = Math.max(0, target.offsetLeft - 16);
  }

  async function renderSlots() {
    var wrap = $('#ac-slots'), empty = $('#ac-slots-empty');
    if (!state.selectedDate) { wrap.innerHTML = ''; empty.hidden = false; return; }

    // Se o estabelecimento estiver fechado neste dia da semana → bloqueia
    var horarioDia = getHorarioForDate(state.selectedDate);
    if (!horarioDia.ativo) {
      wrap.innerHTML = '';
      empty.hidden = false;
      var msgEl = empty.querySelector('p');
      if (msgEl) msgEl.textContent = 'Estabelecimento fechado neste dia. Escolha outra data.';
      return;
    }

    var servico = state.selectedServico;
    var prof = state.selectedProfissional;
    var candidatos = prof.id === '__no_pref__' ? state.profissionais : [prof];
    var candidatoIds = candidatos.map(function (c) { return c.id; });

    wrap.innerHTML = '<div class="ac-loading"><i class="fas fa-spinner fa-spin"></i> Carregando horários...</div>';

    var ocup = await TenantDataService.listarAgendamentosDoDia(state.selectedDate, candidatoIds);
    state.ocupacoesCache = ocup;

    var allSlots = buildAllSlots(horarioDia);
    var hoje = new Date(); hoje.setSeconds(0,0);
    var isHoje = state.selectedDate === todayISO();
    var manha = [], tarde = [];
    allSlots.forEach(function (slot) {
      var livres = profsLivresNoSlot(slot, servico.duracao, ocup, candidatos, horarioDia);
      var disponivel = livres.length > 0;
      if (isHoje) {
        var slotDate = new Date(state.selectedDate + 'T' + slot + ':00');
        if (slotDate <= hoje) disponivel = false;
      }
      var item = { slot: slot, disponivel: disponivel };
      var hora = parseInt(slot.split(':')[0], 10);
      if (hora < 12) manha.push(item); else tarde.push(item);
    });
    var hasAnyM = manha.some(function (s) { return s.disponivel; });
    var hasAnyT = tarde.some(function (s) { return s.disponivel; });
    if (!hasAnyM && !hasAnyT) {
      wrap.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').textContent = 'Nenhum horário disponível para esta data';
      return;
    }
    empty.hidden = true;
    function renderPeriod(title, icon, items) {
      if (items.length === 0) return '';
      return '<div class="ac-period">' +
        '<div class="ac-period-title"><i class="' + icon + '"></i> ' + title + '</div>' +
        '<div class="ac-slots-grid">' +
          items.map(function (it) {
            return '<button type="button" class="ac-slot ' + (it.disponivel ? '' : 'unavailable') + '" data-slot="' + it.slot + '">' + it.slot + '</button>';
          }).join('') +
        '</div></div>';
    }
    wrap.innerHTML = renderPeriod('Manhã', 'fas fa-sun', manha) + renderPeriod('Tarde', 'fas fa-cloud-sun', tarde);
    $$('.ac-slot:not(.unavailable)', wrap).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedSlot = btn.getAttribute('data-slot');
        openConfirmModal();
      });
    });
  }

  /* ============================================================
     8. MODAL DE CONFIRMAÇÃO
     ============================================================ */
  function openConfirmModal() {
    var servico = state.selectedServico;
    var prof = state.selectedProfissional;
    var slot = state.selectedSlot;
    var profExibido = prof;
    state.autoChosenProf = null;

    if (prof.id === '__no_pref__') {
      var livres = profsLivresNoSlot(slot, servico.duracao, state.ocupacoesCache, state.profissionais);
      if (livres.length === 0) { showToast('Nenhum profissional disponível neste horário.', 'error'); return; }
      var allIds = state.profissionais.map(function (p) { return p.id; });
      var availableIds = livres.map(function (p) { return p.id; });
      var chosenId = Rodizio.pick(allIds, availableIds);
      var escolhido = state.profissionais.filter(function (p) { return p.id === chosenId; })[0] || livres[0];
      state.autoChosenProf = escolhido;
      profExibido = { id: escolhido.id, nome: escolhido.nome + ' (atribuído automaticamente)' };
    }

    var extras = state.acceptedUpsells || [];
    var nomeServico = servico.nome;
    var totalDuracao = servico.duracao;
    var totalPreco   = Number(servico.preco || 0);
    extras.forEach(function (e) {
      nomeServico += ' + ' + e.nome;
      totalDuracao += Number(e.duracao || 0);
      totalPreco   += Number(e.preco || 0);
    });

    $('#ac-r-servico').textContent = nomeServico;
    $('#ac-r-prof').textContent    = profExibido.nome;
    $('#ac-r-data').textContent    = formatDateBR(state.selectedDate);
    $('#ac-r-hora').textContent    = slot;
    $('#ac-r-duracao').textContent = formatDuracao(totalDuracao);
    $('#ac-r-valor').textContent   = brl(totalPreco);
    $('#ac-feedback').hidden = true;
    $('#ac-input-nome').value = '';
    $('#ac-input-tel').value = '';

    $('#ac-modal-confirm').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModals() {
    $('#ac-modal-confirm').hidden = true;
    $('#ac-modal-success').hidden = true;
    document.body.style.overflow = '';
  }

  function showFeedback(msg) {
    var fb = $('#ac-feedback'); fb.hidden = false; fb.textContent = msg;
  }

  async function confirmarAgendamento() {
    var nome = $('#ac-input-nome').value.trim();
    var tel  = $('#ac-input-tel').value.replace(/\D/g, '');
    if (nome.length < 2) return showFeedback('Informe seu nome completo.');
    if (tel.length < 10) return showFeedback('Informe um telefone válido.');

    var servico = state.selectedServico;
    var profId = state.selectedProfissional.id === '__no_pref__'
      ? state.autoChosenProf.id
      : state.selectedProfissional.id;
    var profNome = state.selectedProfissional.id === '__no_pref__'
      ? state.autoChosenProf.nome
      : state.selectedProfissional.nome;

    var btn = $('#ac-btn-confirmar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirmando...';
    try {
      await TenantDataService.criarAgendamento({
        cliente_nome: nome,
        cliente_telefone: tel,
        servico_id: servico.id,
        profissional_id: profId,
        data: state.selectedDate,
        hora: state.selectedSlot,
        duracao: servico.duracao,
        preco: servico.preco,
        servicos_extras: (state.acceptedUpsells || []).map(function (e) {
          return { id: e.id, preco: e.preco, duracao: e.duracao };
        })
      });
      $('#ac-modal-confirm').hidden = true;
      $('#ac-success-msg').textContent =
        servico.nome + ' com ' + profNome + ' em ' + formatDateBR(state.selectedDate) +
        ' às ' + state.selectedSlot + '.';
      $('#ac-modal-success').hidden = false;
    } catch (err) {
      console.error(err);
      showFeedback((err && err.message) || 'Não foi possível confirmar. Tente novamente.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Confirmar agendamento';
    }
  }

  function resetFlow() {
    state.selectedServico = null;
    state.selectedProfissional = null;
    state.selectedDate = null;
    state.selectedSlot = null;
    state.autoChosenProf = null;
    state.recomendacoes = [];
    state.acceptedUpsells = [];
    closeModals();
    goToStep(1);
  }

  /* ============================================================
     9. NAVEGAÇÃO
     ============================================================ */
  function goToStep(n) {
    state.step = n;
    $$('.ac-step-content').forEach(function (el) {
      el.classList.toggle('active', parseInt(el.getAttribute('data-step-content'), 10) === n);
    });
    $$('.ac-step').forEach(function (el) {
      var sn = parseInt(el.getAttribute('data-step'), 10);
      el.classList.toggle('active', sn === n);
      el.classList.toggle('completed', sn < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (n === 3) { renderCalendar(); if (state.selectedDate) renderSlots(); }
  }

  function selectServico(id) {
    var srv = state.servicos.filter(function (s) { return s.id === id; })[0];
    if (!srv) return;
    state.selectedServico = srv;
    state.selectedProfissional = null;
    state.selectedDate = null;
    state.selectedSlot = null;
    state.acceptedUpsells = [];
    state.recomendacoes = [];

    // Carregar profissionais e recomendações em paralelo
    Promise.all([
      TenantDataService.listarProfissionais(srv.id),
      TenantDataService.listarRecomendacoes(srv.id)
    ]).then(function (results) {
      state.profissionais = results[0] || [];
      state.recomendacoes = (results[1] || []).filter(function (r) { return r.id !== srv.id; });
      if (state.profissionais.length === 0) {
        showToast('Nenhum profissional cadastrado para este serviço.', 'error');
        return;
      }
      renderProfissionais();
      // Se houver recomendações, mostrar modal antes de avançar (não-intrusivo: continua mesmo se ignorado)
      if (state.recomendacoes.length > 0) {
        openUpsellModal();
      } else {
        goToStep(2);
      }
    });
  }

  /* ============================================================
     UPSELL: modal de recomendação de serviços (fluxo cliente)
     ============================================================ */
  function openUpsellModal() {
    var modal = $('#ac-modal-upsell');
    var list  = $('#ac-upsell-list');
    if (!modal || !list) { goToStep(2); return; }

    list.innerHTML = state.recomendacoes.map(function (r) {
      var aceito = state.acceptedUpsells.some(function (a) { return a.id === r.id; });
      return '<div class="ac-upsell-item ' + (aceito ? 'added' : '') + '" data-rec-id="' + escapeHtml(r.id) + '">' +
        '<div class="ac-upsell-item-info">' +
          '<p class="ac-upsell-item-name">' + escapeHtml(r.nome) + '</p>' +
          '<div class="ac-upsell-item-meta">' +
            '<span class="price">' + brl(r.preco) + '</span>' +
            '<span><i class="far fa-clock"></i> ' + formatDuracao(r.duracao) + '</span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="ac-upsell-item-add">' + (aceito ? '✓ Adicionado' : 'Adicionar') + '</button>' +
      '</div>';
    }).join('');

    $$('.ac-upsell-item-add', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.ac-upsell-item');
        var recId = item && item.getAttribute('data-rec-id');
        var rec = state.recomendacoes.filter(function (r) { return r.id === recId; })[0];
        if (!rec) return;
        var jaAceito = state.acceptedUpsells.some(function (a) { return a.id === rec.id; });
        if (jaAceito) return;
        // Não duplicar com o serviço principal
        if (state.selectedServico && state.selectedServico.id === rec.id) return;
        state.acceptedUpsells.push(rec);
        item.classList.add('added');
        btn.textContent = '✓ Adicionado';
      });
    });

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeUpsellModalAndContinue() {
    var modal = $('#ac-modal-upsell');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    goToStep(2);
  }

  function dismissUpsell() {
    state.acceptedUpsells = [];
    closeUpsellModalAndContinue();
  }

  function showDisabled(msg) {
    console.log('[ac] showDisabled chamado:', msg);
    var app = $('#ac-app'); if (app) { app.hidden = true; app.style.display = 'none'; }
    var loader = $('#ac-boot-loader'); if (loader) { loader.hidden = true; loader.style.display = 'none'; }
    var dis = $('#ac-disabled'); if (dis) { dis.hidden = false; dis.style.display = 'flex'; }
    if (msg) { var m = $('#ac-disabled-msg'); if (m) m.textContent = msg; }
  }

  /* ============================================================
     10. BOOT — com proteção total contra travamentos
     ============================================================ */
  async function boot() {
    // Hard-stop de segurança: se em 12s nada renderizou, mostra estado "indisponível"
    var safetyTimer = setTimeout(function () {
      if (!$('#ac-boot-loader').hidden) {
        console.error('[ac] boot safety timeout — exibindo tela indisponível');
        showDisabled('Tempo de resposta excedido. Tente novamente em instantes.');
      }
    }, 12000);

    try {
      var tenantId = getTenantIdFromUrl();
      console.log('[ac] tenantId resolvido:', tenantId, '— pathname:', window.location.pathname);

      // Espera supabase-js estar pronto (até 1.5s) — opcional
      var waited = 0;
      while (waited < 1500 && (typeof window.supabase === 'undefined' || !window.supabase.createClient)) {
        await new Promise(function (r) { setTimeout(r, 50); });
        waited += 50;
      }

      // Sem tenantId E sem Supabase → modo DEMO (preview/dev)
      // Com tenantId mas sem Supabase configurado → também DEMO (assume que é preview)
      var sb = initSupabase();
      if (!sb && tenantId) {
        console.warn('[ac] tenantId presente mas Supabase não configurado — caindo em modo DEMO');
      }

      console.log('[ac] boot: chamando carregarTenant...');
      var tenant = await TenantDataService.carregarTenant(tenantId);
      console.log('[ac] boot: carregarTenant retornou:', tenant);

      if (!tenant) {
        clearTimeout(safetyTimer);
        return showDisabled('Estabelecimento não encontrado.');
      }
      if (tenant.habilitado === false) {
        clearTimeout(safetyTimer);
        return showDisabled('O estabelecimento não está aceitando agendamentos online no momento.');
      }

      state.tenant = tenant;
      console.log('[ac] boot: escondendo loader e renderizando tenant');
      var bootLoader = $('#ac-boot-loader'); if (bootLoader) { bootLoader.hidden = true; bootLoader.style.display = 'none'; }
      var appEl = $('#ac-app'); if (appEl) { appEl.hidden = false; appEl.style.display = ''; } else { console.error('[ac] boot: #ac-app NAO existe no DOM!'); }

      try { renderTenant(); console.log('[ac] boot: renderTenant OK'); }
      catch(e){ console.error('[ac] renderTenant FALHOU:', e, e && e.stack); }

      console.log('[ac] boot: carregando servicos...');
      try {
        state.servicos = await TenantDataService.listarServicos();
        console.log('[ac] boot: servicos carregados:', state.servicos.length, 'amostra=', state.servicos[0]);
      } catch (e) {
        console.error('[ac] boot: ERRO ao carregar servicos:', e, e && e.stack);
        state.servicos = [];
      }

      try {
        renderServicos();
        console.log('[ac] boot: renderServicos OK');
      } catch (e) {
        console.error('[ac] boot: ERRO em renderServicos:', e, e && e.stack);
      }

      try {
        bindEvents();
        console.log('[ac] boot: bindEvents OK');
      } catch (e) {
        console.error('[ac] boot: ERRO em bindEvents:', e, e && e.stack);
      }

      clearTimeout(safetyTimer);
      console.log('[ac] boot: FIM — fluxo pronto');
    } catch (e) {
      clearTimeout(safetyTimer);
      console.error('[ac] boot error', e, e && e.stack);
      showDisabled('Nao foi possivel carregar o agendamento. Tente novamente.');
    }
  }

  function bindEvents() {
    console.log('[ac] bindEvents: inicio');
    var search = $('#ac-search-servico');
    if (search) search.addEventListener('input', function (e) { renderServicos(e.target.value); });
    else console.warn('[ac] bindEvents: #ac-search-servico ausente');

    $$('.ac-step').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = parseInt(btn.getAttribute('data-step'), 10);
        if (n < state.step) goToStep(n);
      });
    });
    $$('[data-back-to]').forEach(function (btn) {
      btn.addEventListener('click', function () { goToStep(parseInt(btn.getAttribute('data-back-to'), 10)); });
    });

    var calPrev = $('#ac-cal-prev');
    if (calPrev) calPrev.addEventListener('click', function () {
      var hoje = new Date();
      if (state.calYear < hoje.getFullYear() ||
         (state.calYear === hoje.getFullYear() && state.calMonth <= hoje.getMonth())) return;
      state.calMonth--;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      renderCalendar();
    });
    var calNext = $('#ac-cal-next');
    if (calNext) calNext.addEventListener('click', function () {
      state.calMonth++;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      renderCalendar();
    });

    $$('[data-close-modal]').forEach(function (el) { el.addEventListener('click', closeModals); });
    $$('[data-close-upsell]').forEach(function (el) { el.addEventListener('click', dismissUpsell); });
    var btnUpsellCont = $('#ac-btn-upsell-continue');
    if (btnUpsellCont) btnUpsellCont.addEventListener('click', closeUpsellModalAndContinue);
    var btnConf = $('#ac-btn-confirmar');
    if (btnConf) btnConf.addEventListener('click', confirmarAgendamento);
    else console.warn('[ac] bindEvents: #ac-btn-confirmar ausente');
    var btnNovo = $('#ac-btn-novo');
    if (btnNovo) btnNovo.addEventListener('click', resetFlow);
    else console.warn('[ac] bindEvents: #ac-btn-novo ausente');

    var tel = $('#ac-input-tel');
    if (tel) tel.addEventListener('input', function () {
      var v = tel.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6)      tel.value = '(' + v.slice(0,2) + ') ' + v.slice(2,7) + '-' + v.slice(7);
      else if (v.length > 2) tel.value = '(' + v.slice(0,2) + ') ' + v.slice(2);
      else                   tel.value = v;
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var upsellModal = $('#ac-modal-upsell');
        if (upsellModal && !upsellModal.hidden) { dismissUpsell(); return; }
        closeModals();
      }
    });
    console.log('[ac] bindEvents: fim');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
