import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {parseInternalCommand} from '../supabase/functions/_shared/internalCommandCore.js'
import {calculateCommercialPerformance} from '../src/lib/commercialMetrics.js'
import {summarizeOperationHours,taskCategoryScope} from '../src/lib/operationalCalendar.js'

test('parser separa tarefa, atividade, observação, horas, proposta e financeiro',()=>{
  const tomorrow=parseInternalCommand('cria tarefa para amanhã revisar CAFIFA')
  assert.equal(tomorrow.intent,'CREATE_TASK');assert.equal(tomorrow.title,'revisar CAFIFA');assert.equal(tomorrow.assignee_name,null)
  const naturalTomorrow=parseInternalCommand('Cria uma tarefa para amanhã revisar Origami')
  assert.equal(naturalTomorrow.intent,'CREATE_TASK');assert.equal(naturalTomorrow.title,'revisar Origami')
  const delegated=parseInternalCommand('Julia precisa pedir relatório da Roove quinta')
  assert.equal(delegated.intent,'CREATE_TASK');assert.equal(delegated.assignee_name,'Julia');assert.equal(delegated.title,'pedir relatório da Roove')
  assert.equal(parseInternalCommand('comecei o site da Origami').intent,'ACTIVITY_START')
  assert.equal(parseInternalCommand('terminei os ajustes da Roove').intent,'ACTIVITY_COMPLETE')
  assert.equal(parseInternalCommand('anota que a CAFIFA pediu retorno amanhã').intent,'RECORD_OBSERVATION')
  assert.equal(parseInternalCommand('trabalhei 9 horas hoje').intent,'RECORD_TIME')
  const proposal=parseInternalCommand('anota orçamento de 4500 para CAFIFA')
  assert.equal(proposal.intent,'RECORD_PROPOSAL');assert.equal(proposal.amount,4500)
  const sent=parseInternalCommand('anota que enviamos orçamento para CAFIFA')
  assert.equal(sent.intent,'RECORD_PROPOSAL');assert.equal(sent.proposal_status,'sent');assert.equal(sent.subject_query,'CAFIFA')
  const website=parseInternalCommand('Fizemos orçamento para CAFIFA de R$ 4.500 para o site')
  assert.equal(website.subject_query,'CAFIFA');assert.equal(website.service,'site');assert.equal(website.amount,4500)
  assert.equal(parseInternalCommand('gastei 106 reais em tráfego').intent,'FINANCIAL_EXPENSE_REQUEST')
  assert.equal(parseInternalCommand('entrou 3200 da Roove').intent,'FINANCIAL_RECEIPT_REQUEST')
})

