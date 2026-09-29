import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseInternalCommand, resolveRelativeDate } from '../supabase/functions/_shared/internalCommandCore.js'

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const taskWorker=read('supabase/functions/task-command-worker/index.ts')
const teamWorker=read('supabase/functions/team-notification-worker/index.ts')
const commercialWorker=read('supabase/functions/commercial-notification-worker/index.ts')
const webhook=read('supabase/functions/whatsapp-webhook/index.ts')
const migration=read('supabase/migrations/202609250005_whatsapp_proactive_context_and_handoff_sla.sql')
const finalMigration=read('supabase/migrations/202609250007_whatsapp_task_and_handoff_hardening.sql')
const commercialAiWorker=read('supabase/functions/commercial-ai-worker/index.ts')
const commercialActions=read('supabase/functions/commercial-actions/index.ts')
const tasksRepository=read('src/services/data/tasksRepository.js')

test('mensagem com três tarefas gera três itens independentes',()=>{
  const parsed=parseInternalCommand('criar tarefas:\nrevisar Roove\najustar Origami\nmandar relatório para Julia')
  assert.equal(parsed.intent,'CREATE_TASK')
  assert.deepEqual(parsed.items.map(item=>item.title),['revisar Roove','ajustar Origami','mandar relatório para Julia'])
  assert.match(taskWorker,/`\$\{event\.id\}:\$\{index\}`/)
})

test('lista multilinha sem cabeçalho também gera tarefas independentes',()=>{
  const parsed=parseInternalCommand('revisar Roove\najustar Origami\nmandar relatório Julia')
  assert.equal(parsed.intent,'CREATE_TASK')
  assert.deepEqual(parsed.items.map(item=>item.title),['revisar Roove','ajustar Origami','mandar relatório Julia'])
})

test('relato natural vira três atividades concluídas e não observações',()=>{
  const parsed=parseInternalCommand('Hoje eu fiz 6 roteiros para Origami, mandei para aprovação. Fiz post da Mugô e enviei os posts de outubro para Latinas.',{now:new Date('2026-09-28T12:00:00-03:00')})
  assert.equal(parsed.intent,'ACTIVITY_COMPLETE')
  assert.equal(parsed.due_date,'2026-09-28')
  assert.equal(parsed.items.length,3)
})

test('data efetiva aceita ontem, dia do mês e dia da semana',()=>{
  const now=new Date('2026-09-28T12:00:00-03:00')
  assert.equal(resolveRelativeDate('ontem',now),'2026-09-27')
  assert.equal(resolveRelativeDate('dia 24',now),'2026-09-24')
  assert.equal(resolveRelativeDate('sexta',now),'2026-10-02')
  assert.match(taskWorker,/effective_date_pending/)
  assert.match(taskWorker,/ACTIVITY_DATE_RESOLUTION/)
})

test('digest e LIST_MINE usam o mesmo read model por membro',()=>{
  assert.match(taskWorker,/getMemberTaskReadModel\(admin,org,event\.team_member_id,today\(\)\)/)
  assert.match(teamWorker,/getMemberTaskReadModel\(admin, organizationId, teamMemberId, today\)/)
  assert.match(teamWorker,/candidate_items/)
})

test('rotinas proativas respeitam dias úteis e horário comercial',()=>{
  assert.match(teamWorker,/getOperationalWindow/)
  assert.match(teamWorker,/if\(!operationalWindow\.open\)continue/)
  assert.match(finalMigration,/internal_business_start_time time not null default '08:00:00'/)
  assert.match(finalMigration,/internal_business_end_time time not null default '20:00:00'/)
  assert.match(finalMigration,/organization_operational_calendar/)
})

test('fora da janela exige template cadastrado como aprovado',()=>{
  for(const source of [teamWorker,commercialWorker]){
    assert.match(source,/service_window_expires_at/)
    assert.match(source,/APPROVED_TEMPLATE_REQUIRED/)
    assert.match(source,/toUpperCase\(\)!=='APPROVED'/)
    assert.match(source,/message_type:\s*messageType/)
  }
})

