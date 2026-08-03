import fs from 'node:fs'
import assert from 'node:assert/strict'

const migration=fs.readFileSync('supabase/migrations/202607280001_whatsapp_connections_v2.sql','utf8')
const edge=fs.readFileSync('supabase/functions/mugozap-api/index.ts','utf8')

for(const field of ['organization_id','workspace_id','waba_id','phone_number_id','credential_reference','webhook_verify_reference','connection_health','capabilities']){
  assert.match(migration,new RegExp(`\\b${field}\\b`),`missing field ${field}`)
}
for(const status of ['draft','connecting','active','degraded','disabled','revoked','error'])assert.match(migration,new RegExp(`'${status}'`))
assert.match(migration,/enable row level security/i)
assert.match(migration,/force row level security/i)
assert.match(migration,/organization_id = public\.current_organization_id\(\)/)
assert.match(migration,/current_user_role\(\) = 'admin'/)
assert.match(migration,/whatsapp_connections_public/)
assert.match(migration,/status <> 'active'[\s\S]*credential_reference is not null/)
assert.match(migration,/unique index if not exists whatsapp_connections_provider_phone_uidx/)
assert.match(migration,/protect_whatsapp_connection_identity/)
assert.match(migration,/revoke all on public\.whatsapp_connections from anon, authenticated/)
assert.doesNotMatch(migration,/EAA[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+/)

const publicView=migration.slice(migration.indexOf('create or replace view public.whatsapp_connections_public'),migration.indexOf('revoke all on public.whatsapp_connections_public'))
for(const forbidden of ['credential_reference','webhook_verify_reference','workspace_id','phone_number_id','waba_id'])assert.doesNotMatch(publicView,new RegExp(`\\b${forbidden}\\b`),`public view exposes ${forbidden}`)

for(const operation of ['list_whatsapp_connections','get_whatsapp_connection','get_whatsapp_connection_health','validate_whatsapp_connection','resolve_whatsapp_connection_shadow'])assert.match(edge,new RegExp(operation))
const connectionBlock=edge.slice(edge.indexOf('const connectionOperations'),edge.indexOf("if (operation === 'list_templates')"))
for(const forbidden of ['credential_reference','webhook_verify_reference','app_secret']) {
  assert.doesNotMatch(connectionBlock,new RegExp(forbidden),`Edge connection response references ${forbidden}`)
}
console.log('WhatsApp connections V2 contract tests passed')
