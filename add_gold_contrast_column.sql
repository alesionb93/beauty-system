-- Migração: adicionar coluna gold_contrast à tabela agenda_themes
-- Rodar no SQL Editor do Supabase

ALTER TABLE public.agenda_themes
  ADD COLUMN IF NOT EXISTS gold_contrast TEXT DEFAULT '#FFFFFF';

-- Backfill para registros existentes (caso o DEFAULT não preencha linhas antigas)
UPDATE public.agenda_themes
   SET gold_contrast = '#FFFFFF'
 WHERE gold_contrast IS NULL;

-- Forçar refresh do schema cache do PostgREST
NOTIFY pgrst, 'reload schema';
