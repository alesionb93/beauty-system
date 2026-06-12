import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject
import com.kms.katalon.core.webui.keyword.WebUiBuiltInKeywords as WebUI

int TIMEOUT = 20

try {
    WebUI.openBrowser('')
    WebUI.maximizeWindow()
    WebUI.navigateToUrl('https://slotify.pilotodigital.online/')
    WebUI.waitForPageLoad(TIMEOUT)

    def loginField = findTestObject('input_Login ou e-mail')
    def senhaField = findTestObject('input_Senha')
    def btnLogin   = findTestObject('button_btn-login')
    def btnSair    = findTestObject('button_Sair')
    def pSistema   = findTestObject('p_Sistema de Agendamento')

    WebUI.waitForElementVisible(loginField, TIMEOUT)
    WebUI.click(loginField)
    WebUI.setText(loginField, 'alesio')

    WebUI.waitForElementVisible(senhaField, TIMEOUT)
    WebUI.click(senhaField)
    WebUI.setEncryptedText(senhaField, 'Rwhbk+ysi2qFpO8ST+6qJw==')

    WebUI.waitForElementClickable(btnLogin, TIMEOUT)
    try { WebUI.click(btnLogin) }
    catch (Throwable t) {
        WebUI.executeJavaScript('arguments[0].click();', Arrays.asList(WebUI.findWebElement(btnLogin, TIMEOUT)))
    }
    WebUI.waitForPageLoad(TIMEOUT)

    WebUI.waitForElementPresent(btnSair, TIMEOUT)
    WebUI.waitForElementVisible(btnSair, TIMEOUT)
    WebUI.scrollToElement(btnSair, TIMEOUT)
    WebUI.waitForElementClickable(btnSair, TIMEOUT)
    try { WebUI.click(btnSair) }
    catch (Throwable t) {
        WebUI.executeJavaScript('arguments[0].click();', Arrays.asList(WebUI.findWebElement(btnSair, TIMEOUT)))
    }
    WebUI.waitForPageLoad(TIMEOUT)

    WebUI.waitForElementVisible(pSistema, TIMEOUT)
    WebUI.verifyElementVisible(pSistema)
} finally {
    WebUI.closeBrowser()
}
