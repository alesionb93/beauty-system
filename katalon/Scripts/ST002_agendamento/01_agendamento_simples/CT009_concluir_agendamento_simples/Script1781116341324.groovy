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
// DATA +7 DIAS
// ========================================

LocalDate dataAgendamento = LocalDate.now().plusDays(7)

String dataFormatada = dataAgendamento.format(
    DateTimeFormatter.ofPattern('yyyy-MM-dd')
)

println('Data utilizada: ' + dataFormatada)

// ========================================
// ABRIR AGENDAMENTO
// ========================================

int dia = dataAgendamento.getDayOfMonth()

println('Dia utilizado: ' + dia)

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

WebUI.waitForElementClickable(
    findTestObject('div_20_00  21_00'),
    10
)

WebUI.click(
    findTestObject('div_20_00  21_00')
)

// ========================================
// CONCLUIR ATENDIMENTO
// ========================================

WebUI.waitForElementClickable(
    findTestObject('button_btn-concluir-atendimento'),
    10
)

WebUI.click(
    findTestObject('button_btn-concluir-atendimento')
)

WebUI.waitForElementClickable(
    findTestObject('button_btn-confirmar-concluir-atendimento'),
    10
)

WebUI.click(
    findTestObject('button_btn-confirmar-concluir-atendimento')
)

// ========================================
// INFORMAR VALOR
// ========================================

WebUI.waitForElementVisible(
    findTestObject('input_0,00'),
    10
)

WebUI.clearText(
    findTestObject('input_0,00'),
    FailureHandling.OPTIONAL
)

WebUI.setText(
    findTestObject('input_0,00'),
    '80'
)

// ========================================
// CONFIRMAR PAGAMENTO
// ========================================

WebUI.click(
    findTestObject('span_pag-confirmar-label')
)

WebUI.delay(3)

// ========================================
// ATIVA FLAG DE COMISSÃO
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
// LOG FILTRO
// ========================================

println(
    'DATA INICIO = ' +
    WebUI.getAttribute(
        findTestObject('input_dash-inicio'),
        'value'
    )
)

println(
    'DATA FIM = ' +
    WebUI.getAttribute(
        findTestObject('input_dash-fim'),
        'value'
    )
)

// ========================================
// APLICAR FILTRO
// ========================================

WebUI.click(
    findTestObject('button_Aplicar')
)

// dashboard demora recalcular

WebUI.delay(15)

// ========================================
// OBJETOS DASHBOARD
// ========================================

TestObject totalAgObj = new TestObject()
totalAgObj.addProperty(
    'id',
    ConditionType.EQUALS,
    'dash-total-ag'
)

TestObject ticketObj = new TestObject()
ticketObj.addProperty(
    'id',
    ConditionType.EQUALS,
    'dash-ticket'
)

TestObject totalServicosObj = new TestObject()
totalServicosObj.addProperty(
    'id',
    ConditionType.EQUALS,
    'dash-total-servicos'
)

TestObject faturamentoObj = new TestObject()
faturamentoObj.addProperty(
    'id',
    ConditionType.EQUALS,
    'dash-faturamento'
)

TestObject recebidoObj = new TestObject()
recebidoObj.addProperty(
    'id',
    ConditionType.EQUALS,
    'dash-pag-recebido'
)

TestObject pendenteObj = new TestObject()
pendenteObj.addProperty(
    'id',
    ConditionType.EQUALS,
    'dash-pag-pendente'
)

// ========================================
// VALIDAR INDICADORES
// ========================================

String totalAg = WebUI.getAttribute(
    totalAgObj,
    'innerText'
)

println('TOTAL AGENDAMENTOS = [' + totalAg + ']')

assert totalAg.trim() == '1'

String ticket = WebUI.getAttribute(
    ticketObj,
    'innerText'
)

println('TICKET MÉDIO = [' + ticket + ']')

assert ticket.contains('80')

String totalServicos = WebUI.getAttribute(
    totalServicosObj,
    'innerText'
)

println('TOTAL SERVIÇOS = [' + totalServicos + ']')

assert totalServicos.trim() == '1'

String faturamento = WebUI.getAttribute(
    faturamentoObj,
    'innerText'
)

println('FATURAMENTO = [' + faturamento + ']')

assert faturamento.contains('80')

String recebido = WebUI.getAttribute(
    recebidoObj,
    'innerText'
)

println('RECEBIDO = [' + recebido + ']')

assert recebido.contains('80')

String pendente = WebUI.getAttribute(
    pendenteObj,
    'innerText'
)

println('PENDENTE = [' + pendente + ']')

assert pendente.contains('0')

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

println('COMISSAO = [' + comissao + ']')

assert comissao.contains('40')

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

println('TOTAL RECEBER = [' + totalReceber + ']')

assert totalReceber.contains('40')

// ========================================
// SUCESSO
// ========================================

println('Dashboard validado com sucesso.')

println('CT009 concluído com sucesso.')