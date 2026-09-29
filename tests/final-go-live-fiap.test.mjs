import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { normalizePhoneForWhatsApp } from '../supabase/functions/_shared/internalCommandCore.js'

const read = path => fs.readFileSync(path, 'utf8')
const migration006 = read('supabase/migrations/202609250006_whatsapp_trigger_safe_row_access.sql')
const migration007 = read('supabase/migrations/202609250007_whatsapp_task_and_handoff_hardening.sql')
const migration008 = read('supabase/migrations/202609250008_collection_dispatch_and_e164.sql')
const collectionWorker = read('supabase/functions/collection-notification-worker/index.ts')
const preview = read('scripts/go-live/2026-10-01-mugo-preview.sql')
const apply = read('scripts/go-live/2026-10-01-mugo-apply.sql')
const reconciliation = read('scripts/go-live/reconcile-legacy-template.sql')
const demo = read('scripts/go-live/fiap-demo-seed.sql')

test('migration 006 usa acesso JSONB e valida as funções reais', () => {
  assert.match(migration006, /to_jsonb\(new\)/i)
  assert.match(migration006, /to_jsonb\(old\)/i)
  assert.match(migration006, /pg_get_functiondef/)
  assert.doesNotMatch(migration006, /\b(?:new|old)\.(?:team_member_id|assigned_team_member_id)\b/i)
  assert.match(migration006, /if tg_op = 'DELETE' then return old/)
})

test('migration 007 mantém um cron interno, agenda final e não altera ai_mode', () => {
  assert.match(migration007, /crmugo-team-notification-worker/)
  assert.match(migration007, /active_jobs <> 1/)
  assert.match(migration007, /schedule = '\* \* \* \* \*'/)
  for (const time of ['08:00:00', '12:30:00', '17:30:00', '19:30:00', '20:00:00']) assert.match(migration007, new RegExp(time))
  assert.doesNotMatch(migration007, /update\s+public\.commercial_settings[\s\S]*ai_mode/i)
})

test('E.164 preserva Espanha e só infere Brasil em número local brasileiro', () => {
  assert.equal(normalizePhoneForWhatsApp('+34632881089'), '34632881089')
  assert.equal(normalizePhoneForWhatsApp('34632881089'), '34632881089')
  assert.equal(normalizePhoneForWhatsApp('11999999999'), '5511999999999')
})

test('cobrança reserva alerta e mensagem canônica antes da chamada Meta', () => {
  const alert = collectionWorker.indexOf("from('whatsapp_collection_alerts').insert")
  const message = collectionWorker.indexOf("from('whatsapp_messages').insert")
  const meta = collectionWorker.indexOf('https://graph.facebook.com/')
  assert.ok(alert > 0 && message > alert && meta > message)
  assert.match(collectionWorker, /queue:'finance_collection'/)
  assert.match(collectionWorker, /initiated_by:'business'/)
  assert.match(collectionWorker, /template_send_unconfirmed/)
  assert.match(migration008, /organization_id,installment_id,notification_type,due_date_snapshot/)
})

test('corte financeiro é preview-only + apply transacional sem DELETE/TRUNCATE', () => {
  assert.doesNotMatch(preview, /^\s*(?:insert|update|delete|truncate)\s/im)
  assert.match(apply, /^begin;/i)
  assert.match(apply, /commit;\s*$/i)
  assert.doesNotMatch(apply, /\b(?:delete|truncate)\b/i)
  for (const month of ['2026-10-01', '2027-02-01']) assert.match(apply, new RegExp(month))
  assert.match(apply, /'Latina','EUR',100,10/)
  assert.match(apply, /status='cancelled'/)
})

test('reconciliação do legado não chama Meta nem reenvia', () => {
  assert.match(reconciliation, /cobranca-roove-20260928-5511931462536/)
  assert.match(reconciliation, /send_performed',false/)
  assert.match(reconciliation, /on conflict\(connection_id,idempotency_key\) do nothing/)
  assert.doesNotMatch(reconciliation, /http|fetch|graph\.facebook/i)
})

test('seed FIAP é isolado, sintético e sem transporte ativo', () => {
  assert.match(demo, /crm-mugo-demo-fiap/)
  assert.match(demo, /'disabled'/)
  assert.match(demo, /@example\.invalid/)
  assert.match(demo, /commercial_opportunities/)
  assert.match(demo, /proposals/)
  assert.match(demo, /contracts/)
  assert.match(demo, /invoice_installments/)
  assert.match(demo, /crm_tasks/)
  assert.match(demo, /expense_installments/)
  assert.match(demo, /whatsapp_collection_alerts/)
  assert.match(demo, /send_performed',false/)
  assert.doesNotMatch(demo, /http|graph\.facebook|net\.http/i)
})

test('README e checklist substituem o template e documentam operação segura', () => {
  const readme = read('README.md')
  const checklist = read('docs/GO_LIVE_CHECKLIST.md')
  assert.match(readme, /^# CRM Mugô/m)
  assert.doesNotMatch(readme, /React \+ Vite/)
  assert.match(checklist, /Sequência exata de produção/)
  assert.match(checklist, /HTTP 200/)
})
