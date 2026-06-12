import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject
import com.kms.katalon.core.model.FailureHandling as FailureHandling
import com.kms.katalon.core.webui.keyword.WebUiBuiltInKeywords as WebUI
import internal.GlobalVariable as GlobalVariable

int TIMEOUT = 20

try {
    WebUI.openBrowser('')
    WebUI.maximizeWindow()
    WebUI.navigateToUrl('https://slotify.pilotodigital.online/')
    WebUI.waitForPageLoad(TIMEOUT)

    def loginField = findTestObject('Page_Slotify - Login/input_Login ou e-mail')
    def senhaField = findTestObject('Page_Slotify - Login/input_Senha')
    def btnLogin   = findTestObject('Page_Slotify - Login/button_btn-login')
    def tituloCli  = findTestObject('Page_Beauty System - Selecionar Cliente/h1_SELECIONE O CLIENTE')

    WebUI.waitForElementPresent(loginField, TIMEOUT)
    WebUI.waitForElementVisible(loginField, TIMEOUT)
    WebUI.click(loginField)
    WebUI.setText(loginField, 'alesio')

    WebUI.waitForElementVisible(senhaField, TIMEOUT)
    WebUI.click(senhaField)
    WebUI.setEncryptedText(senhaField, 'Rwhbk+ysi2qFpO8ST+6qJw==')

    WebUI.waitForElementVisible(btnLogin, TIMEOUT)
    WebUI.scrollToElement(btnLogin, TIMEOUT)
    WebUI.waitForElementClickable(btnLogin, TIMEOUT)
    try {
        WebUI.click(btnLogin)
    } catch (Throwable t) {
        WebUI.executeJavaScript('arguments[0].click();', Arrays.asList(WebUI.findWebElement(btnLogin, TIMEOUT)))
    }

    WebUI.waitForPageLoad(TIMEOUT)
    WebUI.waitForElementPresent(tituloCli, TIMEOUT)
    WebUI.waitForElementVisible(tituloCli, TIMEOUT)
    WebUI.verifyElementVisible(tituloCli)
} finally {
    WebUI.closeBrowser()
}
