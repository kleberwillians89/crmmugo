import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read=path=>fs.readFileSync(path,'utf8')
const actions=read('supabase/functions/commercial-actions/index.ts')
const repository=read('src/services/data/commercialRepository.js')
const whatsappPage=read('src/components/WhatsAppPage.jsx')
const preview=read('scripts/go-live/2026-10-01-mugo-preview.sql')
const apply=read('scripts/go-live/2026-10-01-mugo-apply.sql')

test('commercial-actions responde preflight compatível com supabase-js',()=>{
  assert.match(actions,/Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'/)
  assert.match(actions,/Access-Control-Allow-Methods': 'POST, OPTIONS'/)
  assert.match(actions,/request\.method === 'OPTIONS'[\s\S]*status: 200/)
})

test('handoff manual usa fila canônica e é idempotente por oportunidade',()=>{
  assert.match(actions,/from\('team_notification_outbox'\)\.upsert/)
  assert.doesNotMatch(actions,/from\('commercial_notification_outbox'\)/)
  assert.match(actions,/idempotency_key: handoffRef/)
  assert.match(actions,/source_ref: handoffRef/)
  assert.match(actions,/details->>idempotency_key/)
  assert.match(actions,/sameHandoff/)
  assert.match(actions,/attendance_mode: 'human'/)
  assert.match(actions,/automation_paused: true/)
  assert.match(actions,/opportunity_id: opportunity\.id/)
  assert.match(actions,/dispatchTeamWorker/)
})

test('frontend preserva código, status e request id da Edge Function',()=>{
  for(const code of ['UNAUTHORIZED','FORBIDDEN','CONVERSATION_NOT_FOUND','COMMERCIAL_OWNER_NOT_CONFIGURED','HANDOFF_FAILED'])assert.match(repository,new RegExp(code))
  assert.match(repository,/error\.context\.clone\(\)\.json\(\)/)
  assert.match(repository,/this\.requestId/)
  assert.match(whatsappPage,/cause\.requestId/)
  assert.doesNotMatch(whatsappPage,/Briefing enfileirado para o Notion/)
})

test('preview financeiro é somente leitura e cobre todas as seções de decisão',()=>{
  assert.doesNotMatch(preview,/^\s*(?:insert|update|delete|truncate|alter|drop)\s/im)
  for(const section of ['RECURRENT_CONTRACT','FUTURE_INSTALLMENT','SEPTEMBER_HISTORY','LEGACY_COLLECTION_INSTALLMENT','BUSINESS_EXPENSE','FISCAL_PROVISION','FREELANCE','LEGACY_TASK','OPENING_BALANCE','CUTOVER_SUMMARY'])assert.match(preview,new RegExp(section))
  for(const classification of ['KEEP','UPDATE','CREATE','SUPERSEDE','CANCEL','REVIEW','ARCHIVE'])assert.match(preview,new RegExp(`'${classification}'`))
  assert.match(preview,/15000::numeric as brl_monthly/)
  assert.match(preview,/100::numeric as eur_monthly/)
  assert.match(preview,/25::integer as expected_installments/)
})

test('corte usa Roove canônica, cria Latina com segurança e preserva multi-moeda',()=>{
  for(const sql of [preview,apply]){
    assert.match(sql,/e7919cd3-c989-49c9-994f-eb31aa9ce294/)
    assert.match(sql,/3b56bcde-99b5-4244-9a5d-e0535339a59f/)
    assert.doesNotMatch(sql,/a0ce7df3-a9bd-458f-83cf-f6b0a8b9271c/)
    assert.doesNotMatch(sql,/078a840a-5363-4a33-b6fe-646c1a5b851c/)
    assert.doesNotMatch(sql,/586[,.]12/)
  }
  assert.match(apply,/official_name='Latina' and v_count=0/)
  assert.match(apply,/monthly_value[\s\S]*v_target\.currency='BRL'[\s\S]*else 0/)
  assert.match(apply,/greatest\(coalesce\(end_date,date '2027-02-28'\),date '2027-02-28'\)/)
})

test('apply é transacional, idempotente e não dispara infraestrutura externa',()=>{
  assert.match(apply,/^begin;/i)
  assert.match(apply,/commit;\s*$/i)
  assert.match(apply,/on conflict\(organization_id,contract_id,installment_type,reference_month\) do update/)
  assert.match(apply,/perform set_config\('app\.receipt_rpc','true',true\)/)
  assert.match(apply,/paid_at=null/)
  assert.match(apply,/status not in\('paid','cancelled'\) and coalesce\([^\n]+received_amount,0\)=0 and [^\n]+paid_at is null/)
  assert.doesNotMatch(apply,/\b(?:delete|truncate|net\.http_post|cron\.|whatsapp|meta_access_token)\b/i)
  for(const key of ['financial_cutover','superseded_reason','legacy_projection_reconciled','cutover_version'])assert.match(apply,new RegExp(key))
})

test('tarefas de homologação usam somente os três UUIDs reais',()=>{
  for(const id of ['5b6aa2f7-135e-4a34-9ab7-5991f16d300b','13907ff1-f34e-49e6-9da5-5009d535e119','9bc0394c-ba98-46c4-a17e-6e7c99f86a20']){
    assert.match(preview,new RegExp(id))
    assert.match(apply,new RegExp(id))
  }
  assert.doesNotMatch(apply,/title in\(/i)
})
