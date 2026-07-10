-- Variável do cliente
DO $$
DECLARE v_cliente uuid := 'fdbfda4a-f790-4dd7-b6be-1cfa74aa4cd0';
BEGIN

-- 0) Quebrar auto-referências de pré-pago (evita FK em agendamentos)
UPDATE public.agendamentos
   SET prepaid_origin_agendamento_id = NULL,
       prepaid_origin_payment_id     = NULL
 WHERE cliente_id = v_cliente;

-- 1) Cores dos serviços do agendamento
DELETE FROM public.agendamento_servico_cores
 WHERE agendamento_servico_id IN (
   SELECT asv.id FROM public.agendamento_servicos asv
   JOIN public.agendamentos a ON a.id = asv.agendamento_id
   WHERE a.cliente_id = v_cliente
 );

-- 2) Movimentações de estoque originadas por produtos do agendamento
DELETE FROM public.estoque_movimentacoes
 WHERE id IN (
   SELECT ap.estoque_movimentacao_id
     FROM public.agendamento_produtos ap
     JOIN public.agendamentos a ON a.id = ap.agendamento_id
    WHERE a.cliente_id = v_cliente
      AND ap.estoque_movimentacao_id IS NOT NULL
 );

-- 3) Produtos vendidos no agendamento
DELETE FROM public.agendamento_produtos
 WHERE agendamento_id IN (SELECT id FROM public.agendamentos WHERE cliente_id = v_cliente);

-- 4) Serviços do agendamento (inclui caixinha/desconto representados em pagamentos)
DELETE FROM public.agendamento_servicos
 WHERE agendamento_id IN (SELECT id FROM public.agendamentos WHERE cliente_id = v_cliente);

-- 5) Pagamentos (caixinha + descontos vivem aqui)
DELETE FROM public.agendamento_pagamentos
 WHERE agendamento_id IN (SELECT id FROM public.agendamentos WHERE cliente_id = v_cliente);

-- 6) Logs vinculados
DELETE FROM public.cancelamento_log
 WHERE agendamento_id IN (SELECT id FROM public.agendamentos WHERE cliente_id = v_cliente);

DELETE FROM public.whatsapp_notifications_log
 WHERE agendamento_id IN (SELECT id FROM public.agendamentos WHERE cliente_id = v_cliente);

-- 7) Histórico do cliente
DELETE FROM public.historico_servicos
 WHERE historico_atendimento_id IN (
   SELECT id FROM public.historico_atendimentos WHERE cliente_id = v_cliente
 );
DELETE FROM public.historico_atendimentos WHERE cliente_id = v_cliente;

-- 8) Pacotes do cliente
DELETE FROM public.cliente_pacotes WHERE cliente_id = v_cliente;

-- 9) Campanhas
DELETE FROM public.inactive_customer_campaigns WHERE cliente_id = v_cliente;

-- 10) Finalmente: agendamentos
DELETE FROM public.agendamentos WHERE cliente_id = v_cliente;

END $$;

COMMIT;