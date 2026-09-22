import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {brazilianPhoneCandidates,normalizeBrazilianPhone,parseInternalCommand,phonesMatch,resolveRelativeDate,taskShortId} from '../supabase/functions/_shared/internalCommandCore.js'
import {planTaskProjection,syncTargetsForOrigin,taskSyncState} from '../supabase/functions/_shared/taskSyncCore.js'

test('normaliza telefones brasileiros e tolera o nono dígito legado',()=>{
  assert.equal(normalizeBrazilianPhone('(11) 94226-0775'),'5511942260775')
  assert.equal(normalizeBrazilianPhone('+55 11 94226-0775'),'5511942260775')
  assert.ok(brazilianPhoneCandidates('5511942260775').includes('551142260775'))
  assert.equal(phonesMatch('11 94226-0775','551142260775'),true)
  assert.equal(phonesMatch('11 94226-0775','5521999999999'),false)
})

test('parser determinístico cobre consultas e mutações principais',()=>{
  const now=new Date('2026-09-21T13:00:00Z')
  assert.equal(parseInternalCommand('oq tenho hoje?',{now}).intent,'LIST_MINE')
  assert.equal(parseInternalCommand('quais tarefas estão atrasadas?',{now}).intent,'LIST_OVERDUE')
  assert.deepEqual(parseInternalCommand('conclui #A1B2C3',{now}).task_short_id,'A1B2C3')
  const created=parseInternalCommand('cria tarefa para Julia ajustar a Roove amanhã',{now})
  assert.equal(created.intent,'CREATE_TASK')
  assert.equal(created.assignee_name,'Julia')
  assert.equal(created.title,'ajustar a Roove')
  assert.equal(created.due_date,'2026-09-22')
  assert.equal(parseInternalCommand('pausa o bot do João').intent,'PAUSE_AUTOMATION')
  assert.equal(parseInternalCommand('o que a Julia tem hoje?').assignee_name,'Julia')
  assert.equal(parseInternalCommand('quem está atendendo João?').intent,'LIST_WAITING_ATTENDANCE')
  assert.equal(parseInternalCommand('tem cobrança pendente?').intent,'LIST_PENDING_CHARGES')
})

test('datas relativas usam calendário de São Paulo',()=>{
  const now=new Date('2026-09-22T01:30:00Z') // ainda 21/09 em São Paulo
  assert.equal(resolveRelativeDate('hoje',now),'2026-09-21')
  assert.equal(resolveRelativeDate('depois de amanhã',now),'2026-09-23')
})

test('short id preserva UUID canônico',()=>assert.equal(taskShortId('39fb6b97-0000-4000-8000-000000000000'),'#39FB6B'))

test('webhook impede comandos externos e todas as consultas críticas têm tenant',()=>{
  const webhook=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8')
  assert.match(webhook,/if \(internalMember\)[\s\S]+task_command_events[\s\S]+return true[\s\S]+automation_events/)
  assert.match(webhook,/\.eq\('organization_id', connection\.organization_id\)\.eq\('active', true\)/)
  const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
  assert.match(worker,/\.eq\('organization_id', event\.organization_id\)/)
  assert.match(worker,/\.eq\('organization_id', org\)/)
})

test('outbox e links externos impõem idempotência por tenant',()=>{
  const migration=fs.readFileSync('supabase/migrations/202609210001_mugo_operational_hub.sql','utf8')
  assert.match(migration,/unique \(task_id, provider\)/)
  assert.match(migration,/unique \(organization_id, provider, external_id\)/)
  assert.match(migration,/unique \(organization_id, provider, idempotency_key\)/)
  assert.match(migration,/where status = 'processing'/)
  assert.match(migration,/enable row level security/g)
})

test('projeções criam uma vez, atualizam pelo external_id e não formam loop',()=>{
  assert.equal(planTaskProjection({link:null,stateHash:'v1'}),'create')
  assert.equal(planTaskProjection({link:{external_id:'card-1',last_synced_hash:'v1'},stateHash:'v2'}),'update')
  assert.equal(planTaskProjection({link:{external_id:'card-1',last_synced_hash:'v2'},stateHash:'v2'}),'skip')
  assert.deepEqual(syncTargetsForOrigin('trello'),['notion'])
  assert.deepEqual(syncTargetsForOrigin('notion'),['trello'])
  assert.deepEqual(taskSyncState({title:'T',status:'pending',priority:'high'}),{title:'T',status:'pending',priority:'high',due_date:null,due_time:null,assigned_to:null,client_id:null,notes:null})
})
