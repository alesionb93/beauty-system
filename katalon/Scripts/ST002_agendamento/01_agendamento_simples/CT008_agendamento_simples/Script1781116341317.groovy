import java.time.LocalDate as LocalDate
import java.time.format.DateTimeFormatter as DateTimeFormatter
import java.util.Arrays as Arrays

import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject

import com.kms.katalon.core.model.FailureHandling as FailureHandling
import com.kms.katalon.core.testobject.ConditionType as ConditionType
import com.kms.katalon.core.testobject.TestObject as TestObject
import com.kms.katalon.core.webui.common.WebUiCommonHelper as WebUiCommonHelper
import com.kms.katalon.core.webui.keyword.WebUiBuiltInKeywords as WebUI

import org.openqa.selenium.WebElement
import org.openqa.selenium.StaleElementReferenceException
import org.openqa.selenium.ElementClickInterceptedException
import org.openqa.selenium.ElementNotInteractableException

// =========================================================
// CONFIG
// =========================================================
int TIMEOUT       = 20
int TIMEOUT_SHORT = 8
int TIMEOUT_LONG  = 40

// =========================================================
// HELPERS (CI/CD HARDENING)
// =========================================================
def safeClick = { TestObject to, int t = TIMEOUT ->
    int attempts = 3
    Throwable last = null
    for (int i = 0; i < attempts; i++) {
        try {
            WebUI.waitForElementPresent(to, t)
            WebUI.waitForElementVisible(to, t)
            WebUI.scrollToElement(to, t)
            WebUI.waitForElementClickable(to, t)
            try {
                WebUI.click(to)
            } catch (ElementClickInterceptedException | ElementNotInteractableException ignored) {
                WebUI.comment('[safeClick] Fallback JS click')
                WebElement el = WebUiCommonHelper.findWebElement(to, t)
                WebUI.executeJavaScript('arguments[0].click();', Arrays.asList(el))
            }
            return
        } catch (StaleElementReferenceException sere) {
            last = sere
            WebUI.comment('[safeClick] Stale, retry ' + (i + 1))
            WebUI.delay(1)
        } catch (Throwable th) {
            last = th
            WebUI.comment('[safeClick] retry ' + (i + 1) + ' -> ' + th.getClass().getSimpleName())
            WebUI.delay(1)
        }
    }
    throw last
}

def safeSetText = { TestObject to, String value, int t = TIMEOUT ->
    WebUI.waitForElementPresent(to, t)
    WebUI.waitForElementVisible(to, t)
    WebUI.scrollToElement(to, t)
    try { WebUI.click(to) } catch (Throwable ignored) {}
    try {
        WebUI.clearText(to, FailureHandling.OPTIONAL)
        WebUI.setText(to, value)
    } catch (Throwable th) {
        WebUI.comment('[safeSetText] Fallback JS -> ' + th.getClass().getSimpleName())
        WebElement el = WebUiCommonHelper.findWebElement(to, t)
        WebUI.executeJavaScript(
            'arguments[0].value = arguments[1];' +
            'arguments[0].dispatchEvent(new Event("input",{bubbles:true}));' +
            'arguments[0].dispatchEvent(new Event("change",{bubbles:true}));',
            Arrays.asList(el, value))
    }
}

def safeSetEncrypted = { TestObject to, String value, int t = TIMEOUT ->
    WebUI.waitForElementPresent(to, t)
    WebUI.waitForElementVisible(to, t)
    WebUI.scrollToElement(to, t)
    try { WebUI.click(to) } catch (Throwable ignored) {}
    WebUI.setEncryptedText(to, value)
}

def setDateJS = { TestObject to, String value, int t = TIMEOUT ->
    WebUI.waitForElementPresent(to, t)
    WebElement el = WebUiCommonHelper.findWebElement(to, t)
    WebUI.executeJavaScript(
        'arguments[0].value = arguments[1];' +
        'arguments[0].dispatchEvent(new Event("input",{bubbles:true}));' +
        'arguments[0].dispatchEvent(new Event("change",{bubbles:true}));',
        Arrays.asList(el, value))
}

def byId = { String id ->
    TestObject to = new TestObject(id)
    to.addProperty('id', ConditionType.EQUALS, id)
    return to
}

