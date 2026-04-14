-- Nova tabela para armazenar múltiplas cores (base, pigmento, cor) por serviço do agendamento
CREATE TABLE public.agendamento_servico_cores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agendamento_servico_id uuid NOT NULL,
  cor_id uuid NOT NULL,
  tipo text NOT NULL, -- 'base', 'pigmento', 'cor'
  quantidade integer DEFAULT 0,
  tenant_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT agendamento_servico_cores_pkey PRIMARY KEY (id),
  CONSTRAINT agendamento_servico_cores_as_fkey FOREIGN KEY (agendamento_servico_id) REFERENCES public.agendamento_servicos(id) ON DELETE CASCADE,
  CONSTRAINT agendamento_servico_cores_cor_fkey FOREIGN KEY (cor_id) REFERENCES public.cores(id),
  CONSTRAINT agendamento_servico_cores_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

-- Habilitar RLS
ALTER TABLE public.agendamento_servico_cores ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (mesmas regras das outras tabelas)
CREATE POLICY "Permitir select para usuários autenticados"
  ON public.agendamento_servico_cores FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Permitir insert para usuários autenticados"
  ON public.agendamento_servico_cores FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Permitir update para usuários autenticados"
  ON public.agendamento_servico_cores FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Permitir delete para usuários autenticados"
  ON public.agendamento_servico_cores FOR DELETE
  TO authenticated
  USING (true);
