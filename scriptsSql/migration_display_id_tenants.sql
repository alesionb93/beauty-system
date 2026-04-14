-- Migration: Adicionar display_id auto-increment na tabela tenants
-- Executar ANTES de atualizar os arquivos HTML/JS

-- 1. Adicionar coluna display_id com auto-increment
ALTER TABLE public.tenants
ADD COLUMN display_id SERIAL;

-- 2. Criar índice único
CREATE UNIQUE INDEX idx_tenants_display_id ON public.tenants(display_id);

-- 3. Verificar resultado
-- SELECT id, display_id, nome FROM public.tenants ORDER BY display_id;
