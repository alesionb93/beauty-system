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
// DATA +12 DIAS
// ========================================

LocalDate dataAgendamento = LocalDate.now().plusDays(12)

String dataFormatada = dataAgendamento.format(
	DateTimeFormatter.ofPattern('yyyy-MM-dd')
)

println('Data utilizada: ' + dataFormatada)

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

WebUI.waitForElementClickable(
	findTestObject('div_Selecione'),
	10
)

WebUI.click(
	findTestObject('div_Selecione')
)

WebUI.waitForElementClickable(
	findTestObject('div_Daryl'),
	10
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
// VENDER PACOTE
// ========================================

WebUI.waitForElementClickable(
	findTestObject(
		'input_Vender pacote Pacote barba x4 (4 usos _'
	),
	10
)

WebUI.click(
	findTestObject(
		'input_Vender pacote Pacote barba x4 (4 usos _'
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
// VALIDAR DASHBOARD
// ========================================

String totalAg = WebUI.getAttribute(
	totalAgObj,
	'innerText'
)

println(
	'TOTAL AGENDAMENTOS = [' +
	totalAg +
	']'
)

assert totalAg.trim() == '0'

String ticket = WebUI.getAttribute(
	ticketObj,
	'innerText'
)

println(
	'TICKET MÉDIO = [' +
	ticket +
	']'
)

assert ticket.contains('0')

String totalServicos = WebUI.getAttribute(
	totalServicosObj,
	'innerText'
)

println(
	'TOTAL SERVIÇOS = [' +
	totalServicos +
	']'
)

assert totalServicos.trim() == '0'

String faturamento = WebUI.getAttribute(
	faturamentoObj,
	'innerText'
)

println(
	'FATURAMENTO = [' +
	faturamento +
	']'
)

assert faturamento.contains('0')

String recebido = WebUI.getAttribute(
	recebidoObj,
	'innerText'
)

println(
	'RECEBIDO = [' +
	recebido +
	']'
)

assert recebido.contains('0')

String pendente = WebUI.getAttribute(
	pendenteObj,
	'innerText'
)

println(
	'PENDENTE = [' +
	pendente +
	']'
)

assert pendente.contains('150')

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

WebUI.waitForElementClickable(
    abaPacotesObj,
    10
)

WebUI.click(
    abaPacotesObj
)

WebUI.delay(1)

// ========================================
// PACOTE VENDIDO
// ========================================

TestObject pacoteNomeObj = new TestObject()

pacoteNomeObj.addProperty(
	'xpath',
	ConditionType.EQUALS,
	"//strong[contains(text(),'Pacote barba x4')]"
)

String pacoteNome = WebUI.getText(
	pacoteNomeObj
)

println('=================================')
println('PACOTE NOME')
println(pacoteNome)
println('=================================')

assert pacoteNome.contains(
	'Pacote barba x4'
)

// ========================================
// SERVIÇO DO PACOTE
// ========================================

TestObject servicoPacoteObj = new TestObject()

servicoPacoteObj.addProperty(
	'xpath',
	ConditionType.EQUALS,
	"//*[contains(text(),'Serviço: Barba Completa')]"
)

String servicoPacote = WebUI.getText(
	servicoPacoteObj
)

println(
	'SERVICO PACOTE = [' +
	servicoPacote +
	']'
)

assert servicoPacote.contains(
	'Barba Completa'
)

// ========================================
// UTILIZAÇÃO DO PACOTE
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

assert pacoteCompleto.contains('0/4')

assert pacoteCompleto.contains('restam 4')

// ========================================
// SUCESSO
// ========================================

println(
	'Dashboard validado com sucesso.'
)

println(
	'Pacote validado com sucesso.'
)

println(
	'CT018 concluído com sucesso.'
)