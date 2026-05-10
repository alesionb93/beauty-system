/* ============================================================
   import-clientes.js  —  Módulo isolado de Importação de Clientes
   Build: v2-2026-05-09
   Padrão arquitetural igual a analytics-cancelamentos / analytics-produtos.
   NÃO altera script.js. NÃO altera lógica de cadastro manual.
   Plugável: basta incluir o CSS + JS no agenda.html.
   ============================================================ */
(function () {
  'use strict';

  var TAG = '[ImportClientes]';
  var VERSION = 'v4-2026-05-09-mobile-reload';
  var MAX_ROWS = 5000;
  var XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  console.log('%c✅ ' + TAG + ' iniciado', 'background:#6C3AED;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700', VERSION);

  // ---------- Utilidades ----------
  function log()  { try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch(_){} }
  function warn() { try { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); } catch(_){} }
  function err()  { try { console.error.apply(console, [TAG].concat([].slice.call(arguments))); } catch(_){} }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function getSupabase() {
    if (window.supabaseClient) return window.supabaseClient;
    if (typeof supabaseClient !== 'undefined') return supabaseClient;
    return null;
  }
  function getTenantId() {
    if (typeof getCurrentTenantId === 'function') {
      try { return getCurrentTenantId(); } catch(_) {}
    }
    return localStorage.getItem('currentTenantId') || null;
  }

  // ---------- Telefone ----------
  // Aceita qualquer formato; devolve dígitos só (sem +55)
  function onlyDigits(v) { return String(v == null ? '' : v).replace(/\D+/g, ''); }
  function stripCountry(d) {
    if (d.length === 13 && d.charAt(0) === '5' && d.charAt(1) === '5') return d.substring(2);
    if (d.length === 12 && d.charAt(0) === '5' && d.charAt(1) === '5') return d.substring(2);
    return d;
  }
  /**
   * formatPhoneImport — normaliza para o padrão do sistema (XX) XXXXX-XXXX ou (XX) XXXX-XXXX.
   * Retorna null quando inválido.
   */
  function formatPhoneImport(raw) {
    var d = stripCountry(onlyDigits(raw));
    if (d.length !== 10 && d.length !== 11) return null;
    var ddd = d.substring(0, 2);
    var rest = d.substring(2);
    if (rest.length === 9) {
      return '(' + ddd + ') ' + rest.substring(0, 5) + '-' + rest.substring(5);
    }
    return '(' + ddd + ') ' + rest.substring(0, 4) + '-' + rest.substring(4);
  }
  // expõe para debug
  window.__formatPhoneImport = formatPhoneImport;

  // ---------- Data ----------
  /**
   * parseDateBRToISO — converte data em vários formatos para ISO (YYYY-MM-DD).
   * Aceita:
   *   • Date object (Excel com cellDates)
   *   • "DD/MM/YYYY" ou "DD-MM-YYYY" ou "DD.MM.YYYY"  (padrão BR)
   *   • "YYYY-MM-DD"  (ISO — compatibilidade)
   *   • serial numérico do Excel
   * Retorna null se inválido (dia/mês/ano impossíveis ou formato desconhecido).
   * Não lança exceção — sempre devolve string ISO ou null.
   */
  function parseDateBRToISO(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date && !isNaN(raw)) {
      return raw.toISOString().substring(0, 10);
    }
    var s = String(raw).trim();
    if (!s) return null;

    // 1) ISO: YYYY-MM-DD (compatibilidade)
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      var y = +m[1], mo = +m[2], dd = +m[3];
      return validDate(y, mo, dd) ? (pad(y, 4) + '-' + pad(mo, 2) + '-' + pad(dd, 2)) : null;
    }

    // 2) BR: DD/MM/YYYY  •  DD-MM-YYYY  •  DD.MM.YYYY
    m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m) {
      var dd2 = +m[1], mo2 = +m[2], y2 = +m[3];
      if (y2 < 100) y2 += y2 < 30 ? 2000 : 1900;
      return validDate(y2, mo2, dd2) ? (pad(y2, 4) + '-' + pad(mo2, 2) + '-' + pad(dd2, 2)) : null;
    }

    // 3) Serial numérico do Excel
    if (/^\d+(\.\d+)?$/.test(s)) {
      var serial = parseFloat(s);
      if (serial > 59 && serial < 80000) {
        var ms = (serial - 25569) * 86400 * 1000;
        var dt = new Date(ms);
        if (!isNaN(dt)) return dt.toISOString().substring(0, 10);
      }
    }
    return null;
  }
  // alias mantido por compatibilidade interna
  function parseDate(raw) { return parseDateBRToISO(raw); }
  function validDate(y, m, d) {
    if (!y || !m || !d) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  // ---------- CSV parser (RFC 4180-ish) ----------
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    // Detecta separador (;, , ou \t)
    var firstLine = text.split(/\r?\n/)[0] || '';
    var sep = ',';
    if (firstLine.indexOf(';') > -1 && firstLine.indexOf(';') !== -1) sep = ';';
    if (firstLine.split('\t').length > firstLine.split(sep).length) sep = '\t';

    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === sep) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  // ---------- Carregamento lazy do XLSX ----------
  var _xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_xlsxPromise) return _xlsxPromise;
    _xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_CDN;
      s.onload = function () { resolve(window.XLSX); };
      s.onerror = function () { reject(new Error('Falha ao carregar XLSX')); };
      document.head.appendChild(s);
    });
    return _xlsxPromise;
  }

  // ---------- Header mapping ----------
  function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
  var ALIAS_NOME       = ['nome', 'cliente', 'nome_cliente', 'nome_completo', 'name'];
  var ALIAS_TELEFONE   = ['telefone', 'celular', 'fone', 'whatsapp', 'phone', 'tel'];
  var ALIAS_NASCIMENTO = ['data_nascimento', 'nascimento', 'data_de_nascimento', 'aniversario', 'birthday', 'dt_nascimento'];

  function mapColumns(headerRow) {
    var idx = { nome: -1, telefone: -1, nascimento: -1 };
    for (var i = 0; i < headerRow.length; i++) {
      var h = normalizeHeader(headerRow[i]);
      if (idx.nome === -1 && ALIAS_NOME.indexOf(h) > -1) idx.nome = i;
      else if (idx.telefone === -1 && ALIAS_TELEFONE.indexOf(h) > -1) idx.telefone = i;
      else if (idx.nascimento === -1 && ALIAS_NASCIMENTO.indexOf(h) > -1) idx.nascimento = i;
    }
    return idx;
  }

  // ---------- Validação / Preview ----------
  function buildPreview(rows, existingPhonesSet) {
    if (!rows.length) return { items: [], cols: null, error: 'Arquivo vazio' };
    var cols = mapColumns(rows[0]);
    var hasHeader = cols.nome > -1 || cols.telefone > -1;
    if (!hasHeader) {
      // assume ordem padrão: nome, telefone, nascimento
      cols = { nome: 0, telefone: 1, nascimento: 2 };
    }
    if (cols.nome === -1 || cols.telefone === -1) {
      return { items: [], cols: cols, error: 'Não foi possível encontrar as colunas obrigatórias "nome" e "telefone".' };
    }

    var dataRows = hasHeader ? rows.slice(1) : rows;
    if (dataRows.length > MAX_ROWS) {
      return { items: [], cols: cols, error: 'Arquivo excede o limite de ' + MAX_ROWS + ' linhas.' };
    }

    var seen = Object.create(null); // duplicidade dentro do próprio arquivo
    var items = [];
    for (var i = 0; i < dataRows.length; i++) {
      var r = dataRows[i] || [];
      var nomeRaw = r[cols.nome];
      var telRaw  = r[cols.telefone];
      var nascRaw = cols.nascimento > -1 ? r[cols.nascimento] : '';
      var nome    = String(nomeRaw == null ? '' : nomeRaw).trim();
      var telefone = formatPhoneImport(telRaw);

      // Data: aceita BR (DD/MM/YYYY, DD-MM-YYYY) e ISO (YYYY-MM-DD).
      // Se o usuário preencheu algo mas é inválido, vira erro de linha.
      var nascRawStr = String(nascRaw == null ? '' : nascRaw).trim();
      var nascimento = parseDateBRToISO(nascRaw);
      var nascInvalida = (nascRawStr !== '' && !nascimento);

      var status = 'ok';
      var errorMsg = '';
      if (!nome && !telRaw && !nascRawStr) continue; // linha totalmente vazia
      if (!nome) { status = 'err'; errorMsg = 'Nome obrigatório'; }
      else if (!telefone) { status = 'err'; errorMsg = 'Telefone inválido'; }
      else if (nascInvalida) { status = 'err'; errorMsg = 'data_nascimento inválida: ' + nascRawStr; }
      else {
        var digits = onlyDigits(telefone);
        if (seen[digits]) { status = 'dup'; errorMsg = 'Duplicado no arquivo'; }
        else if (existingPhonesSet[digits]) { status = 'dup'; errorMsg = 'Já existe no sistema'; }
        else { seen[digits] = true; }
      }
      items.push({
        line: i + (hasHeader ? 2 : 1),
        nome: nome,
        telefone: telefone || String(telRaw == null ? '' : telRaw),
        nascimento: nascimento,
        nascimentoRaw: nascRawStr,
        status: status,
        error: errorMsg
      });
    }
    return { items: items, cols: cols, error: null };
  }

  // ---------- Existentes (telefone -> dígitos) ----------
  async function fetchExistingPhones() {
    var sb = getSupabase();
    var tenantId = getTenantId();
    if (!sb || !tenantId) return {};
    var resp = await sb.from('clientes').select('telefone').eq('tenant_id', tenantId);
    if (resp.error) { warn('Erro ao buscar clientes existentes:', resp.error); return {}; }
    var set = Object.create(null);
    (resp.data || []).forEach(function (c) {
      var d = onlyDigits(c.telefone);
      if (d) set[d] = true;
    });
    return set;
  }

  // ---------- Inserção ----------
  async function insertBatch(items, onProgress) {
    var sb = getSupabase();
    var tenantId = getTenantId();
    if (!sb || !tenantId) throw new Error('Sessão/tenant indisponível.');
    var ok = 0, errors = 0, errorList = [];
    var batch = 50;
    for (var i = 0; i < items.length; i += batch) {
      var slice = items.slice(i, i + batch).map(function (it) {
        var row = { nome: it.nome, telefone: it.telefone, tenant_id: tenantId };
        if (it.nascimento) row.nascimento = it.nascimento;
        return row;
      });
      var resp = await sb.from('clientes').insert(slice).select('id');
      if (resp.error) {
        // tenta uma a uma para identificar quais falharam
        for (var j = 0; j < slice.length; j++) {
          var single = await sb.from('clientes').insert([slice[j]]).select('id');
          if (single.error) {
            errors++;
            errorList.push({ nome: slice[j].nome, telefone: slice[j].telefone, msg: single.error.message });
          } else { ok++; }
          if (onProgress) onProgress(Math.min(i + j + 1, items.length), items.length);
        }
      } else {
        ok += (resp.data || slice).length;
        if (onProgress) onProgress(Math.min(i + batch, items.length), items.length);
      }
    }
    return { ok: ok, errors: errors, errorList: errorList };
  }

  // ---------- Template ----------
  function downloadTemplateCSV() {
    var content = 'nome,telefone,data_nascimento\r\n' +
                  '"João Silva","(48) 99999-9999","1995-10-15"\r\n' +
                  '"Maria Souza","(11) 98888-7777","1988-03-22"\r\n';
    var blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), content], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'modelo-importacao-clientes.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    log('template baixado');
  }

  // ============================================================
  // UI
  // ============================================================
  var modalEl = null;
  var state = { items: [], existing: {} };

  function buildModal() {
    if (modalEl) return modalEl;
    modalEl = el('div', 'ic-modal-overlay');
    modalEl.style.display = 'none';
    modalEl.innerHTML =
      '<div class="ic-modal" role="dialog" aria-modal="true" aria-label="Importar clientes">' +
        '<div class="ic-modal-header">' +
          '<h3><i class="fa-solid fa-file-import"></i> Importar Clientes</h3>' +
          '<button class="ic-modal-close" type="button" aria-label="Fechar">&times;</button>' +
        '</div>' +
        '<div class="ic-modal-body">' +

          '<div class="ic-step ic-step-upload active">' +
            '<div class="ic-drop" id="ic-drop">' +
              '<i class="fa-solid fa-cloud-arrow-up"></i>' +
              '<p>Arraste seu arquivo aqui ou clique para selecionar</p>' +
              '<small>Formatos aceitos: CSV, XLSX  •  Colunas: nome, telefone, data_nascimento</small>' +
              '<input type="file" id="ic-file" accept=".csv,.xlsx,.xls" hidden />' +
            '</div>' +
            '<div class="ic-info-row">' +
              '<button type="button" class="ic-link-btn" id="ic-template"><i class="fa-solid fa-download"></i> Baixar modelo</button>' +
              '<small style="color:var(--text-muted,#6B7280)">Limite: ' + MAX_ROWS.toLocaleString('pt-BR') + ' linhas por importação</small>' +
            '</div>' +
          '</div>' +

          '<div class="ic-step ic-step-preview">' +
            '<div class="ic-stats">' +
              '<div class="ic-stat ok"><span class="ic-stat-label">Válidos</span><span class="ic-stat-value" id="ic-stat-ok">0</span></div>' +
              '<div class="ic-stat warn"><span class="ic-stat-label">Duplicados</span><span class="ic-stat-value" id="ic-stat-dup">0</span></div>' +
              '<div class="ic-stat error"><span class="ic-stat-label">Inválidos</span><span class="ic-stat-value" id="ic-stat-err">0</span></div>' +
              '<div class="ic-stat"><span class="ic-stat-label">Total no arquivo</span><span class="ic-stat-value" id="ic-stat-total">0</span></div>' +
            '</div>' +
            '<div class="ic-table-wrap">' +
              '<table class="ic-table">' +
                '<thead><tr><th style="width:90px">Status</th><th>Nome</th><th>Telefone</th><th>Nascimento</th></tr></thead>' +
                '<tbody id="ic-tbody"></tbody>' +
              '</table>' +
            '</div>' +
          '</div>' +

          '<div class="ic-step ic-step-progress">' +
            '<h4 style="margin:6px 0 4px">Importando clientes…</h4>' +
            '<div class="ic-progress"><div class="ic-progress-bar" id="ic-bar"></div></div>' +
            '<div class="ic-progress-text" id="ic-progress-text">0 / 0</div>' +
          '</div>' +

          '<div class="ic-step ic-step-result">' +
            '<div class="ic-result-summary">' +
              '<i class="fa-solid fa-circle-check ic-icon" id="ic-result-icon"></i>' +
              '<h4 id="ic-result-title">Importação concluída</h4>' +
              '<div class="ic-stats" style="margin-top:14px">' +
                '<div class="ic-stat ok"><span class="ic-stat-label">Importados</span><span class="ic-stat-value" id="ic-res-ok">0</span></div>' +
                '<div class="ic-stat warn"><span class="ic-stat-label">Duplicados</span><span class="ic-stat-value" id="ic-res-dup">0</span></div>' +
                '<div class="ic-stat error"><span class="ic-stat-label">Inválidos</span><span class="ic-stat-value" id="ic-res-err">0</span></div>' +
              '</div>' +
              '<div id="ic-res-errors" style="margin-top:14px;text-align:left"></div>' +
            '</div>' +
          '</div>' +

        '</div>' +
        '<div class="ic-modal-footer">' +
          '<button type="button" class="ic-btn ic-btn-ghost" id="ic-cancel">Cancelar</button>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' +
            '<button type="button" class="ic-btn ic-btn-ghost" id="ic-back" style="display:none">Voltar</button>' +
            '<button type="button" class="ic-btn ic-btn-primary" id="ic-confirm" style="display:none" disabled>' +
              '<i class="fa-solid fa-check"></i> Confirmar importação' +
            '</button>' +
            '<button type="button" class="ic-btn ic-btn-primary" id="ic-finish" style="display:none">Concluir</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalEl);
    bindModalEvents();
    return modalEl;
  }

  function bindModalEvents() {
    var drop = $('#ic-drop', modalEl);
    var fileInput = $('#ic-file', modalEl);
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-dragging'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-dragging'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('is-dragging');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    });
    $('.ic-modal-close', modalEl).addEventListener('click', closeModal);
    $('#ic-cancel', modalEl).addEventListener('click', closeModal);
    $('#ic-template', modalEl).addEventListener('click', downloadTemplateCSV);
    $('#ic-back', modalEl).addEventListener('click', function () { showStep('upload'); });
    $('#ic-confirm', modalEl).addEventListener('click', confirmImport);
    $('#ic-finish', modalEl).addEventListener('click', function () {
      // Após importar com sucesso, recarrega a página para refletir os novos clientes em tela.
      try { closeModal(); } catch(_) {}
      try { location.reload(); } catch (e) { warn('Falha ao recarregar:', e); }
    });
    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) closeModal();
    });
  }

  function showStep(step) {
    ['upload', 'preview', 'progress', 'result'].forEach(function (s) {
      var n = $('.ic-step-' + s, modalEl);
      if (n) n.classList.toggle('active', s === step);
    });
    $('#ic-confirm', modalEl).style.display = step === 'preview' ? 'inline-flex' : 'none';
    $('#ic-back', modalEl).style.display    = step === 'preview' ? 'inline-flex' : 'none';
    $('#ic-finish', modalEl).style.display  = step === 'result'  ? 'inline-flex' : 'none';
    $('#ic-cancel', modalEl).style.display  = step === 'progress' || step === 'result' ? 'none' : 'inline-flex';
  }

  function openModal() {
    buildModal();
    modalEl.style.display = 'flex';
    showStep('upload');
    $('#ic-file', modalEl).value = '';
    state = { items: [], existing: {} };
    log('modal aberto');
  }
  function closeModal() {
    if (modalEl) modalEl.style.display = 'none';
  }

  // ---------- Handle file ----------
  async function handleFile(file) {
    log('arquivo carregado', file.name, file.size + 'B');
    try {
      var name = (file.name || '').toLowerCase();
      var rows;
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        var XLSX = await loadXLSX();
        var buf = await file.arrayBuffer();
        var wb = XLSX.read(buf, { type: 'array', cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      } else {
        var text = await file.text();
        rows = parseCSV(text);
      }
      log('linhas brutas:', rows.length);

      var existing = await fetchExistingPhones();
      state.existing = existing;
      var preview = buildPreview(rows, existing);
      if (preview.error) {
        alert(preview.error);
        return;
      }
      state.items = preview.items;
      log('preview gerado', { total: preview.items.length });
      renderPreview();
      showStep('preview');
    } catch (e) {
      err('Falha ao processar arquivo:', e);
      alert('Erro ao processar arquivo: ' + (e && e.message ? e.message : e));
    }
  }

  function renderPreview() {
    var items = state.items;
    var ok = 0, dup = 0, bad = 0;
    items.forEach(function (it) {
      if (it.status === 'ok') ok++;
      else if (it.status === 'dup') dup++;
      else bad++;
    });
    $('#ic-stat-ok',    modalEl).textContent = ok;
    $('#ic-stat-dup',   modalEl).textContent = dup;
    $('#ic-stat-err',   modalEl).textContent = bad;
    $('#ic-stat-total', modalEl).textContent = items.length;

    var tbody = $('#ic-tbody', modalEl);
    tbody.innerHTML = '';
    var frag = document.createDocumentFragment();
    items.slice(0, 500).forEach(function (it) {
      var tr = document.createElement('tr');
      tr.className = it.status === 'err' ? 'ic-row-invalid' : (it.status === 'dup' ? 'ic-row-dup' : '');
      var pillCls = it.status === 'ok' ? 'ok' : (it.status === 'dup' ? 'dup' : 'err');
      var pillTxt = it.status === 'ok' ? 'OK' : (it.status === 'dup' ? 'DUPLICADO' : 'INVÁLIDO');
      tr.innerHTML =
        '<td><span class="ic-pill ' + pillCls + '">' + pillTxt + '</span></td>' +
        '<td>' + escapeHtml(it.nome || '<vazio>') + (it.error ? '<div class="ic-error-msg">' + escapeHtml(it.error) + '</div>' : '') + '</td>' +
        '<td>' + escapeHtml(it.telefone || '') + '</td>' +
        '<td>' + escapeHtml(it.nascimento || '') + '</td>';
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    if (items.length > 500) {
      var trMore = document.createElement('tr');
      trMore.innerHTML = '<td colspan="4" style="text-align:center;color:var(--text-muted,#6B7280);font-style:italic">… e mais ' + (items.length - 500) + ' linhas (não exibidas no preview)</td>';
      tbody.appendChild(trMore);
    }

    var btn = $('#ic-confirm', modalEl);
    btn.disabled = ok === 0;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Importar ' + ok + ' cliente' + (ok === 1 ? '' : 's');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  async function confirmImport() {
    var validos = state.items.filter(function (it) { return it.status === 'ok'; });
    var dup = state.items.filter(function (it) { return it.status === 'dup'; }).length;
    var bad = state.items.filter(function (it) { return it.status === 'err'; }).length;
    if (!validos.length) return;
    log('importação iniciada', { total: validos.length });

    showStep('progress');
    var bar = $('#ic-bar', modalEl);
    var txt = $('#ic-progress-text', modalEl);
    bar.style.width = '0%';
    txt.textContent = '0 / ' + validos.length;

    try {
      var res = await insertBatch(validos, function (done, total) {
        var pct = Math.round((done / total) * 100);
        bar.style.width = pct + '%';
        txt.textContent = done + ' / ' + total;
      });
      log('importação concluída', res);
      $('#ic-res-ok',  modalEl).textContent = res.ok;
      $('#ic-res-dup', modalEl).textContent = dup;
      $('#ic-res-err', modalEl).textContent = bad + res.errors;

      var errBox = $('#ic-res-errors', modalEl);
      errBox.innerHTML = '';
      if (res.errorList.length) {
        var html = '<strong style="color:#DC2626">Erros durante a inserção:</strong><ul style="margin:6px 0 0 20px;font-size:0.85rem">';
        res.errorList.slice(0, 20).forEach(function (e) {
          html += '<li>' + escapeHtml(e.nome) + ' (' + escapeHtml(e.telefone) + '): ' + escapeHtml(e.msg) + '</li>';
        });
        if (res.errorList.length > 20) html += '<li>… e mais ' + (res.errorList.length - 20) + '</li>';
        html += '</ul>';
        errBox.innerHTML = html;
      }
      showStep('result');
      // Refresh automático após sucesso para que os clientes recém-importados apareçam na lista.
      if (res.ok > 0) {
        setTimeout(function () { try { location.reload(); } catch(_) {} }, 1500);
      }
    } catch (e) {
      err('erros encontrados na importação:', e);
      alert('Erro durante a importação: ' + (e && e.message ? e.message : e));
      showStep('preview');
    }
  }

  // ============================================================
  // Botão de entrada na página de Clientes
  // ============================================================
  function injectButton() {
    var page = document.getElementById('page-clientes');
    if (!page) return false;
    if (page.querySelector('#ic-open-btn')) return true;
    var header = page.querySelector('.page-header');
    if (!header) return false;

    var btn = el('button', 'ic-btn-import');
    btn.id = 'ic-open-btn';
    btn.type = 'button';
    btn.innerHTML = '<i class="fa-solid fa-file-import"></i> Importar clientes';
    btn.addEventListener('click', openModal);

    // Agrupa "Importar clientes" + "Novo Cliente" no MESMO wrapper flex,
    // para ficarem lado a lado (mesma proporção / mesmo canto do header).
    var novo = header.querySelector('#btn-novo-cliente');
    if (novo) {
      var wrap = header.querySelector('#ic-actions-wrap');
      if (!wrap) {
        wrap = el('div', 'ic-actions-group');
        wrap.id = 'ic-actions-wrap';
        // insere o wrapper na posição original do botão "Novo Cliente"
        novo.parentNode.insertBefore(wrap, novo);
        // move o "Novo Cliente" para dentro do wrapper (preserva listeners)
        wrap.appendChild(novo);
      }
      // "Importar clientes" antes do "Novo Cliente"
      wrap.insertBefore(btn, novo);
    } else {
      header.appendChild(btn);
    }
    log('botão injetado (agrupado com Novo Cliente)');
    return true;
  }

  function injectResponsiveStyles() {
    if (document.getElementById('ic-responsive-styles')) return;
    var css =
      /* Desktop / base */
      '#page-clientes .page-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;}' +
      '#page-clientes #ic-actions-wrap{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;}' +
      '#page-clientes #ic-actions-wrap .ic-btn-import,' +
      '#page-clientes #ic-actions-wrap #btn-novo-cliente{white-space:nowrap;}' +

      /* Tablet */
      '@media (max-width: 900px){' +
        '#page-clientes .page-header{flex-direction:column;align-items:stretch;gap:10px;}' +
        '#page-clientes .page-header h1,#page-clientes .page-header h2{text-align:left;margin:0;}' +
        '#page-clientes #ic-actions-wrap{width:100%;justify-content:stretch;}' +
        '#page-clientes #ic-actions-wrap > *{flex:1 1 auto;}' +
      '}' +

      /* Mobile */
      '@media (max-width: 560px){' +
        '#page-clientes .page-header{padding:12px 14px;}' +
        '#page-clientes #ic-actions-wrap{flex-direction:column;width:100%;gap:8px;}' +
        '#page-clientes #ic-actions-wrap > *{width:100%;justify-content:center;display:inline-flex;align-items:center;gap:6px;}' +
        '#page-clientes .ic-btn-import,#page-clientes #btn-novo-cliente{padding:12px 14px;font-size:0.95rem;border-radius:10px;}' +
      '}';
    var style = document.createElement('style');
    style.id = 'ic-responsive-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function init() {
    injectResponsiveStyles();
    if (!injectButton()) {
      // página pode ainda não estar no DOM — observa
      var obs = new MutationObserver(function () {
        if (injectButton()) obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // expõe API mínima para debug
  window.ImportClientes = {
    version: VERSION,
    open: openModal,
    formatPhoneImport: formatPhoneImport,
    parseDate: parseDate,
    parseDateBRToISO: parseDateBRToISO
  };
})();
