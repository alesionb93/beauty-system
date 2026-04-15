-- =====================================================
-- MIGRAÇÃO: Sistema Dinâmico de Cores e Quantidades
-- Beauty System - Refatoração Completa
-- =====================================================

-- 1. Criar tabela de configuração de quantidade por tipo de cor por serviço
CREATE TABLE IF NOT EXISTS public.servico_cor_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  servico_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('base', 'pigmento')),
  tipo_quantidade text NOT NULL DEFAULT 'intervalo' CHECK (tipo_quantidade IN ('intervalo', 'lista', 'livre')),
  qtd_min integer DEFAULT 5,
  qtd_max integer DEFAULT 120,
  qtd_step integer DEFAULT 5,
  qtd_lista jsonb DEFAULT '[]'::jsonb,
  unidade text NOT NULL DEFAULT 'g',
  tenant_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT servico_cor_config_pkey PRIMARY KEY (id),
  CONSTRAINT servico_cor_config_servico_fkey FOREIGN KEY (servico_id) REFERENCES public.servicos(id) ON DELETE CASCADE,
  CONSTRAINT servico_cor_config_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT servico_cor_config_unique UNIQUE (servico_id, tipo, tenant_id)
);

-- 2. Habilitar RLS
ALTER TABLE public.servico_cor_config ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS (mesmo padrão das outras tabelas)
CREATE POLICY "Authenticated users can read servico_cor_config"
  ON public.servico_cor_config
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert servico_cor_config"
  ON public.servico_cor_config
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update servico_cor_config"
  ON public.servico_cor_config
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete servico_cor_config"
  ON public.servico_cor_config
  FOR DELETE
  TO authenticated
  USING (true);

-- 4. Adicionar coluna quantidade na agendamento_servico_cores (se não existir)
-- A coluna já existe, mas vamos garantir que aceita decimais para futuro
-- ALTER TABLE public.agendamento_servico_cores ALTER COLUMN quantidade TYPE numeric;
-- (Opcional - execute se quiser suportar quantidades decimais)

-- 5. Índices para performance
CREATE INDEX IF NOT EXISTS idx_servico_cor_config_servico ON public.servico_cor_config(servico_id);
CREATE INDEX IF NOT EXISTS idx_servico_cor_config_tenant ON public.servico_cor_config(tenant_id);

-- =====================================================
-- FIM DA MIGRAÇÃO
-- =====================================================
