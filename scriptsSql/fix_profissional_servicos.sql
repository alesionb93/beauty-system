-- Caso a coluna profissional_nome exista na tabela (legado), remova-a após migrar:
-- Este script assume que a tabela já tem profissional_id (uuid) conforme o schema informado.
-- Nenhuma alteração de schema necessária — o problema é apenas no código JS.

-- Porém, se por acaso você tinha uma coluna profissional_nome na tabela, rode:
-- ALTER TABLE public.profissional_servicos DROP COLUMN IF EXISTS profissional_nome;

-- Verifique se há constraint unique para evitar duplicatas:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profissional_servicos_prof_svc_unique'
  ) THEN
    ALTER TABLE public.profissional_servicos
      ADD CONSTRAINT profissional_servicos_prof_svc_unique UNIQUE (profissional_id, servico_id, tenant_id);
  END IF;
END $$;
