import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {isoInSaoPaulo,monthGrid,projectTasks,weekDays} from '../src/lib/operationalCalendar.js'
import {parseInternalCommand} from '../supabase/functions/_shared/internalCommandCore.js'

const tasks=[
  {id:'one',title:'Hoje',due_date:'2026-09-22',status:'pending'},
  {id:'late',title:'Atrasada',due_date:'2026-09-21',status:'pending'},
  {id:'done',title:'Concluída',due_date:'2026-09-22',status:'completed'},
  {id:'later',title:'Semana',due_date:'2026-09-25',status:'pending'},
  {id:'backlog',title:'Sem data',due_date:null,status:'pending'},
]

test('dia, semana e mês são projeções da mesma tarefa canônica',()=>{
  const today=projectTasks(tasks,{view:'today',anchor:'2026-09-22'})
  const week=projectTasks(tasks,{view:'week',anchor:'2026-09-22'})
  const month=projectTasks(tasks,{view:'month',anchor:'2026-09-22'})
  assert.equal(today.find((item)=>item.id==='one'),tasks[0])
  assert.equal(week.find((item)=>item.id==='one'),tasks[0])
  assert.equal(month.find((item)=>item.id==='one'),tasks[0])
  assert.equal(new Set([...today,...week,...month].filter((item)=>item.id==='one').map((item)=>item.id)).size,1)
})

test('reagendamento altera a projeção sem criar outro registro',()=>{
  const changed=tasks.map((item)=>item.id==='later'?{...item,due_date:'2026-10-02'}:item)
  assert.equal(changed.length,tasks.length)
  assert.equal(projectTasks(changed,{view:'week',anchor:'2026-09-22'}).some((item)=>item.id==='later'),false)
  assert.equal(projectTasks(changed,{view:'month',anchor:'2026-10-02'}).some((item)=>item.id==='later'),true)
})

test('timezone, atrasadas, concluídas, backlog e calendários são determinísticos',()=>{
  assert.equal(isoInSaoPaulo(new Date('2026-09-22T01:30:00Z')),'2026-09-21')
  assert.deepEqual(weekDays('2026-09-22'),['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26','2026-09-27'])
  assert.equal(monthGrid('2026-09-22').length,35)
  assert.deepEqual(projectTasks(tasks,{view:'backlog'}).map((item)=>item.id),['backlog'])
  const day=projectTasks(tasks,{view:'today',anchor:'2026-09-22'})
  assert.ok(day.some((item)=>item.id==='late'));assert.ok(day.some((item)=>item.id==='done'))
})

test('parser separa atividade, decisão, tempo e financeiro de tarefa',()=>{
  assert.equal(parseInternalCommand('Comecei o site da Origami.').intent,'ACTIVITY_START')
  assert.equal(parseInternalCommand('Terminei os ajustes da Roove.').intent,'ACTIVITY_COMPLETE')
  assert.equal(parseInternalCommand('Origami aprovou a home.').intent,'RECORD_DECISION')
  assert.equal(parseInternalCommand('Trabalhei 9 horas hoje.').intent,'RECORD_TIME')
  const expense=parseInternalCommand('Gastei 106 reais em tráfego.')
  assert.equal(expense.intent,'FINANCIAL_EXPENSE_REQUEST');assert.equal(expense.amount,106)
  assert.equal(parseInternalCommand('sim').intent,'CONFIRM_FINANCIAL')
})

test('log, confirmação financeira, idempotência, RLS e tenant estão no backend',()=>{
  const migration=fs.readFileSync('supabase/migrations/202609220002_native_operations_hub.sql','utf8')
  for(const contract of ['operational_events','financial_command_confirmations','can_operate()','can_access_finance()','current_organization_id()','client_operational_access','unique(organization_id,idempotency_key)','enabled=true'])assert.ok(migration.includes(contract),contract)
  assert.match(migration,/enable row level security/g)
  assert.match(migration,/crm_tasks_delete[\s\S]+admin','manager/)
  const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
  assert.match(worker,/status:'confirmation_required'/)
  assert.match(worker,/whatsapp-expense-/)
  assert.match(worker,/idempotency_key:`command:/)
  assert.match(worker,/expense_installments'\)\.upsert/)
})

test('interfaces nativas não dependem de Trello ou Notion',()=>{
  const page=fs.readFileSync('src/components/OperationsHubPage.jsx','utf8')
  for(const contract of ['week-board','month-grid','backlog-list','operational-history','listTasks()'])assert.ok(page.includes(contract),contract)
  assert.doesNotMatch(page,/Trello|Notion/)
})
