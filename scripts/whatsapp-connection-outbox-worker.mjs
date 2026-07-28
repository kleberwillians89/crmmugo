import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  SIGNATURE_VERSION,
  signProjection,
} from './lib/whatsapp-projection-signature.mjs'

const TRUE = new Set(['1', 'true', 'yes'])
const forbiddenKeys = /^(authorization|token|access_token|app_secret|verify_token|credential_value|password|service_role|service_role_key|hmac_secret|mugozap_internal_hmac_secret)$/i

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function assertSanitized(value) {
  if (Array.isArray(value)) return value.forEach(assertSanitized)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) throw new Error('OUTBOX_SECRET_FIELD_REJECTED')
    assertSanitized(child)
  }
}

export function retryDelayMs(attempt, base = 1_000, cap = 300_000) {
  return Math.min(cap, base * (2 ** Math.max(0, attempt - 1)))
}

function safeLog(event, fields = {}) {
  const allowed = Object.fromEntries(
    Object.entries(fields).filter(([key]) => [
      'event_id', 'connection_id', 'attempt', 'status', 'error_code', 'dry_run',
    ].includes(key)),
  )
  console.log(JSON.stringify({ event, ...allowed }))
}

async function runFixture(file) {
  const payload = JSON.parse(await fs.readFile(file, 'utf8'))
  assertSanitized(payload)
  crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex')
  safeLog('outbox_dry_run_validated', {
    event_id: payload.event_id,
    connection_id: payload.connection?.id,
    status: 'valid',
    dry_run: true,
  })
}

export async function projectEvent(event, { endpoint, secret, timeoutMs = 12_000, fetchImpl = fetch }) {
  assertSanitized(event)
  const url = new URL('/internal/v1/whatsapp/connections/project', endpoint)
  const body = canonicalJson(event)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signProjection(secret, { eventId: event.event_id, timestamp, rawBody: body })
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mugo-Event-Id': event.event_id,
      'X-Mugo-Timestamp': timestamp,
      'X-Mugo-Signature': signature,
      'X-Mugo-Signature-Version': SIGNATURE_VERSION,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const result = await response.json()
  return { status: response.status, result }
}

