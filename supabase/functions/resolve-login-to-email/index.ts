// Edge Function: resolve-login-to-email
// Deploy:
//   supabase functions deploy resolve-login-to-email --no-verify-jwt
//
// Objetivo:
//   Receber { login } e retornar { email } usando Service Role
//   (bypass RLS), eliminando a necessidade de SELECT anônimo na
//   tabela `usuarios`.
//
// Segurança:
//   - Apenas POST
//   - Body validado (tamanho + regex)
//   - Resposta genérica quando o login não existe (anti-enumeração)
//   - Retorna SOMENTE o email; nunca id, nome, tenant_id, etc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LOGIN_REGEX = /^[a-zA-Z0-9._]+$/
const LOGIN_MIN = 3
const LOGIN_MAX = 30

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function genericInvalid(status = 404) {
  return jsonResponse(
    { success: false, message: 'Credenciais inválidas.' },
    status,
  )
}

function normalizeLogin(value: unknown): string {
  return (typeof value === 'string' ? value : '').trim().toLowerCase()
}

function isValidLogin(value: string): boolean {
  return (
    value.length >= LOGIN_MIN &&
    value.length <= LOGIN_MAX &&
    LOGIN_REGEX.test(value)
  )
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Método não permitido.' }, 405)
  }

  let payload: any
  try {
    // Limita o tamanho do body lido
    const raw = await req.text()
    if (!raw || raw.length > 1024) {
      return genericInvalid(400)
    }
    payload = JSON.parse(raw)
  } catch (_) {
    return genericInvalid(400)
  }

  const login = normalizeLogin(payload?.login)
  if (!isValidLogin(login)) {
    return genericInvalid(404)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) {
    // Não vazar detalhes
    return genericInvalid(500)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { data, error } = await supabaseAdmin
      .from('usuarios')
      .select('email')
      .eq('login', login)
      .eq('ativo', true)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[resolve-login-to-email] db error:', error.message)
      return genericInvalid(404)
    }
    if (!data?.email) {
      return genericInvalid(404)
    }

    return jsonResponse({ success: true, email: String(data.email) }, 200)
  } catch (err) {
    console.error('[resolve-login-to-email] unexpected:', err)
    return genericInvalid(500)
  }
})
