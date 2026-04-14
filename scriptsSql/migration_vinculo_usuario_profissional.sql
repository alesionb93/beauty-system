-- ============================================================
-- MIGRATION: Vínculo Usuário ↔ Profissional
-- Correção de duplicidade na agenda
-- ============================================================

-- 1. A coluna profissional_id já existe em usuarios (conforme schema).
--    Caso NÃO exista no seu banco, descomente abaixo:
-- ALTER TABLE public.usuarios
--   ADD COLUMN profissional_id UUID NULL;

-- 2. FK (caso ainda não exista)
-- A FK usuarios_profissional_id_fkey já existe no schema.
-- Caso NÃO exista, descomente abaixo:
-- ALTER TABLE public.usuarios
--   ADD CONSTRAINT fk_usuario_profissional
--   FOREIGN KEY (profissional_id)
--   REFERENCES public.profissionais(id)
--   ON DELETE SET NULL;

-- 3. Garantir unicidade: 1 usuário → no máximo 1 profissional
-- Impede que dois usuários apontem para o mesmo profissional
CREATE UNIQUE INDEX IF NOT EXISTS unique_usuario_profissional
  ON public.usuarios(profissional_id)
  WHERE profissional_id IS NOT NULL;

-- 4. (Opcional) Limpar vínculos duplicados existentes
-- Execute manualmente se necessário:
-- UPDATE public.usuarios SET profissional_id = NULL;
