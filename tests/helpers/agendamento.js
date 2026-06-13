// tests/helpers/agendamento.js
// v5 — Abertura determinística do modal "Identificação do Cliente"
//
// Causa raiz da falha em CI (CT010/CT011/CT012/CT013/CT018/CT019/CT020/CT021):
//
//   O botão #btn-novo-agendamento está no HTML ESTÁTICO de agenda.html
//   (linha 343), portanto fica visible+enabled assim que o navegador pinta a
//   página — ANTES de script.js (~13k linhas) terminar de inicializar.
//
//   O click handler que abre o modal só é anexado dentro do bloco
//   DOMContentLoaded de script.js, na linha 2076:
//
//       document.getElementById('btn-novo-agendamento')
//         .addEventListener('click', function () {
//           resetIdentificacaoModal();
//           openModal('modal-identificacao');   // = classList.add('active')
//         });
//
//   Em CI (CPU mais lenta + script.js ainda parseando), o Playwright dispara
//   o click ANTES dessa linha rodar. O click cai num elemento sem listener,
//   nada acontece, e o helper antigo conclui "modal não abriu".
//
//   Os antigos "esperar agenda estável", "clicar em um dia do calendário",
//   "waitForTimeout" e "retry de click" tratavam o sintoma. O retry às vezes
//   funciona porque, na 2ª tentativa, o DOMContentLoaded já completou — mas
//   em regressão pesada (21 cenários, workers=1) a corrida ainda perde.
//
//   Além disso: openModal só faz `classList.add('active')` no
//   #modal-identificacao. NÃO existe role="dialog" nem requisito de data
//   selecionada. O texto "Selecione uma data" é só o placeholder de
//   #day-detail-header e NÃO bloqueia nada.
//
// Correção determinística (sem heurística, sem waitForTimeout):
//
//   1. Esperar a prova de que o bloco DOMContentLoaded passou da linha 2076.
//      Indicador estável: #ag-data.value é preenchido na linha 2094, DEPOIS
//      do listener ser anexado. Se #ag-data tem valor, o listener existe.
//      Reforço: aria-busy=false em <body> não é exposto pelo app, então
//      checamos também que setupIdentificacaoModal completou indiretamente
//      via presença das tabs de busca (#id-panel-telefone e tab "Nome").
//
//   2. Clicar #btn-novo-agendamento.
//
//   3. Esperar pela mudança de classe REAL feita por openModal():
//      `#modal-identificacao.active`. Esse é o único sinal verdadeiro.
//
//   4. Retry único do click se a classe `active` não aparecer em 4s.
//      (cobre janela residual de hidratação)
//
//   Nada de waitForTimeout, nada de clicar em dias do calendário, nada de
//   "selecione uma data". Tudo amarrado ao DOM real da aplicação.

const { expect } = require('@playwright/test');

const READY_TIMEOUT = 20000;   // janela para script.js terminar init em CI
const OPEN_TIMEOUT  = 8000;    // janela para classList.add('active')
const RETRY_TIMEOUT = 6000;

// ---------------------------------------------------------------------------
// Locators amarrados aos IDs reais de agenda.html
// ---------------------------------------------------------------------------

const SEL_BTN_NOVO   = '#btn-novo-agendamento';
const SEL_MODAL_ID   = '#modal-identificacao';
const SEL_MODAL_OPEN = '#modal-identificacao.active';
const SEL_AG_DATA    = '#ag-data';
const SEL_TAB_NOME   = '#modal-identificacao [data-search-type="nome"]';
const SEL_TAB_TEL    = '#modal-identificacao [data-search-type="telefone"]';

// ---------------------------------------------------------------------------
// Esperar a aplicação estar realmente pronta para receber o click.
// Indicadores verificados em paralelo via waitForFunction:
//   - #btn-novo-agendamento existe e está visível.
//   - #ag-data.value não-vazio (prova que DOMContentLoaded passou da
//     linha 2076 onde o listener é anexado).
//   - #modal-identificacao existe no DOM (sempre existe, mas garantimos).
//   - As tabs do modal existem (prova que setupIdentificacaoModal rodou).
// ---------------------------------------------------------------------------
async function esperarAgendaPronta(page, timeout = READY_TIMEOUT) {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('#btn-novo-agendamento');
      if (!btn) return false;
      // visible + não disabled
      const cs = window.getComputedStyle(btn);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (btn.disabled) return false;

      const agData = document.querySelector('#ag-data');
      if (!agData || !agData.value) return false; // prova de init concluída

      const modal = document.querySelector('#modal-identificacao');
      if (!modal) return false;

      const tabNome = document.querySelector(
        '#modal-identificacao [data-search-type="nome"]'
      );
      const tabTel = document.querySelector(
        '#modal-identificacao [data-search-type="telefone"]'
      );
      if (!tabNome || !tabTel) return false;

      return true;
    },
    null,
    { timeout, polling: 100 }
  );
}

// ---------------------------------------------------------------------------
// Abrir o modal "Identificação do Cliente"
// ---------------------------------------------------------------------------
async function abrirNovoAgendamento(page, opts = {}) {
  const openTimeout  = opts.timeout      ?? OPEN_TIMEOUT;
  const readyTimeout = opts.readyTimeout ?? READY_TIMEOUT;

  // 1) Esperar a página estar pronta para o click ser efetivo.
  await esperarAgendaPronta(page, readyTimeout);

  const btn   = page.locator(SEL_BTN_NOVO);
  const modal = page.locator(SEL_MODAL_OPEN);

  // 2) Click.
  await btn.click();

  // 3) Esperar a CLASSE `active` aparecer — sinal real de openModal().
  try {
    await expect(modal).toBeVisible({ timeout: openTimeout });
    return;
  } catch (_) {
    // 4) Retry único — janela residual de hidratação.
    //    Reconfirmar prontidão antes de tentar de novo.
    await esperarAgendaPronta(page, readyTimeout);
    await btn.click();

    try {
      await expect(modal).toBeVisible({ timeout: RETRY_TIMEOUT });
      return;
    } catch (e) {
      const debug = await page.evaluate(() => ({
        url: location.href,
        scriptVersion:
          document.documentElement.getAttribute('data-script-version') || null,
        agDataValue: document.querySelector('#ag-data')?.value || null,
        modalClasses:
          document.querySelector('#modal-identificacao')?.className || null,
        btnExists: !!document.querySelector('#btn-novo-agendamento'),
      }));
      throw new Error(
        '[helpers/agendamento.abrirNovoAgendamento] modal-identificacao não recebeu .active após 2 cliques. debug=' +
          JSON.stringify(debug)
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers úteis para os specs (opcional — não muda nada se não usar)
// ---------------------------------------------------------------------------
function locBtnNovo(page)        { return page.locator(SEL_BTN_NOVO); }
function locModalIdentificacao(p){ return p.locator(SEL_MODAL_OPEN); }
function locTabNome(page)        { return page.locator(SEL_TAB_NOME); }
function locTabTelefone(page)    { return page.locator(SEL_TAB_TEL); }

module.exports = {
  abrirNovoAgendamento,
  esperarAgendaPronta,
  locBtnNovo,
  locModalIdentificacao,
  locTabNome,
  locTabTelefone,
};
