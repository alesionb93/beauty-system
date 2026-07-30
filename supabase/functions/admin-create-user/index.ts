// ============================================================
// Edge Function: admin-create-user  (v3 — limite dinâmico + convite oficial type=invite)
// Deploy: supabase functions deploy admin-create-user
//
// ORDEM CORRETA (nada de e-mail antes de tudo estar salvo):
//  1) valida JWT/permissão do chamador
//  2) valida payload
//  3) busca tenant + tenants.max_active_users
//  4) conta usuários ativos (master_admin não conta)
//  5) valida limite  -> se estourar: 403 e NADA é criado
//  6) valida duplicidade de e-mail/login
//  7) cria Auth User NÃO CONFIRMADO (sem enviar e-mail)
//  8) insere em usuarios
//  9) cria/vincula profissional
// 10) insere user_roles
// 11) SÓ ENTÃO envia o CONVITE (inviteUserByEmail => template "Invite User", type=invite)
// Qualquer falha entre 7 e 11 => rollback total (auth + usuarios + roles + profissional)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Fallback usado APENAS se a coluna/registro não existir de fato.
const FALLBACK_MAX_ACTIVE_USERS = 3

const ALLOWED_ROLES = ['admin', 'colaborador']
const LOGIN_REGEX = /^[a-zA-Z0-9._]+$/
const LOGIN_MIN = 3
const LOGIN_MAX = 30

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
function asLogin(value: unknown) {
  return asString(value).toLowerCase()
}
function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}
function isValidLogin(value: string) {
  return value.length >= LOGIN_MIN && value.length <= LOGIN_MAX && LOGIN_REGEX.test(value)
}

function resolveRequestOrigin(req: Request) {
  const origin = (req.headers.get('origin') ?? '').trim().replace(/\/+$/, '')
  if (origin) return origin
  const referer = (req.headers.get('referer') ?? '').trim()
  if (referer) {
    try { return new URL(referer).origin.replace(/\/+$/, '') } catch (_) { /* ignore */ }
  }
  return ''
}

async function rollbackAll(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string | null,
  createdProfessionalId: string | null,
) {
  try {
    if (createdProfessionalId) {
      await supabaseAdmin.from('profissionais').delete().eq('id', createdProfessionalId)
    }
    if (userId) {
      await supabaseAdmin.from('user_roles').delete().eq('user_id', userId)
      await supabaseAdmin.from('usuarios').delete().eq('id', userId)
      await supabaseAdmin.auth.admin.deleteUser(userId)
    }
  } catch (e) {
    console.error('Falha no rollback:', e)
  }
}

/** Lê o limite do tenant. Erro/ausência => fallback. */
async function getTenantMaxActiveUsers(
  supabaseAdmin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<{ max: number; source: 'db' | 'fallback' }> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('max_active_users')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) {
    console.error('Erro ao ler tenants.max_active_users:', error)
    return { max: FALLBACK_MAX_ACTIVE_USERS, source: 'fallback' }
  }
  const raw = data ? (data as Record<string, unknown>).max_active_users : null
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (Number.isFinite(n) && n > 0) return { max: n, source: 'db' }
  return { max: FALLBACK_MAX_ACTIVE_USERS, source: 'fallback' }
}

