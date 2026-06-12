import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject
import com.kms.katalon.core.webui.keyword.WebUiBuiltInKeywords as WebUI

int TIMEOUT = 20

try {
    WebUI.openBrowser('')
    WebUI.maximizeWindow()
    WebUI.navigateToUrl('https://slotify.pilotodigital.online/')
    WebUI.waitForPageLoad(TIMEOUT)

    def loginField = findTestObject('Page_Slotify - Login/input_Login ou e-mail')
    def senhaField = findTestObject('Page_Slotify - Login/input_Senha')
    def btnLogin   = findTestObject('Page_Slotify - Login/button_btn-login')
    def erro       = findTestObject('Page_Slotify - Login/p_login-error')

    WebUI.waitForElementVisible(loginField, TIMEOUT)
    WebUI.click(loginField)
    WebUI.setText(loginField, 'colabuser@gmail.com')

    WebUI.waitForElementVisible(senhaField, TIMEOUT)
    WebUI.click(senhaField)
    WebUI.setEncryptedText(senhaField, 'Rwhbk+ysi2qFpO8ST+6qJw==')

    WebUI.waitForElementClickable(btnLogin, TIMEOUT)
    try { WebUI.click(btnLogin) }
    catch (Throwable t) {
        WebUI.executeJavaScript('arguments[0].click();', Arrays.asList(WebUI.findWebElement(btnLogin, TIMEOUT)))
    }

    WebUI.waitForElementPresent(erro, TIMEOUT)
    WebUI.waitForElementVisible(erro, TIMEOUT)
    WebUI.verifyElementVisible(erro)
} finally {
    WebUI.closeBrowser()
}
