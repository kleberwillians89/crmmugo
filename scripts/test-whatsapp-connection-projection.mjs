import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {
  assertSanitized,
  canonicalJson,
  retryDelayMs,
} from './whatsapp-connection-outbox-worker.mjs'
import { signProjection } from './lib/whatsapp-projection-signature.mjs'

assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}')
assert.equal(retryDelayMs(1), 1_000)
assert.equal(retryDelayMs(20), 300_000)
assert.doesNotThrow(() => assertSanitized({ credential_reference: 'opaque://connection/1' }))
assert.throws(() => assertSanitized({ nested: { access_token: 'forbidden' } }), /SECRET/)
assert.equal(
  signProjection('fixture', { eventId: 'event-a', timestamp: '1', rawBody: '{}' }),
  signProjection('fixture', { eventId: 'event-a', timestamp: '1', rawBody: '{}' }),
)
assert.notEqual(
  signProjection('fixture', { eventId: 'event-a', timestamp: '1', rawBody: '{}' }),
  signProjection('fixture', { eventId: 'event-a', timestamp: '1', rawBody: '{"x":1}' }),
)

const crmMigration = await fs.readFile(
  new URL('../supabase/migrations/202607280002_whatsapp_connection_outbox.sql', import.meta.url),
  'utf8',
)
const registryMigration = await fs
  .readFile(
    new URL('../mugozap-backend/mugo-zap/supabase/migrations/202607280001_whatsapp_connection_registry.sql', import.meta.url),
    'utf8',
  )
  .catch(() => null)
const hardeningMigration = await fs.readFile(
  new URL('../supabase/migrations/202607280003_whatsapp_projection_secret_hardening.sql', import.meta.url),
  'utf8',
)
for (const required of [
  'whatsapp_connection_outbox',
  'for update skip locked',
  'whatsapp_jsonb_has_secret_key',
  'source_version',
  'force row level security',
]) assert.ok(crmMigration.toLowerCase().includes(required), `CRM migration missing ${required}`)
assert.ok(!crmMigration.includes('WHATSAPP_TOKEN'))
if (registryMigration === null) {
  console.log('WhatsApp connection projection: registry migration ausente (repo mugozap-backend não presente neste checkout) — parte pulada.')
} else {
  for (const required of [
    'whatsapp_connection_registry',
    'whatsapp_projection_events',
    'apply_whatsapp_connection_projection',
    'source_payload_hash',
    'force row level security',
  ]) assert.ok(registryMigration.toLowerCase().includes(required), `registry migration missing ${required}`)
  assert.ok(!registryMigration.includes('WHATSAPP_TOKEN'))
}
for (const forbidden of ['credential_value', 'access_token', 'app_secret', 'verify_token']) {
  assert.ok(hardeningMigration.includes(`'${forbidden}'`), `hardening missing ${forbidden}`)
}
console.log('WhatsApp connection projection contracts: ok')
