import java.time.LocalDate as LocalDate
import java.time.format.DateTimeFormatter as DateTimeFormatter
import java.util.Arrays as Arrays

import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject

import com.kms.katalon.core.testobject.ConditionType as ConditionType
import com.kms.katalon.core.testobject.TestObject as TestObject
import com.kms.katalon.core.webui.common.WebUiCommonHelper as WebUiCommonHelper
import com.kms.katalon.core.webui.keyword.WebUiBuiltInKeywords as WebUI

// ========================================
// LOGIN
// ========================================

WebUI.openBrowser('')

WebUI.navigateToUrl(
    'https://slotify.pilotodigital.online/agenda.html'
)

WebUI.setText(
    findTestObject('input_Login ou e-mail'),
    'automacao'
)

WebUI.setEncryptedText(
    findTestObject('input_Senha'),
    'Rwhbk+ysi2qFpO8ST+6qJw=='
)

WebUI.click(
    findTestObject('button_btn-login')
)

WebUI.waitForElementVisible(
    findTestObject('span_Dom'),
    30
)

// ========================================
// DESABILITA SMART WAIT
// ========================================

WebUI.disableSmartWait()

// ========================================
// DATA +13 DIAS
// ========================================

LocalDate dataAgendamento = LocalDate.now().plusDays(13)

String dataFormatada = dataAgendamento.format(
    DateTimeFormatter.ofPattern('yyyy-MM-dd')
)

println(
    'Data utilizada: ' +
    dataFormatada
)

// ========================================
// ABRIR DIA
// ========================================

int dia = dataAgendamento.getDayOfMonth()

println(
    'Dia utilizado: ' +
    dia
)

TestObject diaCalendario = new TestObject()

diaCalendario.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//button[normalize-space()='" + dia + "']"
)

WebUI.waitForElementClickable(
    diaCalendario,
    10
)

WebUI.click(
    diaCalendario
)

// ========================================
// ABRIR AGENDAMENTO
// ========================================

WebUI.waitForElementClickable(
    findTestObject('span_20_00  20_30'),
    10
)

WebUI.click(
    findTestObject('span_20_00  20_30')
)

// ========================================
// VALIDAR PACOTE
// ========================================

TestObject pacoteSelecionadoObj = new TestObject()

pacoteSelecionadoObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[contains(text(),'3 restantes')]"
)

String pacoteSelecionado = WebUI.getText(
    pacoteSelecionadoObj
)

println(
    'PACOTE = [' +
    pacoteSelecionado +
    ']'
)

assert pacoteSelecionado.contains(
    '3 restantes'
)

println(
    'Pacote corretamente marcado'
)

// ========================================
// CONCLUIR ATENDIMENTO
// ========================================

WebUI.waitForElementClickable(
    findTestObject(
        'button_btn-concluir-atendimento'
    ),
    10
)

WebUI.click(
    findTestObject(
        'button_btn-concluir-atendimento'
    )
)

WebUI.waitForElementClickable(
    findTestObject(
        'button_btn-confirmar-concluir-atendimento'
    ),
    10
)

WebUI.click(
    findTestObject(
        'button_btn-confirmar-concluir-atendimento'
    )
)

println(
    'Atendimento concluído utilizando saldo de pacote'
)

WebUI.delay(5)

// ========================================
// ATIVA COMISSÃO
// ========================================

WebUI.executeJavaScript(
    '''
    try {
        localStorage.setItem(
            "ff_comissoes_ativo",
            "1"
        );
    } catch(e) {}
    ''',
    null
)

// ========================================
// DASHBOARD
// ========================================

WebUI.click(
    findTestObject('button_Dashboard')
)

WebUI.waitForElementVisible(
    findTestObject('input_dash-inicio'),
    15
)

// ========================================
// DATA INÍCIO
// ========================================

def dashInicio = WebUiCommonHelper.findWebElement(
    findTestObject('input_dash-inicio'),
    10
)

WebUI.executeJavaScript(
    '''
    arguments[0].value = arguments[1];
    arguments[0].dispatchEvent(new Event("input",{bubbles:true}));
    arguments[0].dispatchEvent(new Event("change",{bubbles:true}));
    ''',
    Arrays.asList(
        dashInicio,
        dataFormatada
    )
)

// ========================================
// DATA FIM
// ========================================

def dashFim = WebUiCommonHelper.findWebElement(
    findTestObject('input_dash-fim'),
    10
)

WebUI.executeJavaScript(
    '''
    arguments[0].value = arguments[1];
    arguments[0].dispatchEvent(new Event("input",{bubbles:true}));
    arguments[0].dispatchEvent(new Event("change",{bubbles:true}));
    ''',
    Arrays.asList(
        dashFim,
        dataFormatada
    )
)

// ========================================
// APLICAR FILTRO
// ========================================

WebUI.click(
    findTestObject('button_Aplicar')
)

WebUI.delay(15)