test('propostas e documentos reutilizam schema e bucket privado existentes',()=>{
  const sql=fs.readFileSync('supabase/migrations/202609220004_structured_proposals_and_documents.sql','utf8')
  assert.doesNotMatch(sql,/create table if not exists public\.commercial_proposals/i)
  for(const term of ['alter table public.proposals','alter table public.documents','commercial_command_confirmations','opportunity_id','conversation_id','task_id','content_sha256','protect_commercial_command_tenant','protect_proposal_document_tenant'])assert.ok(sql.includes(term),term)
  assert.match(sql,/values\('crm-documents','crm-documents',false,10485760/)
  assert.match(sql,/allowed_mime_types[\s\S]+application\/pdf[\s\S]+image\/webp/)
})

test('webhook preserva mídia e worker grava somente depois da confirmação',()=>{
  const webhook=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8')
  const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
  for(const term of ['message_id: saved.data?.id','message_type: content.type','media: content.media'])assert.ok(webhook.includes(term),term)
  for(const term of ['ATTACH_PROPOSAL_FILE','awaiting_context','META_ACCESS_TOKEN','crm-documents','content_sha256','MEDIA_TOO_LARGE','MEDIA_TYPE_NOT_ALLOWED','proposal_attachment'])assert.ok(worker.includes(term),term)
  assert.match(worker,/source_ref:event\.provider_message_id/)
  assert.match(worker,/clients\/\$\{pending\.client_id\}\/proposals/)
})

test('aceite fecha oportunidade sem registrar receita',()=>{
  const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
  const start=worker.indexOf("pending.action_type==='proposal_update'")
  const end=worker.indexOf('const document=await downloadCommercialMedia',start)
  const branch=worker.slice(start,end)
  assert.match(branch,/stage:status==='accepted'\?'won':'lost'/)
  assert.doesNotMatch(branch,/invoice_installments|payments|received_amount|financial_revenues/)
  const metrics=calculateCommercialPerformance([{status:'accepted',total_value:4500,sent_at:'2026-09-01'},{status:'rejected',total_value:1000,sent_at:'2026-09-01'}])
  assert.deepEqual([metrics.won,metrics.lost,metrics.open],[1,1,0])
})

test('go-live é nativo, desativa projeções externas e mantém IA desligada',()=>{
  const sql=fs.readFileSync('supabase/migrations/202609220005_native_go_live_preparation.sql','utf8')
  assert.match(sql,/task_integration_settings[\s\S]+enabled=false/)
  assert.match(sql,/drop trigger if exists enqueue_task_sync/)
  assert.match(sql,/commercial_settings set ai_mode='disabled'/)
  assert.match(sql,/weekly_target_hours numeric[\s\S]+default 35/)
  assert.match(sql,/access_role_presets[\s\S]+'operator'/)
  assert.doesNotMatch(sql,/insert into public\.clients/i)
})

test('receitas recorrentes preservam valores e moeda original',()=>{
  const sql=fs.readFileSync('supabase/migrations/202609220005_native_go_live_preparation.sql','utf8')
  for(const term of ["billing_day=5","billing_day=25","'recurring:ruah'","'recurring:latina'","'currency','EUR'","'original_amount',100","'exchange_rate',null","'actual_brl_amount',null"])assert.ok(sql.includes(term),term)
  assert.doesNotMatch(sql,/monthly_value\s*=|total_value\s*=/)
})

test('dry-run de limpeza não contém exclusão e preserva dados vinculados',()=>{
  const sql=fs.readFileSync('supabase/migrations/202609220005_native_go_live_preparation.sql','utf8')
  const start=sql.indexOf('create or replace function public.crm_cleanup_dry_run')
  const branch=sql.slice(start)
  assert.match(branch,/crm_cleanup_snapshots/)
  assert.match(branch,/Propostas só são candidatas[\s\S]+sem contrato\/documento/)
  assert.match(branch,/Parcelas e recebimentos não são removidos automaticamente/)
  assert.doesNotMatch(branch,/delete\s+from/i)
})

test('rotina usa uma fonte com horas e classificação de calendário',()=>{
  const hours=summarizeOperationHours([{planned_hours:8,worked_hours:6},{planned_hours:2,worked_hours:3}],35)
  assert.deepEqual(hours,{target:35,planned:10,worked:9,remaining:26,balance:-1})
  assert.equal(taskCategoryScope({category:'Família'}),'personal')
  assert.equal(taskCategoryScope({category:'Trabalho'}),'work')
  assert.equal(taskCategoryScope({client_id:'x',category:'Trabalho'}),'clients')
  const page=fs.readFileSync('src/components/OperationsHubPage.jsx','utf8')
  for(const term of ['Horas planejadas','Horas realizadas','Meta semanal','Rotina','Tarefas e compromissos','Filtrar calendário','Concluídos','Registrar horas'])assert.ok(page.includes(term)||term==='Registrar horas'&&page.includes('Quantas horas foram realizadas'),term)
})

test('fluxo principal não oferece configurações externas',()=>{
  const files=['src/components/OperationsHubPage.jsx','src/components/TodayPage.jsx','src/components/IntegrationsPage.jsx','src/components/CommercialPage.jsx','src/components/WhatsAppPage.jsx','src/services/data/tasksRepository.js']
  for(const file of files){const content=fs.readFileSync(file,'utf8');assert.doesNotMatch(content,/Trello|Notion|trello|notion/,file)}
})

test('RLS financeira e tenant permanecem no backend',()=>{
  const financial=fs.readFileSync('supabase/migrations/202609220003_financial_hub_2026.sql','utf8')
  const goLive=fs.readFileSync('supabase/migrations/202609220005_native_go_live_preparation.sql','utf8')
  for(const permission of ['finance.view_business','finance.view_household','finance.view_private','finance.create_expense','finance.confirm_expense','finance.confirm_receipt','finance.view_debts','finance.manage_debts','finance.view_reserves','finance.close_month','finance.export'])assert.ok(financial.includes(permission),permission)
  assert.match(financial,/can_view_financial_scope/)
  assert.match(goLive,/force row level security/)
  assert.match(goLive,/denied_capabilities[\s\S]+finance\.view_private/)
  assert.match(goLive,/whatsapp_conversations_read[\s\S]+assigned_team_member_id=public\.current_team_member_id\(\)/)
})
