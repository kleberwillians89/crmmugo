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
  const current = await client.auth.getSession()
  let session = current.data?.session || null
  let error = current.error || null
  const expiresAt = Number(session?.expires_at || 0)
  const shouldRefresh = Boolean(session?.refresh_token && expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 60)
  if (shouldRefresh) {
    const refreshed = await client.auth.refreshSession()
    session = refreshed.data?.session || null
    error = refreshed.error || null
  }
  if (import.meta.env?.DEV) console.debug('[WhatsApp auth]', {
    hasSession: Boolean(session),
    hasAccessToken: Boolean(session?.access_token),
    refreshed: shouldRefresh,
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
