import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const activation = read('../supabase/migrations/202608310001_whatsapp_automation_activation.sql')
const triggers = read('../supabase/migrations/202608310002_whatsapp_automation_triggers.sql')
const worker = read('../supabase/functions/whatsapp-automation-worker/index.ts')

// ---- migration de ativação: RLS, grants e idempotência ------------------------
for (const table of ['automation_flows', 'automation_versions', 'automation_runs', 'automation_run_steps', 'automation_events', 'automation_logs', 'automation_dead_letters']) {
  assert.ok(activation.includes(`public.%I`) || activation.includes(`public.${table}`), `migration menciona ${table}`)
}
assert.match(activation, /enable row level security/)
assert.match(activation, /force row level security/)
assert.match(activation, /grant select on public\.%I to authenticated/)
assert.match(activation, /current_organization_id\(\)/)
assert.match(activation, /public\.can_write\(\)/)
assert.match(activation, /public\.is_active_user\(\)/)
// runs/steps/events são somente leitura para authenticated (sem policy de insert/update)
assert.doesNotMatch(activation, /create policy automation_runs_(insert|update|write)/)
assert.doesNotMatch(activation, /create policy automation_events_(insert|update|write)/)
// idempotência: um evento não dispara o mesmo fluxo duas vezes
assert.match(activation, /create unique index if not exists automation_runs_idempotency_uidx\s+on public\.automation_runs\(flow_id, idempotency_key\)/)
assert.match(activation, /create unique index if not exists automation_events_dedupe_uidx/)

// RPC enqueue: exige can_write, recusa segredos, é para authenticated
assert.match(activation, /function public\.enqueue_automation_event/)
assert.match(activation, /not public\.can_write\(\)/)
assert.match(activation, /payload must not contain secret keys/)
assert.match(activation, /grant execute on function public\.enqueue_automation_event\([^)]*\) to authenticated/)

// RPC claim: só service_role, lock pessimista
assert.match(activation, /function public\.claim_automation_events/)
assert.match(activation, /for update skip locked/)
assert.match(activation, /revoke all on function public\.claim_automation_events\([^)]*\) from public, anon, authenticated/)
assert.match(activation, /grant execute on function public\.claim_automation_events\([^)]*\) to service_role/)

// ---- migration de triggers -----------------------------------------------
assert.match(triggers, /security definer/)
assert.match(triggers, /set search_path = ''/)
assert.match(triggers, /on conflict \(organization_id, dedupe_key\) where dedupe_key is not null\s+do nothing/)
assert.match(triggers, /create trigger automation_lead_created\s+after insert on public\.clients/)
assert.match(triggers, /create trigger automation_invoice_overdue\s+after update on public\.invoice_installments/)
assert.match(triggers, /new\.status = 'overdue' and old\.status is distinct from 'overdue'/)
assert.match(triggers, /revoke all on function public\.emit_automation_event/)

// ---- worker: usa o executor testado e respeita idempotência/dead-letter -----
assert.match(worker, /from '\.\.\/\.\.\/\.\.\/src\/services\/whatsapp\/automationExecutor\.js'/)
assert.match(worker, /executeRun/)
assert.match(worker, /claim_automation_events/)
assert.match(worker, /idempotency_key: idempotencyKey/)
assert.match(worker, /insert\.error\.code === '23505'/) // conflito de idempotência -> não reexecuta
assert.match(worker, /deadLetterDecision/)
assert.match(worker, /automation_dead_letters/)
assert.match(worker, /AUTOMATION_WORKER_KEY/)
assert.match(worker, /X-Automation-Worker-Key/)
assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/)
// nunca loga segredos
for (const line of worker.split('\n').filter((l) => l.includes('console.log'))) {
  assert.doesNotMatch(line, /SERVICE_ROLE_KEY|PANEL_API_KEY|AUTOMATION_WORKER_KEY|Authorization/)
}
// declara o bloqueio externo explicitamente
assert.match(worker, /BLOQUEIO EXTERNO/)

console.log('WhatsApp automation worker contracts: ok')
