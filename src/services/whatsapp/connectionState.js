// Deriva um estado de conexão claro e único a partir do health_check do backend.
// Puro e testável: nunca mostra "conectado" falso.

export const CONNECTION_STATES = Object.freeze({
  CONNECTED: 'connected',
  DEGRADED: 'degraded',
  DISCONNECTED: 'disconnected',
  SETUP_REQUIRED: 'setup_required',
  UNKNOWN: 'unknown',
})

export const CONNECTION_LABELS = Object.freeze({
  connected: 'Conectado',
  degraded: 'Degradado',
  disconnected: 'Desconectado',
  setup_required: 'Configuração necessária',
  unknown: 'Verificando',
})

const online = (value) => value === true || value === 'online'

// `health` pode ser um objeto do health_check ou um erro estruturado (com `code`).
export function deriveConnectionState(health, { templateSyncMaxAgeMs = 86_400_000, now = Date.now() } = {}) {
  if (!health || typeof health !== 'object') {
    return { state: CONNECTION_STATES.UNKNOWN, reasons: ['Sem resposta do diagnóstico.'] }
  }

  if (health.code) {
    const code = String(health.code)
    if (['WABA_ID_MISSING', 'WABA_ID_INVALID', 'META_ACCESS_TOKEN_MISSING', 'GRAPH_API_VERSION_INVALID', 'PHONE_NUMBER_ID_MISSING', 'SUPABASE_CONFIGURATION_MISSING'].includes(code)) {
      return { state: CONNECTION_STATES.SETUP_REQUIRED, reasons: [health.message || 'Configuração do backend incompleta.'] }
    }
    if (['UPSTREAM_UNAUTHORIZED', 'AUTH_SESSION_MISSING', 'AUTH_INVALID_TOKEN'].includes(code)) {
      return { state: CONNECTION_STATES.DISCONNECTED, reasons: [health.message || 'Sessão ou credencial inválida.'] }
    }
    return { state: CONNECTION_STATES.DISCONNECTED, reasons: [health.message || 'O diagnóstico falhou.'] }
  }

  const reasons = []
  const metaConfigured = health.meta_configured === true
  const supabaseOnline = online(health.supabase) || health.supabase === undefined
  const connectionStatus = String(health.whatsapp_connection_status || '').toLowerCase()

  if (!metaConfigured) reasons.push('Credenciais da Meta não configuradas no backend.')
  if (health.whatsapp_connections_v2_enabled && !health.whatsapp_connection_found) {
    reasons.push('Nenhuma conexão registrada no registro multicliente.')
  }

  if (!metaConfigured) {
    return { state: CONNECTION_STATES.SETUP_REQUIRED, reasons }
  }
  if (!supabaseOnline) {
    reasons.push('Banco de dados indisponível.')
    return { state: CONNECTION_STATES.DISCONNECTED, reasons }
  }

  if (health.whatsapp_connections_v2_enabled && !health.whatsapp_connection_found) {
    return { state: CONNECTION_STATES.SETUP_REQUIRED, reasons }
  }

  if (['degraded', 'error', 'revoked', 'disabled'].includes(connectionStatus)) {
    reasons.push(`Conexão em estado "${connectionStatus}".`)
  }
  if (Number(health.pending_projection_events || 0) > 0) {
    reasons.push(`${health.pending_projection_events} evento(s) de projeção pendente(s).`)
  }
  const lastSync = health.last_template_sync ? Date.parse(health.last_template_sync) : NaN
  if (!Number.isFinite(lastSync)) {
    reasons.push('Templates ainda não sincronizados com a Meta.')
  } else if (now - lastSync > templateSyncMaxAgeMs) {
    reasons.push('Sincronização de templates desatualizada.')
  }

  if (reasons.length) return { state: CONNECTION_STATES.DEGRADED, reasons }
  return { state: CONNECTION_STATES.CONNECTED, reasons: [] }
}

export const connectionLabel = (state) => CONNECTION_LABELS[state] || CONNECTION_LABELS.unknown
