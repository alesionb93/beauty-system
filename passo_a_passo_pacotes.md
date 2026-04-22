
# Pacotes de Serviços — Implementação e Fixes

## Arquivos atualizados

1. `migracao_pacotes.sql` — cria `pacotes`, `cliente_pacotes`, vínculo `agendamento_servicos.cliente_pacote_id`, índices e RLS.
2. `agenda_com_pacotes.html` — agenda com menu lateral `Pacotes`, página de gestão e modal de pacote.
3. `pacotes.html` — versão completa com a mesma tela de gestão de pacotes.
4. `script_com_pacotes.js` — CRUD de pacotes, sugestão no agendamento, venda/uso de créditos e devolução em exclusão/edição.
5. `estilos_com_pacotes.css` — estilos da listagem, sugestão, preview e ações sem box.

## Fixes aplicados

### 1. Pacote cadastrado não aparecia como sugestão de venda

Corrigido o fluxo do modal de agendamento para buscar duas fontes ao selecionar serviço:

- `cliente_pacotes`: pacotes já comprados pelo cliente e ainda válidos.
- `pacotes`: pacote ativo configurado para o serviço, para sugerir venda.

A sugestão agora aparece mesmo quando o serviço não usa cores, porque a renderização de pacotes roda depois da troca de serviço independentemente dos extras do serviço.

### 2. Preview do pacote não atualizava em tempo real

O preview agora escuta `input` e `change` de:

- serviço
- quantidade
- tipo de desconto
- valor do desconto

Ao alterar qualquer campo, calcula imediatamente:

```js
preco_unitario_final =
  tipo_desconto === 'percentual'
    ? preco_original * (1 - valor_desconto / 100)
    : (preco_original * quantidade_total - valor_desconto) / quantidade_total;

preco_total = preco_unitario_final * quantidade_total;
```

### 3. Ações sem box e toggle roxo/cinza

Na tabela de pacotes:

- editar é apenas ícone de caneta, sem caixa visual.
- toggle não tem box externo.
- ativo: roxo.
- inativo: cinza.

### 4. Menu lateral sem string “Cadastro”

O menu lateral agora exibe apenas:

```text
Pacotes
```

sem “Cadastro”/“Cadastros”.

## Passo a passo para implementar

1. Execute `migracao_pacotes.sql` no banco.
2. Substitua os arquivos atuais pelos gerados:
   - `agenda.html` pelo conteúdo de `agenda_com_pacotes.html` se quiser manter o mesmo nome.
   - `script.js` pelo conteúdo de `script_com_pacotes.js`.
   - `estilos.css` pelo conteúdo de `estilos_com_pacotes.css`.
3. Se preferir página separada, publique também `pacotes.html`.
4. Garanta que o menu da agenda aponte para a página/aba de pacotes incluída.
5. Cadastre um pacote ativo vinculado ao serviço desejado.
6. Abra um novo agendamento, selecione cliente e serviço; a sugestão de venda do pacote aparecerá abaixo do serviço.

## Fluxo operacional para o usuário

1. Acessar `Pacotes` no menu lateral.
2. Clicar em `Novo Pacote`.
3. Informar nome, serviço, quantidade, desconto e validade.
4. Conferir o preview automático de preço original, preço por uso e total.
5. Salvar o pacote como ativo.
6. Criar um novo agendamento.
7. Selecionar cliente e serviço.
8. O sistema oferece:
   - usar pacote existente, se o cliente já tiver créditos válidos;
   - vender pacote ativo do serviço, se o cliente ainda não tiver ou se desejar vender outro.
9. Ao salvar o agendamento, o sistema aplica o preço com desconto e grava o vínculo em `agendamento_servicos.cliente_pacote_id`.
10. Ao excluir/editar um agendamento que consumiu pacote, o crédito é devolvido antes de recriar/remover os serviços.
