import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../supabase/migrations/202608310003_whatsapp_operational_history.sql')
const hardening = read('../supabase/migrations/202608310004_whatsapp_operational_hardening.sql')
const webhook = read('../supabase/functions/whatsapp-webhook/index.ts')
const webhookCore = read('../supabase/functions/_shared/whatsappWebhookCore.js')
const edge = read('../supabase/functions/mugozap-api/index.ts')
const config = read('../supabase/config.toml')

for (const table of [
  'whatsapp_contacts', 'whatsapp_conversations', 'whatsapp_messages',
  'whatsapp_webhook_events', 'whatsapp_conversation_events', 'whatsapp_follow_ups',
]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`))

assert.match(migration, /unique \(connection_id, wa_id\)/)
assert.match(migration, /whatsapp_messages_provider_uidx/)
assert.match(migration, /whatsapp_messages_idempotency_uidx/)
assert.match(migration, /protect_whatsapp_operational_tenant/)
assert.match(migration, /force row level security/)
assert.match(migration, /current_organization_id\(\)/)
assert.match(migration, /grant select on public\.%I to authenticated/)
assert.match(migration, /grant select, insert, update, delete on public\.%I to service_role/)

assert.match(webhook, /X-Hub-Signature-256/)
assert.match(webhook, /META_APP_SECRET/)
assert.match(webhookCore, /crypto\.subtle\.sign\('HMAC'/)
assert.match(webhook, /eq\('phone_number_id', phoneNumberId\)/)
assert.match(webhook, /whatsapp_webhook_events/)
assert.match(webhook, /whatsapp_message_received/)
assert.match(webhook, /CONTACT_REPLIED/)
assert.doesNotMatch(webhook, /raw_payload\s*:/, 'webhook não persiste payload bruto')
assert.match(config, /\[functions\.whatsapp-webhook\]\s+verify_jwt = false/)
assert.match(config, /\[functions\.whatsapp-automation-worker\]\s+verify_jwt = false/)

assert.match(edge, /persistOutboundMessage/)
assert.match(edge, /list_crm_contacts/)
assert.match(edge, /list_crm_message_history/)
assert.match(edge, /CRM_AUDIT_FAILED/)
assert.match(hardening, /protect_whatsapp_contact_tenant/)
assert.match(hardening, /protect_whatsapp_webhook_tenant/)
assert.match(hardening, /reconcile_whatsapp_message_status/)
assert.match(hardening, /message_delivered/)
assert.match(hardening, /message_read/)

console.log('WhatsApp operational history contracts: ok')
