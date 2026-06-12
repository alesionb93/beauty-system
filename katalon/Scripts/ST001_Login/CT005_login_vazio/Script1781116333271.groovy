import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject
import com.kms.katalon.core.webui.keyword.WebUiBuiltInKeywords as WebUI

int TIMEOUT = 20

try {
    WebUI.openBrowser('')
    WebUI.maximizeWindow()
    WebUI.navigateToUrl('https://slotify.pilotodigital.online/')
    WebUI.waitForPageLoad(TIMEOUT)

    def btnLogin = findTestObject('button_btn-login')
    def erro     = findTestObject('p_login-error')

    WebUI.waitForElementPresent(btnLogin, TIMEOUT)
    WebUI.waitForElementVisible(btnLogin, TIMEOUT)
    WebUI.scrollToElement(btnLogin, TIMEOUT)
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