// =========================================================
// EXECUTION
// =========================================================
try {
    WebUI.openBrowser('')
    WebUI.maximizeWindow()
    WebUI.navigateToUrl('https://slotify.pilotodigital.online/agenda.html')
    WebUI.waitForPageLoad(TIMEOUT_LONG)

    // ---------------- LOGIN ----------------
    safeSetText(findTestObject('input_Login ou e-mail'), 'automacao')
    safeSetEncrypted(findTestObject('input_Senha'), 'Rwhbk+ysi2qFpO8ST+6qJw==')
    safeClick(findTestObject('button_btn-login'))
    WebUI.waitForPageLoad(TIMEOUT_LONG)
    WebUI.waitForElementVisible(findTestObject('span_Dom'), TIMEOUT_LONG)

    WebUI.disableSmartWait()

    // ---------------- DATA +7 ----------------
    String dataFormatada = LocalDate.now().plusDays(7).format(DateTimeFormatter.ofPattern('yyyy-MM-dd'))
    WebUI.comment('Data utilizada: ' + dataFormatada)

    // ---------------- NOVO AGENDAMENTO ----------------
    safeClick(findTestObject('button_btn-novo-agendamento'))
    boolean abaNomeVisivel = WebUI.waitForElementVisible(
        findTestObject('button_Nome'), TIMEOUT_SHORT, FailureHandling.OPTIONAL)
    if (!abaNomeVisivel) {
        WebUI.comment('Aba Nome nao apareceu. Retry.')
        safeClick(findTestObject('button_btn-novo-agendamento'))
        WebUI.waitForElementVisible(findTestObject('button_Nome'), TIMEOUT)
    }
    safeClick(findTestObject('button_Nome'))

    // ---------------- CLIENTE ----------------
    safeSetText(findTestObject('input_Digite o nome (ex_ Maria)'), 'automacao')
    safeClick(findTestObject('button_Selecionar'))

    // ---------------- PROFISSIONAL ----------------
    safeClick(findTestObject('div_Selecione'))
    safeClick(findTestObject('div_Daryl'))

    // ---------------- SERVICO ----------------
    WebUI.waitForElementVisible(findTestObject('select_Selecione.Barba CompletaBarba TerapiaCo'), TIMEOUT)
    WebUI.selectOptionByLabel(findTestObject('select_Selecione.Barba CompletaBarba TerapiaCo'),
        'Barba Terapia', false)

    // ---------------- DATA / HORA ----------------
    setDateJS(findTestObject('input_ag-data'), dataFormatada)
    WebUI.waitForElementVisible(findTestObject('select_ag-hora-h'), TIMEOUT)
    WebUI.selectOptionByValue(findTestObject('select_ag-hora-h'), '20', false)

    // ---------------- SALVAR ----------------
    safeClick(findTestObject('button_Salvar'))

    // ---------------- DASHBOARD ----------------
    safeClick(findTestObject('button_Dashboard'))
    WebUI.waitForPageLoad(TIMEOUT_LONG)
    WebUI.waitForElementVisible(findTestObject('input_dash-inicio'), TIMEOUT)

    setDateJS(findTestObject('input_dash-inicio'), dataFormatada)
    setDateJS(findTestObject('input_dash-fim'), dataFormatada)

    safeClick(findTestObject('button_Aplicar'))
    WebUI.waitForElementVisible(byId('dash-total-ag'), TIMEOUT_LONG)
    // pequena espera para recalculo de KPIs
    WebUI.waitForElementPresent(byId('dash-faturamento'), TIMEOUT_LONG)

    // ---------------- VALIDACOES ----------------
    String totalAg       = WebUI.getText(byId('dash-total-ag'))
    String ticket        = WebUI.getText(byId('dash-ticket'))
    String totalServicos = WebUI.getText(byId('dash-total-servicos'))
    String faturamento   = WebUI.getText(byId('dash-faturamento'))
    String recebido      = WebUI.getText(byId('dash-pag-recebido'))
    String pendente      = WebUI.getText(byId('dash-pag-pendente'))
    String semDados      = WebUI.getText(byId('dash-prof-cards-mobile'))

    WebUI.comment('TOTAL AGENDAMENTOS = ' + totalAg)
    WebUI.comment('TICKET MEDIO = ' + ticket)
    WebUI.comment('TOTAL SERVICOS = ' + totalServicos)
    WebUI.comment('FATURAMENTO = ' + faturamento)
    WebUI.comment('RECEBIDO = ' + recebido)
    WebUI.comment('PENDENTE = ' + pendente)
    WebUI.comment('PROFISSIONAIS = [' + semDados + ']')

    assert totalAg.trim() == '0'
    assert ticket.contains('0')
    assert totalServicos.trim() == '0'
    assert faturamento.contains('0')
    assert recebido.contains('0')
    assert pendente.contains('80')
    assert semDados != null
    assert semDados.trim().isEmpty()

    WebUI.comment('Teste CT008 finalizado com sucesso.')
} finally {
    try { WebUI.closeBrowser() } catch (Throwable ignored) {}
}
