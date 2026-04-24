# 🛠️ Guia técnico — Instalação do PWA no projeto Beauty System

Este documento explica para o **desenvolvedor** como instalar os arquivos
deste pacote no projeto existente.

## 📦 Conteúdo do pacote

```
pwa_beauty_system/
├── manifest.json              ← Manifesto do PWA
├── service-worker.js          ← Service Worker (cache + offline)
├── pwa.js                     ← Registro do SW + botão instalar + banner iOS
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png   (180x180)
├── snippets/
│   ├── head-snippet.html      ← Cole no <head> de cada página
│   └── pwa-styles.css         ← Cole no final do estilos.css
├── TUTORIAL-INSTALACAO.md     ← Para enviar ao cliente final
└── TUTORIAL-INSTALACAO.pdf    ← Versão PDF
```

## 🚀 Passo a passo

### 1. Copie os arquivos para a raiz do seu projeto
Coloque na **mesma pasta** onde estão `index.html`, `agenda.html`, `pacotes.html`, `script.js` e `estilos.css`:

- `manifest.json`
- `service-worker.js`
- `pwa.js`
- pasta `icons/` inteira

> O Service Worker **precisa** ficar na raiz (ou no diretório mais "alto" possível) porque ele só controla URLs do seu próprio caminho para baixo.

### 2. Adicione o snippet ao `<head>` de cada HTML
Abra `index.html`, `agenda.html` e `pacotes.html` e cole o conteúdo de
`snippets/head-snippet.html` dentro da tag `<head>`.

### 3. Adicione o script antes do `</body>`
Em cada HTML, antes de fechar o `</body>`:

```html
<script src="pwa.js" defer></script>
```

### 4. Adicione os estilos
Abra `estilos.css` e **cole no final** o conteúdo de `snippets/pwa-styles.css`.

### 5. Teste em HTTPS
PWA **só funciona em HTTPS** (ou `http://localhost`). Se você publica em
HTTP comum, o Service Worker não será registrado.

### 6. Verifique no Chrome DevTools
1. Abra o site no Chrome.
2. F12 → aba **Application** → **Manifest**: confira que aparece o nome, ícones e cores.
3. Em **Service Workers**: confira que mostra "activated and running".
4. Em **Lighthouse** → "Progressive Web App" → veja a pontuação.

## 🎨 Personalizando

| O que mudar | Onde |
|---|---|
| Nome do app | `manifest.json` → `name` e `short_name` |
| Cor do tema | `manifest.json` → `theme_color` **e** snippet do `<head>` (`<meta name="theme-color">`) e `pwa-styles.css` |
| Cor de fundo da splash | `manifest.json` → `background_color` |
| Página inicial do app | `manifest.json` → `start_url` |
| Trocar ícones | substitua os arquivos em `icons/` mantendo os nomes |
| Adicionar páginas ao cache offline | `service-worker.js` → array `PRECACHE_URLS` |

## 🔄 Publicando uma nova versão

Sempre que mudar HTML/CSS/JS, **incremente a versão** em
`service-worker.js`:

```js
const CACHE_VERSION = 'beauty-system-v2'; // v1 → v2
```

Isso força os clientes já instalados a baixar a nova versão.

## ⚠️ Não quebra nada existente

- Não altera nenhuma lógica de negócio.
- Não interfere em chamadas para APIs externas (Supabase etc.) — o SW
  ignora requisições de outras origens.
- O botão de instalar só aparece se o navegador suportar e o app ainda
  não estiver instalado.
- O banner iOS só aparece em iPhones/iPads usando Safari, e pode ser
  fechado pelo usuário.
