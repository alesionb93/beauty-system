// Edge Function: create-tenant-with-admin
// Deploy em: supabase functions deploy create-tenant-with-admin --no-verify-jwt
//
// 🔄 ATUALIZAÇÃO: agora envia e-mail de convite (definir senha)
// em vez de criar usuário com senha temporária.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_USERS_PER_TENANT = 3

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function resolveRequestOrigin(req: Request) {
  const origin = (req.headers.get('origin') ?? '').trim().replace(/\/+$/, '')
  if (origin) return origin

  const referer = (req.headers.get('referer') ?? '').trim()
  if (referer) {
    try {
      return new URL(referer).origin.replace(/\/+$/, '')
    } catch (_) {}
  }

  return ''
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
      return jsonResponse({ error: 'Authorization header inválido' }, 401)
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
      return jsonResponse({ error: 'Token inválido' }, 401)
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
      return jsonResponse({ error: 'Acesso negado. Apenas master_admin pode criar tenants.' }, 403)
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
      // admin_senha foi REMOVIDO (agora vai por e-mail)
    } = body

    // Validações
    if (!tenant_nome?.trim() && !nome_fantasia?.trim()) {
      return jsonResponse({ error: 'Nome do tenant ou Nome Fantasia é obrigatório' }, 400)
    }

    if (!admin_nome?.trim()) {
      return jsonResponse({ error: 'Nome do admin é obrigatório' }, 400)
    }

    if (!admin_email?.trim()) {
      return jsonResponse({ error: 'Email do admin é obrigatório' }, 400)
    }

    // O nome do tenant será o nome_fantasia se fornecido, senão tenant_nome
    const finalTenantNome = (nome_fantasia?.trim() || tenant_nome?.trim())

    // ===============================
    // 🌐 URL DA APLICAÇÃO (para link do e-mail)
    // ===============================
    const requestOrigin = resolveRequestOrigin(req)
    const appPublicUrl = (Deno.env.get('APP_PUBLIC_URL') ?? requestOrigin).replace(/\/+$/, '')
    if (!appPublicUrl) {
      return jsonResponse({
        error: 'Configuração ausente: APP_PUBLIC_URL não está definida nos Secrets.',
        details: { request_origin: requestOrigin || null },
      }, 500)
    }
    const redirectTo = `${appPublicUrl}/definir-senha.html`

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
      return jsonResponse({ error: 'Erro ao criar tenant: ' + tenantError.message }, 500)
    }

    const tenantId = tenantData.id

    // ===============================
    // 👤 STEP 2: AUTH USER (via INVITE)
    // ===============================
    // 🔄 ALTERAÇÃO PRINCIPAL: usamos inviteUserByEmail em vez de createUser.
    //    - Não cria senha
    //    - Dispara e-mail de convite
    //    - Usuário define a senha clicando no link
    const adminEmailNorm = admin_email.trim().toLowerCase()

    console.log('Criando admin do tenant com redirectTo:', redirectTo)

    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(adminEmailNorm, {
        redirectTo,
        data: {
          nome: admin_nome.trim(),
          tenant_id: tenantId,
          tenant_nome: finalTenantNome,
        },
      })

    if (inviteError || !inviteData?.user) {
      console.error('Erro ao convidar usuário:', inviteError)
      // Rollback do tenant
      await supabaseAdmin.from('tenants').delete().eq('id', tenantId)
      return jsonResponse({
        error: 'Erro ao enviar convite: ' + (inviteError?.message ?? 'desconhecido'),
        details: {
          redirectTo,
          code: (inviteError as any)?.code ?? null,
          status: (inviteError as any)?.status ?? null,
        },
      }, 500)
    }

    const newUserId = inviteData.user.id

    // ===============================
    // 👤 STEP 3: TABELA USUARIOS
    // ===============================
    const { error: usuarioError } = await supabaseAdmin
      .from('usuarios')
      .insert([{
        id: newUserId,
        nome: admin_nome.trim(),
        email: adminEmailNorm,
        tenant_id: tenantId,
      }])

    if (usuarioError) {
      console.error('Erro ao inserir usuario:', usuarioError)
      await supabaseAdmin.auth.admin.deleteUser(newUserId)
      await supabaseAdmin.from('tenants').delete().eq('id', tenantId)
      return jsonResponse({ error: 'Erro ao inserir usuario: ' + usuarioError.message }, 500)
    }

    // ===============================
    // 🏷️ STEP 4: ROLE (OBRIGATÓRIO)
    // ===============================
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .upsert([{
        user_id: newUserId,
        role: 'admin',
        tenant_id: tenantId,
      }], { onConflict: 'user_id,role' })

    if (roleError) {
      console.error('Erro ao inserir role (upsert):', roleError)
      // Não fazer rollback por erro de duplicidade — role pode já existir via trigger
    }

    // ===============================
    // ✅ VERIFICAÇÃO PÓS-CRIAÇÃO
    // ===============================
    const { data: roleVerify } = await supabaseAdmin
      .from('user_roles')
      .select('id, role, tenant_id')
      .eq('user_id', newUserId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!roleVerify) {
      console.error('ALERTA: Role não encontrada após inserção para user_id=' + newUserId)
      // Tentar inserir novamente como fallback
      await supabaseAdmin.from('user_roles').upsert([{
        user_id: newUserId,
        role: 'admin',
        tenant_id: tenantId,
      }], { onConflict: 'user_id,role' })
    }

    console.log('Tenant criado com sucesso. Tenant:', tenantId, 'User:', newUserId, 'Convite enviado para:', adminEmailNorm)

    // ===============================
    // ✅ SUCESSO
    // ===============================
    return jsonResponse({
      success: true,
      invited: true,
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
        email: adminEmailNorm,
      },
      message: 'Convite enviado por e-mail. O administrador deverá definir a senha pelo link recebido.',
    })

  } catch (err) {
    console.error('Erro interno:', err)
    return jsonResponse({ error: 'Erro interno: ' + (err as Error).message }, 500)
  }
})
