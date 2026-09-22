import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {classifyCommercialInterests,defaultCommercialDecision,detectCommercialHandoff,inferLeadSource,qualificationClassification,validateCommercialDecision} from '../supabase/functions/_shared/commercialAgentCore.js'

test('classifica múltiplos interesses sem inventar dados',()=>{
  assert.deepEqual(classifyCommercialInterests('Preciso de um site integrado ao CRM e WhatsApp'),['SITE','CRM','WHATSAPP','INTEGRATION'])
  const decision=defaultCommercialDecision('Oi, gostaria de fazer um site.')
  assert.deepEqual(decision.intents,['SITE'])
  assert.equal(decision.handoff,false)
  assert.match(decision.response,/site/i)
})
test('handoff comercial ocorre nos sinais reais e não no lead frio',()=>{
  assert.equal(detectCommercialHandoff('Queria conhecer o trabalho de vocês').handoff,false)
  assert.equal(detectCommercialHandoff('Quero uma proposta e falar com alguém').reason,'human_requested')
  assert.equal(detectCommercialHandoff('Qual o valor? Podemos negociar?').reason,'price_negotiation')
  assert.equal(detectCommercialHandoff('Já estou qualificado',{qualified:true}).reason,'qualified_commercial_lead')
})
test('decisão estruturada rejeita execução livre e filtra enums',()=>{
  assert.equal(validateCommercialDecision({response:''}),null)
  const value=validateCommercialDecision({intents:['SITE','DELETE_DATABASE'],response:'Vamos entender.',contact_updates:{},opportunity_updates:{},qualification_updates:{},create_task:false,handoff:false,confidence:4})
  assert.deepEqual(value.intents,['SITE']);assert.equal(value.confidence,1)
})
test('origem comercial distingue anúncios sem inventar campanha',()=>{
  assert.equal(inferLeadSource({metadata:{source_url:'https://x.test/?fbclid=abc'}}),'META_ADS_WHATSAPP')
  assert.equal(inferLeadSource({}),'WHATSAPP_ORGANIC')
})
test('qualificação explica descoberta, suporte e lead qualificado',()=>{
  assert.equal(qualificationClassification({}),'new')
  assert.equal(qualificationClassification({objective:'Gerar leads'}),'discovery')
  assert.equal(qualificationClassification({service_interest:['SUPPORT']}),'support')
  assert.equal(qualificationClassification({qualified:true,needs_human:true}),'qualified')
})
test('webhook cria contato/conversa e roteia IA comercial sem competir com automação',()=>{
  const webhook=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8')
  assert.match(webhook,/whatsapp_contacts'\)\.upsert/)
  assert.match(webhook,/whatsapp_conversations'\)\.upsert/)
  assert.match(webhook,/commercial_ai_events/)
  assert.match(webhook,/ai_mode === 'controlled_auto'[\s\S]+return true[\s\S]+automation_events/)
})
test('worker deduplica cliente, cria oportunidade, qualificação, resumo e tarefa',()=>{
  const worker=fs.readFileSync('supabase/functions/commercial-ai-worker/index.ts','utf8')
  for(const contract of [".in('phone',phones)",".eq('email',contactPatch.email.toLowerCase())","commercial_opportunities","commercial_qualifications","conversation_summaries","crm_tasks","sync_external:true"])assert.ok(worker.includes(contract),contract)
})
test('handoff pausa IA, atribui ID real e notifica por outbox',()=>{
  const worker=fs.readFileSync('supabase/functions/commercial-ai-worker/index.ts','utf8')
  assert.match(worker,/status:'pending',attendance_mode:'human',automation_paused:true,assigned_to:commercialOwnerProfileId,assigned_team_member_id:settingsResult\.data\.commercial_owner_id/)
  assert.match(worker,/commercial_notification_outbox/)
  assert.doesNotMatch(worker,/5511973510549|5511972769605/)
})
test('notificação usa primário, retry e fallback sem envio duplo confirmado',()=>{
  const worker=fs.readFileSync('supabase/functions/commercial-notification-worker/index.ts','utf8')
  assert.match(worker,/COMMERCIAL_WHATSAPP_PRIMARY/);assert.match(worker,/COMMERCIAL_WHATSAPP_FALLBACK/)
  assert.match(worker,/prior\.data\?\.provider_message_id/);assert.match(worker,/SEND_OUTCOME_UNKNOWN/)
  assert.match(worker,/attempts>=3[\s\S]+destination_kind:'fallback'/)
})
test('Trello é relevante por opt-in e Notion gera briefing sob demanda',()=>{
  const migration=fs.readFileSync('supabase/migrations/202609210002_commercial_hub.sql','utf8')
  assert.match(migration,/sync_external/);assert.match(migration,/sync_all/)
  const notion=fs.readFileSync('supabase/functions/_shared/taskIntegrations/notion.ts','utf8')
  assert.match(notion,/createNotionCommercialBriefing/)
  const action=fs.readFileSync('supabase/functions/commercial-actions/index.ts','utf8')
  assert.match(action,/commercial_briefing_outbox/)
})
test('RLS, tenant e webhook inválido permanecem protegidos',()=>{
  const migration=fs.readFileSync('supabase/migrations/202609210002_commercial_hub.sql','utf8')
  assert.match(migration,/force row level security/);assert.match(migration,/protect_commercial_tenant/);assert.match(migration,/current_organization_id\(\)/)
  for(const file of ['trello-task-webhook','notion-task-webhook'])assert.match(fs.readFileSync(`supabase/functions/${file}/index.ts`,'utf8'),/INVALID_SIGNATURE/)
})
