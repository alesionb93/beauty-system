# Correção — Link de Agendamento não aparece no Tema da Agenda

## O que estava acontecendo

A seção nova foi adicionada no arquivo `tema-agenda.html`, mas a tela que você usa em **Configurações > Tema da Agenda** está dentro do monólito `agenda.html`, no painel:

```html
<div class="config-panel master-only-panel" id="config-tema-agenda">
```

Por isso, mesmo com `tema-agenda-script.js` correto e SQL rodado, a interface real continuava mostrando apenas os 3 blocos antigos.

## Arquivos corrigidos neste pacote

Substitua estes arquivos no seu projeto:

- `agenda.html` — agora contém o **Bloco 4: Link de Agendamento** dentro de Configurações > Tema da Agenda.
- `tema-agenda-script.js` — mantém a lógica de `booking_theme`, preview e salvamento.
- `agendamento-cliente.js` — aplica `booking_theme` no fluxo público `/agendar/{tenantId}`.
- `agendamento-cliente.css`, `agendamento-cliente.html`, `estilos.css`, `script.js`, `tema-agenda.html` — incluídos para manter o pacote alinhado aos seus arquivos enviados.

## Passos

1. Substitua os arquivos acima.
2. Garanta que o SQL da coluna `booking_theme` já foi executado.
3. Force reload no navegador: `Ctrl + F5`.
4. Se usa service worker/PWA, suba a versão de cache ou limpe o cache do site.

## Como validar rápido

Abra `agenda.html` e procure por:

```html
id="bk-section"
```

Se existir, o monólito já tem a nova seção.
