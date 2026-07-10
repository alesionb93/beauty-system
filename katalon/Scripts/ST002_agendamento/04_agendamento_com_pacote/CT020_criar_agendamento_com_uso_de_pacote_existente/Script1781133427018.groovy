import java.time.LocalDate as LocalDate
import java.time.format.DateTimeFormatter as DateTimeFormatter
import java.util.Arrays as Arrays

import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject

import com.kms.katalon.core.model.FailureHandling as FailureHandling
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
// NOVO AGENDAMENTO
// ========================================

WebUI.click(
    findTestObject('button_btn-novo-agendamento')
)

boolean abaNomeVisivel = WebUI.waitForElementVisible(
    findTestObject('button_Nome'),
    4,
    FailureHandling.OPTIONAL
)

if (!abaNomeVisivel) {

    println(
        'Aba Nome não apareceu. Tentando novamente...'
    )

    WebUI.click(
        findTestObject('button_btn-novo-agendamento')
    )

    WebUI.waitForElementVisible(
        findTestObject('button_Nome'),
        4
    )
}

WebUI.click(
    findTestObject('button_Nome')
)

// ========================================
// CLIENTE
// ========================================

WebUI.waitForElementVisible(
    findTestObject(
        'input_Digite o nome (ex_ Maria)'
    ),
    10
)

WebUI.setText(
    findTestObject(
        'input_Digite o nome (ex_ Maria)'
    ),
    'automacao'
)

WebUI.click(
    findTestObject('button_Selecionar')
)

// ========================================
// PROFISSIONAL
// ========================================

WebUI.click(
    findTestObject('div_Selecione')
)

WebUI.click(
    findTestObject('div_Daryl')
)

// ========================================
// SERVIÇO
// ========================================

WebUI.selectOptionByLabel(
    findTestObject(
        'select_Selecione.Barba CompletaBarba TerapiaCo'
    ),
    'Barba Completa',
    false
)

// ========================================
// VALIDAR PACOTE DISPONÍVEL
// ========================================

TestObject pacoteDisponivelObj = new TestObject()

pacoteDisponivelObj.addProperty(
    'xpath',
    ConditionType.EQUALS,
    "//*[contains(text(),'3 restantes')]"
)

String pacoteDisponivel = WebUI.getText(
    pacoteDisponivelObj
)

println(
    'PACOTE DISPONIVEL = [' +
    pacoteDisponivel +
    ']'
)

assert pacoteDisponivel.contains(
    '3 restantes'
)

// ========================================
// UTILIZAR PACOTE
// ========================================

WebUI.click(
    findTestObject(
        'input_Usar pacote Pacote barba x4 (4 restante'
    )
)

println(
    'Pacote barba x4 selecionado'
)

// ========================================
// DATA AGENDAMENTO
// ========================================

def campoData = WebUiCommonHelper.findWebElement(
    findTestObject('input_ag-data'),
    10
)

WebUI.executeJavaScript(
    '''
    arguments[0].value = arguments[1];
    arguments[0].dispatchEvent(new Event("input",{bubbles:true}));
    arguments[0].dispatchEvent(new Event("change",{bubbles:true}));
    ''',
    Arrays.asList(
        campoData,
        dataFormatada
    )
)

// ========================================
// HORA
// ========================================

WebUI.selectOptionByValue(
    findTestObject('select_ag-hora-h'),
    '20',
    false
)

// ========================================
// SALVAR
// ========================================

WebUI.click(
    findTestObject('button_Salvar')
)

WebUI.delay(3)

// ========================================
// DASHBOARD
// ========================================

WebUI.click(
    findTestObject('button_Dashboard')
)

WebUI.waitForElementVisible(
    findTestObject('input_dash-inicio'),
    10
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

WebUI.delay(10)

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
// VALIDAR DASHBOARD ZERADO
// ========================================

assert WebUI.getAttribute(totalAgObj,'innerText').trim() == '0'
assert WebUI.getAttribute(totalServicosObj,'innerText').trim() == '0'
assert WebUI.getAttribute(ticketObj,'innerText').contains('0')
assert WebUI.getAttribute(faturamentoObj,'innerText').contains('0')
assert WebUI.getAttribute(recebidoObj,'innerText').contains('0')
assert WebUI.getAttribute(pendenteObj,'innerText').contains('0')

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
// VALIDAR PACOTE
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

assert pacoteCompleto.contains('1/4')
assert pacoteCompleto.contains('restam 3')

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
    'Pacote preservado com sucesso.'
)

println(
    'CT020 concluído com sucesso.'
)