# Handoff — Intervalo dos agendamentos (15 / 30 min)

## Objetivo
Tornar configurável, por tenant, o intervalo de geração da grade de horários
(agendamento interno **e** externo). Padrão: **15 min**. Opções: **15** ou **30**.

## Fonte única
Coluna nova: `public.tenant_settings.appointment_interval_minutes` (integer, default 15, check IN (15,30)).

No frontend interno (`script.js`), a variável global `APPOINTMENT_INTERVAL` é a fonte única.
Acessores: `getAppointmentInterval()` / `setAppointmentInterval(v)`.

No frontend externo (`agendamento-cliente.js`), o `state.tenant.slot_minutos` passou a ser
lido a partir de `appointment_interval_minutes` (com fallback para `slot_minutos` legado e depois 15).
O loop existente `for (var m = 0; m < 60; m += step)` (linha ~1310) já usa `step = state.tenant.slot_minutos`, portanto reflete automaticamente a configuração.

## Arquivos alterados
| Arquivo | O que mudou |
|---|---|
| `agenda.html` | (1) Card "Intervalo dos agendamentos" no topo do modal Horário Comercial. (2) Selects de minutos (`#ag-minuto`, `#bloq-hora-ini-m`, `#bloq-hora-fim-m`) agora vazios — populados dinamicamente. (3) CSS `.hc-interval-*` no `<head>`. |
| `script.js` | (1) `APPOINTMENT_INTERVAL` + `getAppointmentInterval` / `setAppointmentInterval`. (2) `populateMinuteSelect` / `populateAllMinuteSelects` / `renderIntervalPreview` / `onAppointmentIntervalChange`. (3) `populateAgHoraSelect` agora também popula os selects de minutos. (4) `carregarConfigGeral` lê `appointment_interval_minutes` e sincroniza UI + preview. (5) `salvarHorarioComercial` persiste `appointment_interval_minutes` no `upsert`. |
| `agendamento-cliente.js` | Lê `appointment_interval_minutes` da `tenant_settings` (com fallback para `slot_minutos` e 15). |

## SQL
Rodar `migration_appointment_interval.sql` no Supabase (SQL Editor).

## Sem alteração
- `agendamento-cliente.html` — a UI é 100% gerada por JS.
- `agendamento-whatsapp.html/js` — reaproveitam `agendamento-cliente.js`.
- `agendamento-compartilhado.*` — não gera slots de horário.
- Bloqueios, conflitos, disponibilidade, profissionais e serviços — inalterados.

## Comportamento
- Default 15 min mantém compatibilidade — nenhum cliente existente vê diferença.
- Ao trocar para 30 min e salvar:
  - Modal de novo agendamento passa a mostrar minutos `00` e `30`.
  - Modal de bloqueio idem.
  - Página pública (`/agendar/{tenantId}`) passa a gerar slots `09:00, 09:30, 10:00...`.
- O intervalo **não** altera abertura, fechamento, dias, bloqueios ou disponibilidade — só a granularidade.

## Testes manuais
1. Rodar SQL. Verificar coluna criada com default 15.
2. Abrir Configurações → Horário Comercial. Card aparece no topo com "15 minutos (padrão)".
3. Selecionar 30 → preview mostra `09:00 09:30 10:00 10:30 11:00 11:30 ...`.
4. Salvar. Reabrir o modal → valor persistido em `30 minutos`.
5. Abrir "Novo agendamento" → select de minutos mostra apenas `00` e `30`.
6. Abrir modal de bloqueio → mesma coisa nos dois selects.
7. Acessar página pública `/agendar/{tenantId}` → grade de horários em passos de 30 min.
8. Voltar para 15 → tudo retorna a `00/15/30/45`.

## Rollback
```sql
ALTER TABLE public.tenant_settings
  DROP CONSTRAINT IF EXISTS tenant_settings_appointment_interval_minutes_chk,
  DROP COLUMN IF EXISTS appointment_interval_minutes;
```
Os arquivos JS/HTML continuam funcionando (fallback = 15) mesmo sem a coluna, então o rollback SQL é seguro sem exigir rollback de código.