/** Conta usuários ATIVOS do tenant, ignorando master_admin. */
async function countTenantActiveUsers(
  supabaseAdmin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<number> {
  const { data: usuarios, error } = await supabaseAdmin
    .from('usuarios')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('ativo', true)

  if (error) {
    console.error('Erro ao contar usuários ativos:', error)
    throw new Error('Não foi possível validar o limite de usuários agora.')
  }
  const rows = usuarios ?? []
  if (rows.length === 0) return 0

  const ids = rows.map((u: Record<string, unknown>) => u.id as string)
  const { data: masterRoles } = await supabaseAdmin
    .from('user_roles')
    .select('user_id')
    .in('user_id', ids)
    .eq('role', 'master_admin')

  const masters = new Set((masterRoles ?? []).map((r: Record<string, unknown>) => r.user_id as string))
  return ids.filter((id) => !masters.has(id)).length
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let newUserId: string | null = null
  let createdProfessionalId: string | null = null

  try {
    // ---------- 1) AUTENTICAÇÃO ----------
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
    const appPublicUrl = (Deno.env.get('APP_PUBLIC_URL') || requestOrigin).replace(/\/+$/, '')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ message: 'Configuração do servidor incompleta.' }, 500)
    }
    if (!appPublicUrl) {
      return jsonResponse({ message: 'Configuração do servidor incompleta (APP_PUBLIC_URL).' }, 500)
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
      return jsonResponse({ message: 'Sessão inválida ou expirada.' }, 401)
    }

    // ---------- 2) PAYLOAD ----------
    const body = await req.json()
    const nome = asString(body?.nome)
    const email = asEmail(body?.email)
    const login = asLogin(body?.login)
    let role = asString(body?.role) || 'colaborador'
    const tenantId = asString(body?.tenant_id)
    const profissional = body?.profissional && typeof body.profissional === 'object'
      ? body.profissional
      : { tipo: 'nenhum' }

    if (!ALLOWED_ROLES.includes(role)) role = 'colaborador'
    if (!nome || !email || !tenantId) {
      return jsonResponse({ message: 'Campos obrigatórios: nome, email, tenant_id.' }, 400)
    }
    if (!isEmail(email)) return jsonResponse({ message: 'E-mail inválido.' }, 400)
    if (!login) return jsonResponse({ message: 'Login é obrigatório.' }, 400)
    if (!isValidLogin(login)) {
      return jsonResponse({
        message: `Login inválido. Use ${LOGIN_MIN}–${LOGIN_MAX} caracteres: letras, números, ponto ou underscore.`,
      }, 400)
    }

    // ---------- 3) PERMISSÃO ----------
    const { data: callerRoles, error: callerRolesError } = await supabaseAdmin
      .from('user_roles')
      .select('role, tenant_id')
      .eq('user_id', callerUser.id)

    if (callerRolesError) {
      return jsonResponse({ message: 'Erro ao validar permissões do usuário logado.' }, 500)
    }
    const roleRows = (callerRoles ?? []) as RoleRow[]
    const isMasterAdmin = roleRows.some((r) => r.role === 'master_admin')
    const isTenantAdmin = roleRows.some((r) => r.role === 'admin' && r.tenant_id === tenantId)
    if (!isMasterAdmin && !isTenantAdmin) {
      return jsonResponse({ message: 'Sem permissão para criar usuários neste tenant.' }, 403)
    }

    // ---------- 4/5) TENANT + LIMITE ----------
    const { data: tenantRow, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id, nome, nome_fantasia, max_active_users')
      .eq('id', tenantId)
      .maybeSingle()

    if (tenantError) return jsonResponse({ message: 'Erro ao carregar o tenant.' }, 500)
    if (!tenantRow) return jsonResponse({ message: 'Tenant não encontrado.' }, 404)

    const tenantNome = (tenantRow.nome_fantasia as string) || (tenantRow.nome as string) || 'Slotify'
    const { max: maxUsers, source: limitSource } = await getTenantMaxActiveUsers(supabaseAdmin, tenantId)
    const currentCount = await countTenantActiveUsers(supabaseAdmin, tenantId)

    console.log('[limite]', { tenantId, maxUsers, limitSource, currentCount })

    if (currentCount >= maxUsers) {
      // NADA foi criado até aqui: sem Auth user, sem usuarios, sem e-mail.
      return jsonResponse({
        message: `Limite de usuários ativos atingido (${maxUsers}). Este tenant já possui ${currentCount} usuário(s) ativo(s). Inative um usuário antes de criar outro.`,
        limite: maxUsers,
        ativos: currentCount,
        limite_origem: limitSource,
      }, 403)
    }

    // ---------- 6) DUPLICIDADES ----------
    const { data: existingUsuario, error: existingUsuarioError } = await supabaseAdmin
      .from('usuarios').select('id').eq('email', email).maybeSingle()
    if (existingUsuarioError) return jsonResponse({ message: 'Erro ao verificar se o e-mail já existe.' }, 500)
    if (existingUsuario) return jsonResponse({ message: 'Já existe um usuário com esse e-mail.' }, 409)

    const { data: existingLogin, error: existingLoginError } = await supabaseAdmin
      .from('usuarios').select('id').ilike('login', login).maybeSingle()
    if (existingLoginError) return jsonResponse({ message: 'Erro ao verificar se o login já existe.' }, 500)
    if (existingLogin) return jsonResponse({ message: 'Este login já está em uso.' }, 409)

    // ---------- 7) CRIA AUTH USER (SEM E-MAIL, NÃO CONFIRMADO) ----------
    // IMPORTANTE: email_confirm precisa ser FALSE.
    // Se o usuário já estiver confirmado, o GoTrue recusa o convite
    // ("email address already registered") e o fluxo cairia em recovery.
    // Deixando não confirmado, o passo 11 consegue enviar o template Invite User
    // mantendo o MESMO user.id já usado em usuarios/user_roles/profissionais.
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { nome, tenant_id: tenantId, tenant_nome: tenantNome, login },
    })


    if (createError || !created?.user) {
      const msg = (createError?.message || '').toLowerCase()
      if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
        return jsonResponse({ message: 'Já existe uma conta com esse e-mail no Auth.' }, 409)
      }
      console.error('Erro no auth.admin.createUser:', createError)
      return jsonResponse({ message: 'Erro ao criar acesso: ' + (createError?.message ?? 'desconhecido') }, 500)
    }
    newUserId = created.user.id

    // Limpa qualquer role criada por trigger em auth.users
    await supabaseAdmin.from('user_roles').delete().eq('user_id', newUserId)

    // ---------- 8) TABELA usuarios ----------
    const { error: usuarioInsertError } = await supabaseAdmin.from('usuarios').insert([
      { id: newUserId, nome, email, login, tenant_id: tenantId, ativo: true },
    ])
    if (usuarioInsertError) {
      console.error('Erro ao inserir em usuarios:', usuarioInsertError)
      await rollbackAll(supabaseAdmin, newUserId, null)
      return jsonResponse({ message: 'Erro ao salvar em usuarios: ' + usuarioInsertError.message }, 500)
    }

    // ---------- 9) PROFISSIONAL ----------
    let profissionalIdFinal: string | null = null
    let profissionalTipo = asString(profissional.tipo) || 'nenhum'
    if (role === 'colaborador') profissionalTipo = 'criar'

    if (profissionalTipo === 'existente') {
      const profissionalId = asString(profissional.id)
      if (!profissionalId) {
        await rollbackAll(supabaseAdmin, newUserId, null)
        return jsonResponse({ message: 'Selecione um profissional existente.' }, 400)
      }
      const { data: profExistente, error: profExistenteError } = await supabaseAdmin
        .from('profissionais').select('id, tenant_id').eq('id', profissionalId).maybeSingle()

      if (profExistenteError || !profExistente || profExistente.tenant_id !== tenantId) {
        await rollbackAll(supabaseAdmin, newUserId, null)
        return jsonResponse({ message: 'Profissional inválido para este tenant.' }, 400)
      }
      profissionalIdFinal = profExistente.id as string
    }

    if (profissionalTipo === 'criar') {
      const fotoUrl = asString(profissional.foto_url) || null
      const { data: profCriado, error: profInsertError } = await supabaseAdmin
        .from('profissionais')
        .insert([{ nome, foto_url: fotoUrl, tenant_id: tenantId }])
        .select('id').single()

      if (profInsertError || !profCriado) {
        await rollbackAll(supabaseAdmin, newUserId, null)
        return jsonResponse({ message: 'Erro ao criar profissional: ' + (profInsertError?.message || 'sem retorno') }, 500)
      }
      createdProfessionalId = profCriado.id as string
      profissionalIdFinal = createdProfessionalId
    }

    if (profissionalIdFinal) {
      const { error: linkError } = await supabaseAdmin
        .from('usuarios').update({ profissional_id: profissionalIdFinal }).eq('id', newUserId)
      if (linkError) {
        await rollbackAll(supabaseAdmin, newUserId, createdProfessionalId)
        return jsonResponse({ message: 'Erro ao vincular profissional ao usuário: ' + linkError.message }, 500)
      }
    }

    // ---------- 10) ROLE ----------
    await supabaseAdmin.from('user_roles').delete().eq('user_id', newUserId)
    const { error: roleInsertError } = await supabaseAdmin.from('user_roles').insert([
      { user_id: newUserId, role, tenant_id: tenantId },
    ])
    if (roleInsertError) {
      await rollbackAll(supabaseAdmin, newUserId, createdProfessionalId)
      return jsonResponse({ message: 'Erro ao salvar role: ' + roleInsertError.message }, 500)
    }

    const { data: roleVerify } = await supabaseAdmin
      .from('user_roles').select('id, role').eq('user_id', newUserId).eq('tenant_id', tenantId).maybeSingle()
    if (roleVerify && roleVerify.role !== role) {
      await supabaseAdmin.from('user_roles').update({ role }).eq('id', roleVerify.id)
    }

    // ---------- 11) CONVITE (template "Invite User") — ÚLTIMA ETAPA ----------
    // Fluxo oficial: auth.admin.inviteUserByEmail() => template Invite User,
    // link com ?token_hash=...&type=invite. NÃO usar resetPasswordForEmail()
    // nem generateLink({ type: 'recovery' }) aqui: isso dispara o template
    // Reset Password (foi exatamente a causa do e-mail errado).
    const redirectTo = `${appPublicUrl}/definir-senha.html`
    console.log('Enviando CONVITE (type=invite). redirectTo =', redirectTo)

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { nome, tenant_id: tenantId, tenant_nome: tenantNome, login },
    })

    if (inviteError) {
      console.error('Erro ao enviar convite (invite):', inviteError)
      await rollbackAll(supabaseAdmin, newUserId, createdProfessionalId)
      return jsonResponse({
        message: 'Erro ao enviar o convite: ' + inviteError.message,
        details: { redirectTo, request_origin: requestOrigin || null, fluxo: 'invite' },
      }, 500)
    }

    return jsonResponse({
      success: true,
      message: 'Convite enviado. O usuário vai receber o e-mail para definir a senha.',
      user_id: newUserId,
      email,
      profissional_id: profissionalIdFinal,
      role_aplicada: role,
      email_fluxo: 'invite',
      limite: maxUsers,
      ativos: currentCount + 1,

    })
  } catch (error) {
    console.error('Erro interno admin-create-user:', error)
    return jsonResponse({
      message: 'Erro interno do servidor: ' + (error instanceof Error ? error.message : 'desconhecido'),
    }, 500)
  }
})
