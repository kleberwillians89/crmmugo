// Isolamento de credenciais por Meta App e por conexao WhatsApp.
// A configuracao legada e preservada somente quando NAO ha meta_app_id na URL.
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const safeEnv = (getEnv, key) => (getEnv(key) || '').trim()

export const metaAppEnvName = (appId, suffix) => {
  const id = digits(appId)
  if (!id || id !== String(appId) || !/^[A-Z_]+$/.test(suffix)) return null
  return `META_APP_${id}_${suffix}`
}

export const resolveWebhookApp = (url, getEnv) => {
  const appId = url.searchParams.get('meta_app_id')
  if (!appId) {
    return {
      appId: null,
      appSecret: safeEnv(getEnv, 'META_APP_SECRET'),
      verifyToken: safeEnv(getEnv, 'META_WEBHOOK_VERIFY_TOKEN'),
      legacy: true,
    }
  }
  const secretKey = metaAppEnvName(appId, 'APP_SECRET')
  const verifyKey = metaAppEnvName(appId, 'WEBHOOK_VERIFY_TOKEN')
  if (!secretKey || !verifyKey) return null
  const appSecret = safeEnv(getEnv, secretKey)
  const verifyToken = safeEnv(getEnv, verifyKey)
  if (!appSecret || !verifyToken) return null
  return { appId, appSecret, verifyToken, legacy: false }
}

export const connectionMatchesWebhookApp = (connection, app) => {
  if (!connection || !app) return false
  const configuredAppId = String(connection.metadata?.meta_app_id || '')
  if (app.legacy) return !configuredAppId
  return configuredAppId === app.appId
}

export const resolveConnectionAccessToken = (connection, getEnv) => {
  const reference = String(connection?.credential_reference || '')
  const configuredAppId = String(connection?.metadata?.meta_app_id || '')
  if (reference === 'env://legacy-default' && !configuredAppId) {
    return safeEnv(getEnv, 'META_ACCESS_TOKEN')
  }
  // Para o mesmo aplicativo atender varias empresas, cada conexao tem token independente.
  const connectionId = String(connection?.id || '')
  if (reference === `env://connection/${connectionId}` && /^[0-9a-f-]{36}$/i.test(connectionId)) {
    return safeEnv(getEnv, `WHATSAPP_CONNECTION_${connectionId.replace(/-/g, '_').toUpperCase()}_ACCESS_TOKEN`)
  }
  if (!configuredAppId || reference !== `env://meta-app-${configuredAppId}`) return ''
  const key = metaAppEnvName(configuredAppId, 'ACCESS_TOKEN')
  return key ? safeEnv(getEnv, key) : ''
}

export const resolveMetaTransportForConnection = async (admin, organizationId, connectionId, getEnv) => {
  if (!organizationId || !connectionId) return null
  const result = await admin.from('whatsapp_connections')
    .select('id,organization_id,phone_number_id,waba_id,graph_api_version,credential_reference,metadata')
    .eq('organization_id', organizationId).eq('id', connectionId)
    .in('status', ['active','degraded']).maybeSingle()
  if (result.error) throw result.error
  const connection = result.data
  if (!connection) return null
  const accessToken = resolveConnectionAccessToken(connection, getEnv)
  const phoneNumberId = String(connection.phone_number_id || '')
  const wabaId = String(connection.waba_id || '')
  const version = String(connection.graph_api_version || getEnv('GRAPH_API_VERSION') || '')
  if (!/^\d+$/.test(phoneNumberId) || !/^\d+$/.test(wabaId) || !/^v\d+\.\d+$/.test(version) || !accessToken) return null
  return { phoneNumberId, wabaId, version, accessToken, connectionId: connection.id }
}
