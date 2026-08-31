import assert from 'node:assert/strict'
import { CONNECTION_STATES, connectionLabel, deriveConnectionState } from '../src/services/whatsapp/connectionState.js'

const NOW = Date.parse('2026-08-31T12:00:00Z')
const fresh = new Date(NOW - 3600_000).toISOString()
const stale = new Date(NOW - 3 * 86_400_000).toISOString()

// sem dado -> desconhecido
assert.equal(deriveConnectionState(null).state, CONNECTION_STATES.UNKNOWN)

// erro estruturado de configuração -> configuração necessária
assert.equal(
  deriveConnectionState({ code: 'WABA_ID_MISSING', message: 'sem WABA' }).state,
  CONNECTION_STATES.SETUP_REQUIRED,
)
assert.equal(
  deriveConnectionState({ code: 'UPSTREAM_UNAUTHORIZED', message: 'x' }).state,
  CONNECTION_STATES.DISCONNECTED,
)

// meta não configurada -> configuração necessária
assert.equal(
  deriveConnectionState({ meta_configured: false, mugozap_backend: 'online', supabase: 'online' }).state,
  CONNECTION_STATES.SETUP_REQUIRED,
)

// backend fora -> desconectado
{
  const result = deriveConnectionState({ meta_configured: true, mugozap_backend: 'unavailable', supabase: 'online' }, { now: NOW })
  assert.equal(result.state, CONNECTION_STATES.DISCONNECTED)
  assert.ok(result.reasons.some((r) => /MugoZap/i.test(r)))
}

// tudo ok e sync recente -> conectado
assert.equal(
  deriveConnectionState(
    { meta_configured: true, mugozap_backend: 'online', supabase: 'online', whatsapp_connection_status: 'active', pending_projection_events: 0, last_template_sync: fresh },
    { now: NOW },
  ).state,
  CONNECTION_STATES.CONNECTED,
)

// conectado mas com pendências -> degradado
{
  const result = deriveConnectionState(
    { meta_configured: true, mugozap_backend: 'online', supabase: 'online', whatsapp_connection_status: 'degraded', pending_projection_events: 4, last_template_sync: stale },
    { now: NOW },
  )
  assert.equal(result.state, CONNECTION_STATES.DEGRADED)
  assert.ok(result.reasons.length >= 2)
}

assert.equal(connectionLabel(CONNECTION_STATES.CONNECTED), 'Conectado')
assert.equal(connectionLabel(CONNECTION_STATES.SETUP_REQUIRED), 'Configuração necessária')
assert.equal(connectionLabel('bogus'), 'Verificando')

console.log('WhatsApp connection state contracts: ok')
