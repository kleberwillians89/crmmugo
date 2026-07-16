let authBlocked = false
let blockedToken = ''

export function isWhatsAppAuthBlocked() {
  return authBlocked
}

export function blockWhatsAppAuth(token = '') {
  authBlocked = true
  blockedToken = token
}

export function resetWhatsAppAuthBlock(token = '') {
  if (!authBlocked || (token && token !== blockedToken)) {
    authBlocked = false
    blockedToken = ''
  }
  return !authBlocked
}

export function clearWhatsAppAuthBlock() {
  authBlocked = false
  blockedToken = ''
}

export async function resolveWhatsAppSession(client) {
  if (!client) return { session: null, error: new Error('Supabase não configurado.') }
  const { data, error } = await client.auth.getSession()
  const session = data?.session || null
  if (import.meta.env?.DEV) console.debug('[WhatsApp auth]', {
    hasSession: Boolean(session),
    hasAccessToken: Boolean(session?.access_token),
    userId: session?.user?.id ?? null,
  })
  if (!session?.access_token) return { session: null, error: error || new Error('Sua sessão expirou. Entre novamente no CRM.') }
  resetWhatsAppAuthBlock(session.access_token)
  return { session, error: null }
}

export function buildWhatsAppHeaders(session, publicKey, workspaceId = '') {
  if (!session?.access_token) return null
  return {
    Authorization: `Bearer ${session.access_token}`,
    ...(publicKey ? { apikey: publicKey } : {}),
    ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
  }
}
