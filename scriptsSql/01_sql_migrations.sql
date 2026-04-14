-- ============================================
-- MIGRATION: Expandir tabela tenants + Storage
-- ============================================

-- 1. Adicionar colunas à tabela tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS razao_social TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nome_fantasia TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Criar bucket de storage para logos dos tenants
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Políticas RLS para o bucket tenant-logos
-- Permitir leitura pública
CREATE POLICY "Tenant logos são públicos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'tenant-logos');

-- Permitir upload para usuários autenticados
CREATE POLICY "Usuários autenticados podem fazer upload de logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tenant-logos');

-- Permitir update para usuários autenticados
CREATE POLICY "Usuários autenticados podem atualizar logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'tenant-logos');

-- Permitir delete para usuários autenticados
CREATE POLICY "Usuários autenticados podem deletar logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'tenant-logos');