// ========================================
// OBJETOS DASHBOARD
// ========================================

TestObject totalAgObj = new TestObject()
totalAgObj.addProperty('id', ConditionType.EQUALS, 'dash-total-ag')

TestObject ticketObj = new TestObject()
ticketObj.addProperty('id', ConditionType.EQUALS, 'dash-ticket')

TestObject totalServicosObj = new TestObject()
totalServicosObj.addProperty('id', ConditionType.EQUALS, 'dash-total-servicos')

TestObject faturamentoObj = new TestObject()
faturamentoObj.addProperty('id', ConditionType.EQUALS, 'dash-faturamento')

TestObject recebidoObj = new TestObject()
recebidoObj.addProperty('id', ConditionType.EQUALS, 'dash-pag-recebido')

TestObject pendenteObj = new TestObject()
pendenteObj.addProperty('id', ConditionType.EQUALS, 'dash-pag-pendente')

// ========================================
// VALIDAR INDICADORES
// ========================================

assert WebUI.getAttribute(
    totalAgObj,
    'innerText'
).trim() == '1'

assert WebUI.getAttribute(
    totalServicosObj,
    'innerText'
).trim() == '1'

assert WebUI.getAttribute(
    ticketObj,
    'innerText'
).contains('0')

assert WebUI.getAttribute(
    faturamentoObj,
    'innerText'
).contains('0')

assert WebUI.getAttribute(
    recebidoObj,
    'innerText'
).contains('0')

assert WebUI.getAttribute(
    pendenteObj,
    'innerText'
).contains('0')

// ========================================
// PROFISSIONAL
// ========================================

TestObject linhaProfissional = new TestObject()

linhaProfissional.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[@id='dash-prof-tbody']/tr[1]"
)

String linha = WebUI.getText(
    linhaProfissional
)

println(
    'LINHA PROFISSIONAL = [' +
    linha +
    ']'
)

assert linha.contains('Daryl')

assert linha.contains('1')

// ========================================
// FATURAMENTO PROFISSIONAL
// ========================================

TestObject faturamentoProfObj = new TestObject()

faturamentoProfObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[@id='dash-prof-tbody']/tr[1]/td[4]"
)

String faturamentoProf = WebUI.getText(
    faturamentoProfObj
)

assert faturamentoProf.contains('0')

// ========================================
// COMISSÃO
// ========================================

TestObject comissaoObj = new TestObject()

comissaoObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[@id='dash-prof-tbody']/tr[1]/td[5]"
)

String comissao = WebUI.getText(
    comissaoObj
)

assert comissao.contains('0')

// ========================================
// CAIXINHA
// ========================================

TestObject caixinhaObj = new TestObject()

caixinhaObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[@id='dash-prof-tbody']/tr[1]/td[6]"
)

String caixinha = WebUI.getText(
    caixinhaObj
)

assert caixinha.contains('0')

// ========================================
// TOTAL RECEBER
// ========================================

TestObject totalReceberObj = new TestObject()

totalReceberObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[@id='dash-prof-tbody']/tr[1]/td[7]"
)

String totalReceber = WebUI.getText(
    totalReceberObj
)

assert totalReceber.contains('0')

// ========================================
// CLIENTES
// ========================================

WebUI.click(
    findTestObject('button_Clientes')
)

WebUI.waitForElementVisible(
    findTestObject(
        'input_Buscar cliente por nome'
    ),
    10
)

WebUI.setText(
    findTestObject(
        'input_Buscar cliente por nome'
    ),
    'automacao'
)

WebUI.click(
    findTestObject('span_cliente automao')
)

// ========================================
// ABA PACOTES
// ========================================

TestObject abaPacotesObj = new TestObject()

abaPacotesObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//button[@data-hist-tab='pacotes']"
)

WebUI.click(
    abaPacotesObj
)

WebUI.delay(2)

// ========================================
// PACOTE ATUALIZADO
// ========================================

TestObject pacoteCompletoObj = new TestObject()

pacoteCompletoObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[contains(text(),'Pacote barba x4')]/ancestor::*[contains(@class,'hist-item')]"
)

String pacoteCompleto = WebUI.getAttribute(
    pacoteCompletoObj,
    'innerText'
)

println(
    'PACOTE COMPLETO = [' +
    pacoteCompleto +
    ']'
)

assert pacoteCompleto.contains('2/4')

assert pacoteCompleto.contains('restam 2')

// ========================================
// STATUS
// ========================================

TestObject statusPacoteObj = new TestObject()

statusPacoteObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//span[contains(@class,'status-ativo')]"
)

String statusPacote = WebUI.getText(
    statusPacoteObj
)

assert statusPacote.contains(
    'ATIVO'
)

// ========================================
// SUCESSO
// ========================================

println(
    'Dashboard validado com sucesso.'
)

println(
    'Pacote atualizado para 2/4 utilizado.'
)

println(
    'CT021 concluído com sucesso.'
)