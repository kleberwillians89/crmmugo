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
  if (!configuredAppId || reference !== `env://meta-app-${configuredAppId}`) return ''
  const key = metaAppEnvName(configuredAppId, 'ACCESS_TOKEN')
  return key ? safeEnv(getEnv, key) : ''
}