async function supabaseRequest(path, { url, key, method = 'GET', body, fetchImpl = fetch }) {
  const response = await fetchImpl(`${url.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`OUTBOX_STORE_HTTP_${response.status}`)
  return response.status === 204 ? null : response.json()
}

async function markEvent(id, patch, config) {
  await supabaseRequest(`/rest/v1/whatsapp_connection_outbox?id=eq.${encodeURIComponent(id)}`, {
    ...config, method: 'PATCH', body: patch,
  })
}

export async function processBatch(config) {
  const rows = await supabaseRequest('/rest/v1/rpc/claim_whatsapp_connection_outbox', {
    ...config,
    method: 'POST',
    body: { p_worker_id: config.workerId, p_limit: config.limit || 20, p_max_attempts: config.maxAttempts || 8 },
  })
  let consecutiveFailures = 0
  for (const row of rows || []) {
    if (consecutiveFailures >= (config.circuitBreakerThreshold || 5)) {
      safeLog('outbox_circuit_open', { status: 'stopped', error_code: 'CIRCUIT_OPEN' })
      break
    }
    try {
      const projected = await projectEvent(row.payload, config)
      const outcome = projected.result?.result
      if (projected.status === 200 && ['applied', 'replayed'].includes(outcome)) {
        await markEvent(row.id, {
          status: 'delivered', delivered_at: new Date().toISOString(),
          locked_at: null, locked_by: null, last_error_code: null,
        }, config)
        consecutiveFailures = 0
        safeLog('outbox_event_delivered', {
          event_id: row.event_id, connection_id: row.aggregate_id, attempt: row.attempts, status: outcome,
        })
        continue
      }
      const permanent = projected.status === 400 || projected.status === 409
      const exhausted = row.attempts >= (config.maxAttempts || 8)
      await markEvent(row.id, {
        status: permanent || exhausted ? 'dead_letter' : 'failed',
        next_attempt_at: permanent || exhausted ? null : new Date(Date.now() + retryDelayMs(row.attempts)).toISOString(),
        locked_at: null, locked_by: null,
        last_error_code: String(projected.result?.code || `PROJECTION_HTTP_${projected.status}`).slice(0, 120),
        last_error_at: new Date().toISOString(),
      }, config)
      consecutiveFailures += 1
    } catch (error) {
      const exhausted = row.attempts >= (config.maxAttempts || 8)
      await markEvent(row.id, {
        status: exhausted ? 'dead_letter' : 'failed',
        next_attempt_at: exhausted ? null : new Date(Date.now() + retryDelayMs(row.attempts)).toISOString(),
        locked_at: null, locked_by: null,
        last_error_code: String(error.name === 'TimeoutError' ? 'PROJECTION_TIMEOUT' : 'PROJECTION_TRANSPORT_ERROR'),
        last_error_at: new Date().toISOString(),
      }, config)
      consecutiveFailures += 1
    }
  }
  return { claimed: (rows || []).length, circuit_open: consecutiveFailures >= (config.circuitBreakerThreshold || 5) }
}

export async function dryRunPending(config) {
  const limit = Math.min(Math.max(config.limit || 10, 1), 100)
  const rows = await supabaseRequest(
    `/rest/v1/whatsapp_connection_outbox?select=id,event_id,aggregate_id,payload,attempts&status=eq.pending&order=occurred_at.asc&limit=${limit}`,
    config,
  )
  for (const row of rows || []) {
    assertSanitized(row.payload)
    const body = canonicalJson(row.payload)
    signProjection(config.secret, {
      eventId: row.event_id,
      timestamp: String(Math.floor(Date.now() / 1000)),
      rawBody: body,
    })
    safeLog('outbox_dry_run_validated', {
      event_id: row.event_id, connection_id: row.aggregate_id, attempt: row.attempts,
      status: 'valid', dry_run: true,
    })
  }
  return { selected: (rows || []).length, dry_run: true }
}

async function main() {
  const args = process.argv.slice(2)
  const fixtureIndex = args.indexOf('--fixture')
  const execute = args.includes('--execute')
  const enabled = TRUE.has(String(process.env.WHATSAPP_CONNECTION_OUTBOX_WORKER_ENABLED || '').toLowerCase())
  const configuredDryRun = !['0', 'false', 'no'].includes(
    String(process.env.WHATSAPP_CONNECTION_OUTBOX_WORKER_DRY_RUN || 'true').toLowerCase(),
  )
  if (args.includes('--validate-legacy')) {
    const connectionId = String(process.env.WHATSAPP_LEGACY_CONNECTION_ID || '')
    const organizationId = String(process.env.WHATSAPP_LEGACY_ORGANIZATION_ID || '')
    const workspaceId = String(process.env.DEFAULT_WORKSPACE_ID || '')
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    safeLog('legacy_mapping_dry_run', {
      status: uuid.test(connectionId) && uuid.test(organizationId) && workspaceId ? 'valid' : 'incomplete',
      dry_run: true,
    })
    return
  }
  if (!execute && fixtureIndex >= 0) {
    if (fixtureIndex < 0 || !args[fixtureIndex + 1]) throw new Error('DRY_RUN_FIXTURE_REQUIRED')
    await runFixture(args[fixtureIndex + 1])
    return
  }
  if (!enabled) throw new Error('OUTBOX_WORKER_DISABLED')
  const config = {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    endpoint: process.env.MUGOZAP_INTERNAL_BASE_URL || process.env.MUGOZAP_API_URL || '',
    secret: process.env.MUGOZAP_INTERNAL_HMAC_SECRET || process.env.MUGOZAP_INTERNAL_V2_SECRET || '',
    workerId: process.env.WHATSAPP_CONNECTION_OUTBOX_WORKER_ID || `worker-${process.pid}`,
    limit: Number(process.env.WHATSAPP_CONNECTION_OUTBOX_BATCH_SIZE || 10),
    maxAttempts: Number(process.env.WHATSAPP_CONNECTION_OUTBOX_MAX_ATTEMPTS || 5),
  }
  if (!config.url || !config.key || !config.secret || (!configuredDryRun && !config.endpoint)) {
    throw new Error('OUTBOX_CONFIGURATION_MISSING')
  }
  if (configuredDryRun) {
    await dryRunPending(config)
    return
  }
  if (!execute) throw new Error('OUTBOX_EXECUTE_CONFIRMATION_REQUIRED')
  await processBatch(config)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    safeLog('outbox_worker_stopped', { status: 'failed', error_code: error.message, dry_run: true })
    process.exitCode = 1
  })
}
