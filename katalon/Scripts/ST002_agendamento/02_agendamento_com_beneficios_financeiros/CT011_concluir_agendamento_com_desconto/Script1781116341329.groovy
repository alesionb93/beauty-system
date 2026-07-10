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

WebUI.disableSmartWait()

// ========================================
// DATA +8 DIAS
// ========================================
// Igual ao Playwright CT011

LocalDate dataAgendamento = LocalDate.now().plusDays(8)

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

WebUI.click(
	findTestObject('button_btn-concluir-atendimento')
)

WebUI.click(
	findTestObject('button_btn-confirmar-concluir-atendimento')
)

// ========================================
// APLICAR DESCONTO
// ========================================

WebUI.click(
	findTestObject('button_desc-apply-btn')
)

WebUI.setText(
	findTestObject('input_Login ou e-mail do administrador'),
	'automacao'
)

WebUI.setEncryptedText(
	findTestObject('input_Senha do administrador'),
	'Rwhbk+ysi2qFpO8ST+6qJw=='
)

WebUI.click(
	findTestObject('button_Autorizar')
)

WebUI.waitForElementVisible(
	findTestObject('input_Ex._ 10,00'),
	10
)

WebUI.setText(
	findTestObject('input_Ex._ 10,00'),
	'10'
)

// ========================================
// VALIDAR PREVIEW DESCONTO
// ========================================

String valorOriginal = WebUI.getText(
	findTestObject('strong_desc-prev-orig')
)

String valorDesconto = WebUI.getText(
	findTestObject('strong_desc-prev-desc')
)

String valorFinal = WebUI.getText(
	findTestObject('strong_desc-prev-final')
)

println('ORIGINAL = ' + valorOriginal)
println('DESCONTO = ' + valorDesconto)
println('FINAL = ' + valorFinal)

assert valorOriginal.contains('80')
assert valorDesconto.contains('10')
assert valorFinal.contains('70')

// ========================================
// CONFIRMAR DESCONTO
// ========================================

WebUI.click(
	findTestObject('button_desc-confirmar')
)

// ========================================
// VALIDAR PAGAMENTO
// ========================================

String subtotal = WebUI.getText(
	findTestObject('strong_pag-subtotal')
)

String desconto = WebUI.getText(
	findTestObject('strong_pag-desc-val')
)

String total = WebUI.getText(
	findTestObject('span_pag-total')
)

println('SUBTOTAL = ' + subtotal)
println('DESCONTO = ' + desconto)
println('TOTAL = ' + total)

assert subtotal.contains('80')
assert desconto.contains('10')
assert total.contains('70')

// ========================================
// INFORMAR VALOR PAGO
// ========================================

WebUI.clearText(
	findTestObject('input_0,00'),
	FailureHandling.OPTIONAL
)

WebUI.setText(
	findTestObject('input_0,00'),
	'70'
)

// ========================================
// CONFIRMAR PAGAMENTO
// ========================================

WebUI.click(
	findTestObject('span_pag-confirmar-label')
)

WebUI.delay(3)

// ========================================
// FLAG COMISSÃO
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
// DATA INICIO
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
// DASHBOARD
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

assert WebUI.getAttribute(totalAgObj,'innerText').trim() == '1'

assert WebUI.getAttribute(totalServicosObj,'innerText').trim() == '1'

assert WebUI.getAttribute(ticketObj,'innerText').contains('70')

assert WebUI.getAttribute(faturamentoObj,'innerText').contains('70')

assert WebUI.getAttribute(recebidoObj,'innerText').contains('70')

assert WebUI.getAttribute(pendenteObj,'innerText').contains('0')

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

println('COMISSAO = ' + comissao)

assert comissao.contains('35')

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

println('TOTAL RECEBER = ' + totalReceber)

assert totalReceber.contains('35')

// ========================================
// SUCESSO
// ========================================

println('CT011 concluído com sucesso.')