// Edge Function: create-tenant-with-admin
// Deploy em: supabase functions deploy create-tenant-with-admin --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ===============================
    // 🔐 AUTENTICAÇÃO
    // ===============================
    const authHeader = req.headers.get('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Authorization header inválido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')

    // Cliente ADMIN (bypass RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Cliente USER (validação de token)
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // 🔍 VALIDAR USUÁRIO
    const { data: { user: callerUser }, error: authError } =
      await supabaseUser.auth.getUser(token)

    if (authError || !callerUser) {
      console.error('Erro ao validar JWT:', authError)
      return new Response(
        JSON.stringify({ error: 'Token inválido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Usuário autenticado:', callerUser.id)

    // ===============================
    // 👑 VALIDAR ROLE (MASTER ADMIN)
    // ===============================
    const { data: roleData, error: roleCheckError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerUser.id)
      .eq('role', 'master_admin')
      .maybeSingle()

    if (roleCheckError) {
      console.error('Erro ao verificar role:', roleCheckError)
    }

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: 'Acesso negado. Apenas master_admin pode criar tenants.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ===============================
    // 📦 BODY
    // ===============================
    const body = await req.json()
    const {
      tenant_nome,
      razao_social,
      nome_fantasia,
      cpf_cnpj,
      email,
      telefone,
      logo_url,
      admin_nome,
      admin_email,
      admin_senha
    } = body

    // Validações
    if (!tenant_nome?.trim() && !nome_fantasia?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Nome do tenant ou Nome Fantasia é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!admin_nome?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Nome do admin é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!admin_email?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Email do admin é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const senha = admin_senha?.trim()
      ? admin_senha.trim()
      : 'Beauty@' + Math.random().toString(36).substring(2, 8)

    // O nome do tenant será o nome_fantasia se fornecido, senão tenant_nome
    const finalTenantNome = (nome_fantasia?.trim() || tenant_nome?.trim())

    // ===============================
    // 🏢 STEP 1: TENANT
    // ===============================
    const tenantInsertData: Record<string, any> = {
      nome: finalTenantNome,
    }

    // Adicionar campos opcionais
    if (razao_social?.trim()) tenantInsertData.razao_social = razao_social.trim()
    if (nome_fantasia?.trim()) tenantInsertData.nome_fantasia = nome_fantasia.trim()
    if (cpf_cnpj?.trim()) tenantInsertData.cpf_cnpj = cpf_cnpj.trim()
    if (email?.trim()) tenantInsertData.email = email.trim()
    if (telefone?.trim()) tenantInsertData.telefone = telefone.trim()
    if (logo_url?.trim()) tenantInsertData.logo_url = logo_url.trim()

    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert([tenantInsertData])
      .select()
      .single()

    if (tenantError) {
      console.error('Erro tenant:', tenantError)
      return new Response(
        JSON.stringify({ error: 'Erro ao criar tenant: ' + tenantError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const tenantId = tenantData.id

    // ===============================
    // 👤 STEP 2: AUTH USER
    // ===============================
    const { data: authData, error: createUserError } =
      await supabaseAdmin.auth.admin.createUser({
        email: admin_email.trim().toLowerCase(),
        password: senha,
        email_confirm: true,
      })

    if (createUserError) {
      await supabaseAdmin.from('tenants').delete().eq('id', tenantId)
      return new Response(
        JSON.stringify({ error: 'Erro ao criar usuário: ' + createUserError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const newUserId = authData.user.id

    // ===============================
    // 👤 STEP 3: TABELA USUARIOS
    // ===============================
    const { error: usuarioError } = await supabaseAdmin
      .from('usuarios')
      .insert([{
        id: newUserId,
        nome: admin_nome.trim(),
        email: admin_email.trim().toLowerCase(),
        tenant_id: tenantId,
      }])

    if (usuarioError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId)
      await supabaseAdmin.from('tenants').delete().eq('id', tenantId)
      return new Response(
        JSON.stringify({ error: 'Erro ao inserir usuario: ' + usuarioError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ===============================
    // 🏷️ STEP 4: ROLE
    // ===============================
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert([{
        user_id: newUserId,
        role: 'admin',
        tenant_id: tenantId,
      }])

    if (roleError) {
      await supabaseAdmin.from('usuarios').delete().eq('id', newUserId)
      await supabaseAdmin.auth.admin.deleteUser(newUserId)
      await supabaseAdmin.from('tenants').delete().eq('id', tenantId)
      return new Response(
        JSON.stringify({ error: 'Erro ao inserir role: ' + roleError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ===============================
    // ✅ SUCESSO
    // ===============================
    return new Response(
      JSON.stringify({
        success: true,
        tenant: {
          id: tenantId,
          nome: finalTenantNome,
          razao_social: razao_social?.trim() || null,
          nome_fantasia: nome_fantasia?.trim() || null,
          cpf_cnpj: cpf_cnpj?.trim() || null,
          email: email?.trim() || null,
          telefone: telefone?.trim() || null,
          logo_url: logo_url?.trim() || null,
        },
        admin: {
          id: newUserId,
          nome: admin_nome.trim(),
          email: admin_email.trim().toLowerCase(),
          senha_temporaria: senha,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Erro interno:', err)
    return new Response(
      JSON.stringify({ error: 'Erro interno: ' + (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
