# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.js >> 🔐 Autenticação & Segurança >> TC-AUTH-04 — Logout
- Location: tests\auth.spec.js:43:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('body')
Timeout: 5000ms
Expected pattern: /sair|logout|perfil/i
Received string:  "···············
      BEAUTY SYSTEM
      Sistema de Agendamento·················································
      Entrar
      Preencha email e senha.····································
"

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('body')
    9 × locator resolved to <body>…</body>
      - unexpected value "
  
    
      
      BEAUTY SYSTEM
      Sistema de Agendamento

      
        
      

      
        
      

      Entrar
      Preencha email e senha.
    
  

  
  
  
  

  
  

  




"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - img "Beauty System" [ref=e4]
  - heading "BEAUTY SYSTEM" [level=1] [ref=e5]
  - paragraph [ref=e6]: Sistema de Agendamento
  - textbox "Email" [ref=e8]
  - textbox "Senha" [ref=e10]: Aranjiex22@@
  - button "Entrar" [active] [ref=e11] [cursor=pointer]
  - paragraph [ref=e12]: Preencha email e senha.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | async function login(page, email, senha) {
  4  |   await page.goto('http://127.0.0.1:5500/index.html');
  5  | 
  6  |   await page.getByRole('textbox', { name: 'Email' }).fill(email);
  7  |   await page.getByRole('textbox', { name: 'Senha' }).fill(senha);
  8  | 
  9  |   await page.getByRole('button', { name: 'Entrar' }).click();
  10 | 
  11 |   // 🔥 espera mínima estabilidade do app
  12 |   await page.waitForTimeout(1000);
  13 | }
  14 | 
  15 | test.describe('🔐 Autenticação & Segurança', () => {
  16 | 
  17 |   test('TC-AUTH-01 — Login válido', async ({ page }) => {
  18 |     await login(page, 'alesionb93@gmail.com', 'Aranjiex22@@');
  19 | 
  20 |     await page.waitForLoadState('domcontentloaded');
  21 | 
  22 |     // validação mais realista
  23 |     await expect(page.locator('body')).toContainText(/dashboard|home|perfil|sair/i);
  24 |   });
  25 | 
  26 |   test('TC-AUTH-02 — Senha inválida', async ({ page }) => {
  27 |     await login(page, 'alesionb93@gmail.com', 'errado@@@');
  28 | 
  29 |     // 🔥 espera qualquer feedback visual de erro
  30 |     const errorToast = page.locator('text=/incorret|senha|erro/i');
  31 | 
  32 |     await expect(errorToast.first()).toBeVisible({ timeout: 10000 });
  33 |   });
  34 | 
  35 |   test('TC-AUTH-03 — Usuário inativo bloqueado', async ({ page }) => {
  36 |     await login(page, 'colabuser@gmail.com', 'Aranjiex22@@');
  37 | 
  38 |     const error = page.locator('text=/inativo|bloquead|contate/i');
  39 | 
  40 |     await expect(error.first()).toBeVisible({ timeout: 10000 });
  41 |   });
  42 | 
  43 |   test('TC-AUTH-04 — Logout', async ({ page }) => {
  44 |     await login(page, 'ander@gmail.com', 'Aranjiex22@@');
  45 | 
  46 |     // 🔥 espera que algo de "logado" exista antes de procurar logout
> 47 |     await expect(page.locator('body')).toContainText(/sair|logout|perfil/i);
     |                                        ^ Error: expect(locator).toContainText(expected) failed
  48 | 
  49 |     // 🔥 tenta múltiplas formas de achar logout
  50 |     const logoutBtn = page.locator(
  51 |       '#btn-sair, button:has-text("Sair"), text=Logout, text=Sair'
  52 |     );
  53 | 
  54 |     await expect(logoutBtn.first()).toBeVisible({ timeout: 15000 });
  55 | 
  56 |     await logoutBtn.first().click();
  57 | 
  58 |     await expect(page.getByRole('button', { name: 'Entrar' }))
  59 |       .toBeVisible({ timeout: 10000 });
  60 |   });
  61 | 
  62 | });
```