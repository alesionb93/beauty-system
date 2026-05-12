import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_USERS_PER_TENANT = 3
const ALLOWED_ROLES = ['admin', 'colaborador']

type RoleRow = { role: string; tenant_id: string | null }

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
function asEmail(value: unknown) {
  return asString(value).toLowerCase()
}
function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
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

async function rollbackUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string | null,
  createdProfessionalId: string | null,
) {
  if (createdProfessionalId) {
    await supabaseAdmin.from('profissionais').delete().eq('id', createdProfessionalId)
  }
  if (userId) {
    await supabaseAdmin.from('user_roles').delete().eq('user_id', userId)
    await supabaseAdmin.from('usuarios').delete().eq('id', userId)
    await supabaseAdmin.auth.admin.deleteUser(userId)
  }
}

async function countTenantUsers(
  supabaseAdmin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<number> {
  const { data: usuarios, error } = await supabaseAdmin
    .from('usuarios')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('ativo', true)

  if (error || !usuarios) return 0
  const userIds = usuarios.map((u) => u.id)
  if (userIds.length === 0) return 0

  const { data: masterRoles } = await supabaseAdmin
    .from('user_roles')
    .select('user_id')
    .in('user_id', userIds)
    .eq('role', 'master_admin')

  const masterIds = new Set((masterRoles || []).map((r) => r.user_id))
  return usuarios.filter((u) => !masterIds.has(u.id)).length
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ message: 'Authorization header inválido.' }, 401)
    }
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return jsonResponse({ message: 'Token ausente.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const requestOrigin = resolveRequestOrigin(req)
    // 🆕 URL pública do front (ex: https://app.beautysystem.com.br)
    // Se não existir secret, usamos o origin da própria requisição (útil no STG/local).
    const appPublicUrl = (Deno.env.get('APP_PUBLIC_URL') ?? requestOrigin).replace(/\/+$/, '')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error('Variáveis de ambiente ausentes na função admin-create-user')
      return jsonResponse({ message: 'Configuração do servidor incompleta.' }, 500)
    }

    if (!appPublicUrl) {
      console.error('APP_PUBLIC_URL não configurada e origin ausente — convite por e-mail não pode ser enviado.')
      return jsonResponse({
        message: 'Configuração do servidor incompleta (APP_PUBLIC_URL).',
        details: { request_origin: requestOrigin || null },
      }, 500)
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user: callerUser }, error: authError } = await supabaseUser.auth.getUser(token)
    if (authError || !callerUser) {
      console.error('Erro ao validar JWT do chamador:', authError)
      return jsonResponse({ message: 'Sessão inválida ou expirada.' }, 401)
    }

    const body = await req.json()
    const nome = asString(body?.nome)
    const email = asEmail(body?.email)
    let role = asString(body?.role) || 'colaborador'
    const tenantId = asString(body?.tenant_id)
    const profissional = body?.profissional && typeof body.profissional === 'object'
      ? body.profissional
      : { tipo: 'nenhum' }

    if (!ALLOWED_ROLES.includes(role)) {
      console.warn('Role inválida recebida:', role, '— usando colaborador como fallback')
      role = 'colaborador'
    }

    console.log('📝 Criando usuário — Nome:', nome, 'Email:', email, 'Role solicitada:', role, 'Tenant:', tenantId)

    if (!nome || !email || !tenantId) {
      return jsonResponse({ message: 'Campos obrigatórios: nome, email, tenant_id.' }, 400)
    }
    if (!isEmail(email)) {
      return jsonResponse({ message: 'E-mail inválido.' }, 400)
    }

    const { data: callerRoles, error: callerRolesError } = await supabaseAdmin
      .from('user_roles')
      .select('role, tenant_id')
      .eq('user_id', callerUser.id)

    if (callerRolesError) {
      console.error('Erro ao buscar roles do chamador:', callerRolesError)
      return jsonResponse({ message: 'Erro ao validar permissões do usuário logado.' }, 500)
    }

    const roleRows = (callerRoles || []) as RoleRow[]
    const isMasterAdmin = roleRows.some((r) => r.role === 'master_admin')
    const isTenantAdmin = roleRows.some((r) => r.role === 'admin' && r.tenant_id === tenantId)

    if (!isMasterAdmin && !isTenantAdmin) {
      return jsonResponse({ message: 'Sem permissão para criar usuários neste tenant.' }, 403)
    }

    const currentCount = await countTenantUsers(supabaseAdmin, tenantId)
    if (currentCount >= MAX_USERS_PER_TENANT) {
      return jsonResponse({
        message: `Limite de ${MAX_USERS_PER_TENANT} usuários por tenant atingido. Este tenant já possui ${currentCount} usuário(s) ativos (master_admin não conta).`,
      }, 403)
    }

    const { data: existingUsuario, error: existingUsuarioError } = await supabaseAdmin
      .from('usuarios').select('id').eq('email', email).maybeSingle()

    if (existingUsuarioError) {
      console.error('Erro ao verificar usuários existentes:', existingUsuarioError)
      return jsonResponse({ message: 'Erro ao verificar se o e-mail já existe.' }, 500)
    }
    if (existingUsuario) {
      return jsonResponse({ message: 'Já existe um usuário com esse e-mail.' }, 409)
    }

    // 🆕 Buscar nome do tenant (estabelecimento) para incluir no e-mail
    const { data: tenantRow } = await supabaseAdmin
      .from('tenants')
      .select('nome, nome_fantasia')
      .eq('id', tenantId)
      .maybeSingle()
    const tenantNome = (tenantRow?.nome_fantasia as string) || (tenantRow?.nome as string) || 'Beauty System'

    // ============================================================
    // 🆕 NOVO FLUXO — inviteUserByEmail (sem senha, e-mail automático)
    // ============================================================
    const redirectTo = `${appPublicUrl}/definir-senha.html`

    console.log('admin-create-user redirectTo:', redirectTo)

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        nome,
        tenant_id: tenantId,
        tenant_nome: tenantNome,
      },
    })

    if (inviteError) {
      const msg = (inviteError.message || '').toLowerCase()
      if (msg.includes('already') || msg.includes('duplicate') || msg.includes('registered')) {
        return jsonResponse({ message: 'Já existe uma conta com esse e-mail no Auth.' }, 409)
      }
      console.error('Erro no auth.admin.inviteUserByEmail:', inviteError)
      return jsonResponse({
        message: 'Erro ao enviar convite por e-mail: ' + inviteError.message,
        details: {
          redirectTo,
          request_origin: requestOrigin || null,
          code: (inviteError as any)?.code ?? null,
          status: (inviteError as any)?.status ?? null,
        },
      }, 500)
    }

    const newUserId = inviteData.user?.id ?? null
    if (!newUserId) {
      return jsonResponse({ message: 'Erro interno: user_id não retornado pelo Auth.' }, 500)
    }

    // ✅ Limpar IMEDIATAMENTE qualquer role criada por trigger em auth.users
    await supabaseAdmin.from('user_roles').delete().eq('user_id', newUserId)

    let createdProfessionalId: string | null = null
    let profissionalIdFinal: string | null = null

    const { error: usuarioInsertError } = await supabaseAdmin.from('usuarios').insert([
      { id: newUserId, nome, email, tenant_id: tenantId, ativo: true },
    ])

    if (usuarioInsertError) {
      console.error('Erro ao inserir em usuarios:', usuarioInsertError)
      await rollbackUser(supabaseAdmin, newUserId, null)
      return jsonResponse({ message: 'Erro ao salvar em usuarios: ' + usuarioInsertError.message }, 500)
    }

    let profissionalTipo = asString(profissional.tipo) || 'nenhum'
    if (role === 'colaborador') {
      if (profissionalTipo !== 'criar') {
        console.log('🔄 Colaborador detectado — forçando tipo=criar (recebido:', profissionalTipo, ')')
      }
      profissionalTipo = 'criar'
    }

    if (profissionalTipo === 'existente') {
      const profissionalId = asString(profissional.id)
      if (!profissionalId) {
        await rollbackUser(supabaseAdmin, newUserId, null)
        return jsonResponse({ message: 'Selecione um profissional existente.' }, 400)
      }
      const { data: profissionalExistente, error: profissionalExistenteError } = await supabaseAdmin
        .from('profissionais').select('id, tenant_id').eq('id', profissionalId).maybeSingle()

      if (profissionalExistenteError || !profissionalExistente || profissionalExistente.tenant_id !== tenantId) {
        console.error('Erro ao validar profissional existente:', profissionalExistenteError)
        await rollbackUser(supabaseAdmin, newUserId, null)
        return jsonResponse({ message: 'Profissional inválido para este tenant.' }, 400)
      }
      profissionalIdFinal = profissionalExistente.id
    }

    if (profissionalTipo === 'criar') {
      const fotoUrl = asString(profissional.foto_url) || null
      const { data: profissionalCriado, error: profissionalInsertError } = await supabaseAdmin
        .from('profissionais')
        .insert([{ nome, foto_url: fotoUrl, tenant_id: tenantId }])
        .select('id').single()

      if (profissionalInsertError || !profissionalCriado) {
        console.error('Erro ao criar profissional:', profissionalInsertError)
        await rollbackUser(supabaseAdmin, newUserId, null)
        return jsonResponse({ message: 'Erro ao criar profissional: ' + (profissionalInsertError?.message || 'sem retorno') }, 500)
      }
      createdProfessionalId = profissionalCriado.id
      profissionalIdFinal = profissionalCriado.id
      console.log('✅ Profissional criado automaticamente:', profissionalCriado.id)
    }

    if (profissionalIdFinal) {
      const { error: usuarioUpdateError } = await supabaseAdmin
        .from('usuarios').update({ profissional_id: profissionalIdFinal }).eq('id', newUserId)

      if (usuarioUpdateError) {
        console.error('Erro ao vincular profissional no usuário:', usuarioUpdateError)
        await rollbackUser(supabaseAdmin, newUserId, createdProfessionalId)
        return jsonResponse({ message: 'Erro ao vincular profissional ao usuário: ' + usuarioUpdateError.message }, 500)
      }
    }

    await supabaseAdmin.from('user_roles').delete().eq('user_id', newUserId)

    const { error: roleInsertError } = await supabaseAdmin.from('user_roles').insert([
      { user_id: newUserId, role, tenant_id: tenantId },
    ])

    if (roleInsertError) {
      console.error('Erro ao inserir role:', roleInsertError)
      await rollbackUser(supabaseAdmin, newUserId, createdProfessionalId)
      return jsonResponse({ message: 'Erro ao salvar role: ' + roleInsertError.message }, 500)
    }

    const { data: roleVerify } = await supabaseAdmin
      .from('user_roles')
      .select('id, role, tenant_id')
      .eq('user_id', newUserId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!roleVerify) {
      console.error('ALERTA: Role não encontrada após inserção. Reinserindo…')
      await supabaseAdmin.from('user_roles').insert([
        { user_id: newUserId, role, tenant_id: tenantId },
      ])
    } else if (roleVerify.role !== role) {
      console.error('⚠️ Role divergente após insert! Solicitada:', role, 'Encontrada:', roleVerify.role, '— Corrigindo…')
      await supabaseAdmin.from('user_roles').update({ role }).eq('id', roleVerify.id)
    }

    console.log('✅ Usuário convidado por e-mail. User:', newUserId, 'Role final:', role, 'Tenant:', tenantId)

    return jsonResponse({
      success: true,
      // 🆕 Mensagem alinhada à nova UX
      message: 'Enviamos um email para o usuário cadastrar a sua senha',
      user_id: newUserId,
      email,
      profissional_id: profissionalIdFinal,
      role_aplicada: role,
      // 🚫 senha_provisoria não é mais retornada (segurança)
    })
  } catch (error) {
    console.error('Erro interno admin-create-user:', error)
    return jsonResponse({
      message: 'Erro interno do servidor: ' + (error instanceof Error ? error.message : 'desconhecido'),
    }, 500)
  }
})
