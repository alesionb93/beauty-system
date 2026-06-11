import java.time.LocalDate as LocalDate
import java.time.format.DateTimeFormatter as DateTimeFormatter
import java.util.Arrays as Arrays
import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject
import com.kms.katalon.core.model.FailureHandling as FailureHandling
import com.kms.katalon.core.webui.common.WebUiCommonHelper as WebUiCommonHelper
import com.kms.katalon.core.webui.keyword.WebUiBuiltInKeywords as WebUI
import com.kms.katalon.core.testobject.TestObject as TestObject
import com.kms.katalon.core.testobject.ConditionType as ConditionType

// ========================================
// HELPER
// ========================================
// ========================================
// LOGIN
// ========================================
WebUI.openBrowser('')

WebUI.navigateToUrl('https://slotify.pilotodigital.online/agenda.html')

WebUI.setText(findTestObject('input_Login ou e-mail'), 'automacao')

WebUI.setEncryptedText(findTestObject('input_Senha'), 'Rwhbk+ysi2qFpO8ST+6qJw==')

WebUI.click(findTestObject('button_btn-login'))

WebUI.waitForElementVisible(findTestObject('span_Dom'), 30)

// ========================================
// DESABILITA SMART WAIT
// ========================================
WebUI.disableSmartWait()

// ========================================
// DATA +8 DIAS
// ========================================
String dataFormatada = LocalDate.now().plusDays(8).format(DateTimeFormatter.ofPattern('yyyy-MM-dd'))

println('Data utilizada: ' + dataFormatada)

// ========================================
// NOVO AGENDAMENTO
// ========================================
WebUI.click(findTestObject('button_btn-novo-agendamento'))

boolean abaNomeVisivel = WebUI.waitForElementVisible(findTestObject('button_Nome'), 4, FailureHandling.OPTIONAL)

if (!(abaNomeVisivel)) {
    println('Aba Nome não apareceu. Tentando novamente...')

    WebUI.click(findTestObject('button_btn-novo-agendamento'))

    WebUI.waitForElementVisible(findTestObject('button_Nome'), 4)
}

WebUI.click(findTestObject('button_Nome'))

// ========================================
// CLIENTE
// ========================================
WebUI.waitForElementVisible(findTestObject('input_Digite o nome (ex_ Maria)'), 10)

WebUI.setText(findTestObject('input_Digite o nome (ex_ Maria)'), 'automacao')

WebUI.click(findTestObject('button_Selecionar'))

// ========================================
// PROFISSIONAL
// ========================================
WebUI.waitForElementClickable(findTestObject('div_Selecione'), 10)

WebUI.click(findTestObject('div_Selecione'))

WebUI.waitForElementClickable(findTestObject('div_Daryl'), 10)

WebUI.click(findTestObject('div_Daryl'))

// ========================================
// SERVIÇO
// ========================================
WebUI.selectOptionByLabel(findTestObject('select_Selecione.Barba CompletaBarba TerapiaCo'), 'Barba Terapia', false)

// ========================================
// DATA AGENDAMENTO
// ========================================
def campoData = WebUiCommonHelper.findWebElement(findTestObject('input_ag-data'), 10)

WebUI.executeJavaScript('\n\targuments[0].value = arguments[1];\n\targuments[0].dispatchEvent(new Event(\'input\', { bubbles: true }));\n\targuments[0].dispatchEvent(new Event(\'change\', { bubbles: true }));\n\t', 
    Arrays.asList(campoData, dataFormatada))

// ========================================
// HORA
// ========================================
WebUI.selectOptionByValue(findTestObject('select_ag-hora-h'), '20', false)

// ========================================
// SALVAR
// ========================================
WebUI.click(findTestObject('button_Salvar'))

WebUI.delay(2)

// ========================================
// DASHBOARD
// ========================================
WebUI.click(findTestObject('button_Dashboard'))

WebUI.waitForElementVisible(findTestObject('input_dash-inicio'), 10)

// ========================================
// DATA INÍCIO
// ========================================
def dashInicio = WebUiCommonHelper.findWebElement(findTestObject('input_dash-inicio'), 10)

WebUI.executeJavaScript('\n\targuments[0].value = arguments[1];\n\targuments[0].dispatchEvent(new Event(\'input\', { bubbles: true }));\n\targuments[0].dispatchEvent(new Event(\'change\', { bubbles: true }));\n\t', 
    Arrays.asList(dashInicio, dataFormatada))

// ========================================
// DATA FIM
// ========================================
def dashFim = WebUiCommonHelper.findWebElement(findTestObject('input_dash-fim'), 10)

WebUI.executeJavaScript('\n\targuments[0].value = arguments[1];\n\targuments[0].dispatchEvent(new Event(\'input\', { bubbles: true }));\n\targuments[0].dispatchEvent(new Event(\'change\', { bubbles: true }));\n\t', 
    Arrays.asList(dashFim, dataFormatada))

// ========================================
// APLICAR FILTRO
// ========================================
WebUI.click(findTestObject('button_Aplicar'))

// ========================================
// AGUARDAR DASHBOARD
// ========================================
WebUI.delay(3)

// ========================================
// VALIDAÇÕES CT008
// ========================================
String totalAg = WebUI.getText(byId('dash-total-ag'))

println('TOTAL AGENDAMENTOS = ' + totalAg)

assert totalAg.trim() == '0'

String ticket = WebUI.getText(byId('dash-ticket'))

println('TICKET MÉDIO = ' + ticket)

assert ticket.contains('0')

String totalServicos = WebUI.getText(byId('dash-total-servicos'))

println('TOTAL SERVIÇOS = ' + totalServicos)

assert totalServicos.trim() == '0'

String faturamento = WebUI.getText(byId('dash-faturamento'))

println('FATURAMENTO = ' + faturamento)

assert faturamento.contains('0')

String recebido = WebUI.getText(byId('dash-pag-recebido'))

println('RECEBIDO = ' + recebido)

assert recebido.contains('0')

String pendente = WebUI.getText(byId('dash-pag-pendente'))

println('PENDENTE = ' + pendente)

assert pendente.contains('80')

String semDados = WebUI.getText(
    byId('dash-prof-cards-mobile')
)

println('PROFISSIONAIS = [' + semDados + ']')

// A UI atual não exibe mais "Sem dados".
// Validamos que não existe conteúdo de profissionais.

assert semDados != null
assert semDados.trim().isEmpty()

println('Teste finalizado com sucesso.')

TestObject byId(String id) {
    TestObject to = new TestObject(id)

    to.addProperty('id', ConditionType.EQUALS, id)

    return to
}