test('handoff possui reminder, escalation e alerta em human mode',()=>{
  assert.match(migration,/handoff_reminder_minutes integer not null default 5/)
  assert.match(migration,/handoff_escalation_minutes integer not null default 15/)
  assert.match(teamWorker,/enqueueHandoffSla/)
  assert.match(webhook,/notification_type:'human_mode_message'/)
  assert.match(webhook,/if \(humanControlled\)/)
})

test('reuniões naturais preservam participante, data local e horário',()=>{
  const now=new Date('2026-09-28T12:00:00-03:00')
  const cases=[
    ['Reunião Liliu 10hrs','Reunião com Liliu','2026-09-28','10:00'],
    ['reunião com Julia amanhã 14h','Reunião com Julia','2026-09-29','14:00'],
    ['call Roove sexta 15h','Call com Roove','2026-10-02','15:00'],
    ['reunião segunda às 9:30','Reunião','2026-10-05','09:30'],
    ['reunião segunda 9:30','Reunião','2026-10-05','09:30'],
  ]
  for(const [message,title,date,time] of cases){const parsed=parseInternalCommand(message,{now});assert.equal(parsed.intent,'CREATE_TASK');assert.equal(parsed.title,title);assert.equal(parsed.due_date,date);assert.equal(parsed.due_time,time);assert.equal(parsed.task_type,'meeting')}
  assert.equal(parseInternalCommand('reunião com Julia',{now}).schedule_ambiguous,true)
})

test('status operacional natural atualiza tarefa existente',()=>{
  const parsed=parseInternalCommand('Site Origami aguardando aprovação')
  assert.equal(parsed.intent,'UPDATE_TASK_STATUS')
  assert.equal(parsed.task_query,'Site Origami')
  assert.equal(parsed.task_status,'waiting_approval')
  assert.match(taskWorker,/intent === 'UPDATE_TASK_STATUS'/)
  assert.match(finalMigration,/waiting_approval/)
  assert.deepEqual(
    [parseInternalCommand('esperando material'),parseInternalCommand('bloqueada')].map(item=>[item.intent,item.task_query,item.task_status]),
    [['UPDATE_TASK_STATUS','', 'waiting_material'],['UPDATE_TASK_STATUS','', 'blocked']],
  )
  assert.equal(parseInternalCommand('comecei').intent,'ACTIVITY_START')
  assert.equal(parseInternalCommand('finalizei').intent,'ACTIVITY_COMPLETE')
  assert.equal(parseInternalCommand('cancelei').intent,'CANCEL_TASK')
  assert.match(taskWorker,/selectedTask&&\['CANCEL_TASK','UPDATE_TASK_STATUS'\]/)
})

test('lista geral não exclui tarefas sem due_date',()=>{
  const listTasks=tasksRepository.slice(tasksRepository.indexOf('export async function listTasks'),tasksRepository.indexOf('export async function createTask'))
  assert.match(listTasks,/from\('crm_tasks'\)\.select\(select\)\.is\('archived_at',null\)/)
  assert.doesNotMatch(listTasks,/not\('due_date'|gte\('due_date'/)
})

test('handoff novo usa somente a fila unificada e tenta dispatch imediato',()=>{
  assert.match(commercialAiWorker,/from\('team_notification_outbox'\)/)
  assert.match(commercialActions,/from\('team_notification_outbox'\)/)
  assert.doesNotMatch(commercialAiWorker,/from\('commercial_notification_outbox'\)/)
  assert.doesNotMatch(commercialActions,/from\('commercial_notification_outbox'\)/)
  assert.match(commercialAiWorker,/dispatchTeamWorker/)
  assert.match(finalMigration,/team-notification-worker-every-minute/)
  assert.match(teamWorker,/1\. Assumir/)
  assert.match(teamWorker,/2\. Ver contexto/)
  assert.match(taskWorker,/TAKE_CONVERSATION_BY_ID/)
  assert.match(taskWorker,/CONVERSATION_CONTEXT/)
})

test('SLA do handoff é 5/15/30 e envia uma única mensagem transacional ao cliente',()=>{
  assert.match(finalMigration,/handoff_critical_minutes integer not null default 30/)
  assert.match(teamWorker,/handoff-client-sla-15:/)
  assert.match(teamWorker,/MUGO_CLIENT_HANDOFF_SLA_TEMPLATE_NAME/)
  assert.match(teamWorker,/handoff_critical/)
  assert.match(teamWorker,/hasHumanOutbound/)
})
