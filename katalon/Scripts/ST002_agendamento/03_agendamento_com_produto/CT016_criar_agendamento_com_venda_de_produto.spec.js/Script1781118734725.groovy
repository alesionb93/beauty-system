import java.time.LocalDate as LocalDate
import java.time.format.DateTimeFormatter as DateTimeFormatter
import java.util.Arrays as Arrays

import static com.kms.katalon.core.testobject.ObjectRepository.findTestObject

import com.kms.katalon.core.model.FailureHandling as FailureHandling
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
// DATA +11 DIAS
// ========================================
//
// CT016 cria um agendamento futuro
// contendo:
//
// Serviço ............ Barba Terapia (80)
// Produto ............ Pro Shampoo (40)
//
// Total futuro ....... 120
//
// Como o atendimento ainda não foi
// concluído, o Dashboard deverá mostrar:
//
// Agendamentos ....... 0
// Ticket Médio ....... 0
// Serviços ........... 0
// Faturamento ........ 0
// Recebido ........... 0
// Pendente ........... 120
//

String dataFormatada = LocalDate.now()
    .plusDays(11)
    .format(
        DateTimeFormatter.ofPattern(
            'yyyy-MM-dd'
        )
    )

println(
    'Data utilizada: ' +
    dataFormatada
)

// ========================================
// NOVO AGENDAMENTO
// ========================================

WebUI.click(
    findTestObject(
        'button_btn-novo-agendamento'
    )
)

boolean abaNomeVisivel =
    WebUI.waitForElementVisible(
        findTestObject('button_Nome'),
        4,
        FailureHandling.OPTIONAL
    )

if (!abaNomeVisivel) {

    println(
        'Aba Nome não apareceu. Tentando novamente...'
    )

    WebUI.click(
        findTestObject(
            'button_btn-novo-agendamento'
        )
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
    findTestObject(
        'button_Selecionar'
    )
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
    'Barba Terapia',
    false
)

// ========================================
// PRODUTO
// ========================================
//
// Adiciona:
//
// Pro Shampoo = 40
//

WebUI.click(
    findTestObject(
        'div_Produtos vendidos (opcional)'
    )
)

WebUI.click(
    findTestObject(
        'button_btn-add-produto-ag'
    )
)

WebUI.click(
    findTestObject(
        'span_Selecione um produto'
    )
)

WebUI.click(
    findTestObject(
        'div_Pro Shampoosaldo_ 201'
    )
)

// ========================================
// DATA AGENDAMENTO
// ========================================

def campoData =
    WebUiCommonHelper.findWebElement(
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
// SALVAR AGENDAMENTO
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
    findTestObject(
        'input_dash-inicio'
    ),
    10
)

// ========================================
// DATA INÍCIO
// ========================================

def dashInicio =
    WebUiCommonHelper.findWebElement(
        findTestObject(
            'input_dash-inicio'
        ),
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

def dashFim =
    WebUiCommonHelper.findWebElement(
        findTestObject(
            'input_dash-fim'
        ),
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
// VALIDAR KPIs PRINCIPAIS
// ========================================

String totalAg = WebUI.getText(
    findTestObject(
        'div_dash-total-ag'
    )
)

println(
    'TOTAL AGENDAMENTOS = ' +
    totalAg
)

assert totalAg.contains('0')

String ticket =
    WebUI.getText(
        findTestObject(
            'div_dash-ticket'
        )
    )

println(
    'TICKET MÉDIO = ' +
    ticket
)

assert ticket.contains('0')

String totalServicos =
    WebUI.getText(
        findTestObject(
            'div_dash-total-servicos'
        )
    )

println(
    'TOTAL SERVIÇOS = ' +
    totalServicos
)

assert totalServicos.contains('0')

String faturamento =
    WebUI.getText(
        findTestObject(
            'div_dash-faturamento'
        )
    )

println(
    'FATURAMENTO = ' +
    faturamento
)

assert faturamento.contains('0')

// ========================================
// RECEBIDO E PENDENTE
// ========================================

String recebido =
    WebUI.getText(
        findTestObject(
            'span_dash-pag-recebido'
        )
    )

println(
    'RECEBIDO = ' +
    recebido
)

assert recebido.contains('0')

String pendente =
    WebUI.getText(
        findTestObject(
            'span_dash-pag-pendente'
        )
    )

println(
    'PENDENTE = ' +
    pendente
)

assert pendente.contains('120')

// ========================================
// PRODUTOS
// ========================================
//
// Produto ainda não vendido.
//
// Deve aparecer:
//
// R$ 0,00
//

String valorProdutos =
    WebUI.getText(
        findTestObject(
            'div_R0,00'
        )
    )

println(
    'PRODUTOS = ' +
    valorProdutos
)

assert valorProdutos.contains('0')

// ========================================
// TOP PRODUTOS
// ========================================

String topProdutos =
    WebUI.getText(
        findTestObject(
            'div_Nenhuma venda de produto no perodo'
        )
    )

println(
    'TOP PRODUTOS = ' +
    topProdutos
)

assert topProdutos.contains(
    'Nenhuma venda'
)

// ========================================
// SUCESSO
// ========================================

println(
    'Dashboard validado com sucesso.'
)

println(
    'CT016 concluído com sucesso.'
)