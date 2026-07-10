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

println(
	'Data utilizada: ' +
	dataFormatada
)

// ========================================
// ABRIR AGENDAMENTO
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

WebUI.waitForElementClickable(
	findTestObject('span_20_00  20_30'),
	10
)

WebUI.click(
	findTestObject('span_20_00  20_30')
)

// ========================================
// USAR PACOTE
// ========================================

WebUI.waitForElementClickable(
	findTestObject(
		'input_Usar pacote Pacote barba x4 (4 restante'
	),
	10
)

WebUI.click(
	findTestObject(
		'input_Usar pacote Pacote barba x4 (4 restante'
	)
)

println(
	'Pacote barba x4 utilizado'
)

// ========================================
// CONCLUIR ATENDIMENTO
// ========================================

WebUI.click(
	findTestObject(
		'button_btn-concluir-atendimento'
	)
)

WebUI.click(
	findTestObject(
		'button_btn-confirmar-concluir-atendimento'
	)
)

// ========================================
// PAGAMENTO
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
	'150'
)

WebUI.click(
	findTestObject('span_pag-confirmar-label')
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
// VALIDAR DASHBOARD
// ========================================

String totalAg = WebUI.getAttribute(
	totalAgObj,
	'innerText'
)

assert totalAg.trim() == '1'

String ticket = WebUI.getAttribute(
	ticketObj,
	'innerText'
)

assert ticket.contains('150')

String totalServicos = WebUI.getAttribute(
	totalServicosObj,
	'innerText'
)

assert totalServicos.trim() == '1'

String faturamento = WebUI.getAttribute(
	faturamentoObj,
	'innerText'
)

assert faturamento.contains('150')

String recebido = WebUI.getAttribute(
	recebidoObj,
	'innerText'
)

assert recebido.contains('150')

String pendente = WebUI.getAttribute(
	pendenteObj,
	'innerText'
)

assert pendente.contains('0')

// ========================================
// POR PROFISSIONAL
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

println(linha)

assert linha.contains('Daryl')

assert linha.contains('150')

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

println(
	'COMISSAO = [' +
	comissao +
	']'
)

// AJUSTAMOS DEPOIS SE NECESSÁRIO
assert comissao.contains('75')

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

println(
	'TOTAL RECEBER = [' +
	totalReceber +
	']'
)

// AJUSTAMOS DEPOIS SE NECESSÁRIO
assert totalReceber.contains('75')

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
// PACOTE CONSUMIDO
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
// SUCESSO
// ========================================

println(
	'Dashboard validado com sucesso.'
)

println(
	'Pacote consumido com sucesso.'
)

println(
	'CT019 concluído com sucesso.'
)