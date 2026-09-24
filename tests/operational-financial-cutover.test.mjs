import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {buildFinancialCalendar,buildFinancialOverview} from '../src/lib/financialHub.js'
import {isHistoricalTask,projectTasks} from '../src/lib/operationalCalendar.js'

const migration=fs.readFileSync('supabase/migrations/202609240001_operational_financial_cutover.sql','utf8')

test('corte operacional preserva tarefas antigas somente no histórico',()=>{
  const rows=[
    {id:'old',title:'Legado',due_date:'2026-09-23',status:'pending'},
    {id:'new',title:'Nova operação',due_date:'2026-09-24',status:'pending'},
    {id:'done',title:'Concluída',due_date:'2026-09-25',status:'completed'},
  ]
  assert.equal(isHistoricalTask(rows[0],'2026-09-24'),true)
  assert.deepEqual(projectTasks(rows,{view:'today',anchor:'2026-09-24',operationalStartDate:'2026-09-24'}).map((row)=>row.id),['new'])
  assert.deepEqual(projectTasks(rows,{view:'history',operationalStartDate:'2026-09-24'}).map((row)=>row.id),['old','done'])
})

test('outubro inicia sem saldo enganoso e respeita Mugô, Casa e Privado',()=>{
  const data={
    receivables:[{id:'income',reference_month:'2026-10-01',due_date:'2026-10-05',amount:1500,received_amount:0,status:'pending'}],
    payables:[
      {id:'business',reference_month:'2026-10-01',due_date:'2026-10-06',amount:100,paid_amount:50,status:'partial',expenses:{financial_scope:'business',area:'business'}},
      {id:'home',reference_month:'2026-10-01',due_date:'2026-10-07',amount:200,paid_amount:0,status:'pending',expenses:{financial_scope:'household',area:'household'}},
      {id:'private',reference_month:'2026-10-01',due_date:'2026-10-08',amount:300,paid_amount:0,status:'pending',expenses:{financial_scope:'private',area:'household'}},
    ],debts:[],freelance:[],goals:[],plans:[],pipeline:[],
  }
  const all=buildFinancialOverview(data,'2026-10',{requireOpeningBalance:true})
  const business=buildFinancialOverview(data,'2026-10',{scope:'business',requireOpeningBalance:true})
  const household=buildFinancialOverview(data,'2026-10',{scope:'household',requireOpeningBalance:true})
  assert.equal(all.realBalance,null)
  assert.equal(all.projectedBalance,null)
  assert.equal(business.forecastExpense,100)
  assert.equal(household.forecastRevenue,0)
  assert.equal(household.forecastExpense,200)
})

test('calendário financeiro projeta registros canônicos e movimentos de reserva sem duplicar',()=>{
  const events=buildFinancialCalendar({goals:[{id:'goal',name:'Reserva',scope:'business',financial_goal_movements:[{id:'move',amount:250,occurred_on:'2026-10-12',competence:'2026-10-01'}]}]},'2026-10')
  assert.deepEqual(events.map((event)=>event.id),['goal:move'])
  assert.equal(events[0].kind,'reserve')
})

test('migration define cortes, mantém histórico e atualiza vencidos de modo seguro',()=>{
  for(const term of ["date '2026-09-24'","date '2026-10-01'",'operational_start_date','financial_start_date','opening_balance','refresh_overdue_receivables','coalesce(received_amount,0)=0','paid_at is null',"closing.status='closed'"])assert.ok(migration.includes(term),term)
  assert.doesNotMatch(migration,/\bdelete\s+from\b/i)
  assert.doesNotMatch(migration,/set\s+(received_amount|paid_at|actual_brl_amount)\s*=/i)
})

test('regras recorrentes preservam valores e exigem reconciliação explícita',()=>{
  for(const term of ["billing_day=5","billing_day=25","billing_day=15","reference_month>=date '2026-10-01'",'link_ruah_to_existing_gimports','requires_admin_confirmation',"'currency','EUR'","'original_amount',100","'exchange_rate',null","c.end_date is null"])assert.ok(migration.includes(term),term)
  assert.doesNotMatch(migration,/set\s+monthly_value\s*=/i)
  assert.match(migration,/recurring:ruah[\s\S]+status='pending_mapping'/)
})

test('vínculo Ruah recalcula due_date apenas das parcelas abertas e futuras do contrato vinculado',()=>{
  const start=migration.indexOf('function public.link_ruah_to_existing_gimports')
  const end=migration.indexOf('$$;',start)
  const fn=migration.slice(start,end)
  assert.ok(fn.includes('update public.contracts set billing_day=v_billing_day'))
  assert.match(fn,/update public\.invoice_installments i\s*\n\s*set due_date=/)
  assert.ok(fn.includes('i.contract_id=p_contract_id'))
  assert.ok(fn.includes('i.organization_id=org'))
  assert.ok(fn.includes("select s.financial_start_date into v_cutover from public.organization_settings s"))
  assert.match(fn,/slug='mugo'[\s\S]*?date '2026-10-01'/)
  assert.ok(fn.includes('Data de início financeiro não configurada para esta organização.'))
  assert.ok(fn.includes('i.reference_month>=v_cutover'))
  assert.ok(fn.includes("i.status in('draft','pending','overdue')"))
  assert.ok(fn.includes('coalesce(i.received_amount,0)=0'))
  assert.ok(fn.includes('i.paid_at is null'))
  assert.match(fn,/financial_month_closings closing[\s\S]*closing\.status='closed'/)
  assert.match(fn,/least\(v_billing_day,extract\(day from\(i\.reference_month\+interval '1 month'-interval '1 day'\)\)::int\)/)
  assert.doesNotMatch(fn,/insert into public\.invoice_installments/)
  assert.doesNotMatch(fn,/delete\s+from/i)
  assert.doesNotMatch(fn,/\bcommit\b/i)
  const contractIdx=fn.indexOf('update public.contracts set billing_day=v_billing_day')
  const installmentsIdx=fn.indexOf('update public.invoice_installments i')
  const queueIdx=fn.indexOf("update public.data_reconciliation_queue\n  set status='resolved'")
  assert.ok(contractIdx>-1&&installmentsIdx>contractIdx&&queueIdx>installmentsIdx,'ordem: contrato -> parcelas -> fila, mesma transação')
})

test('vínculo Ruah permanece bloqueado por administrador, cliente ou contrato incorretos',()=>{
  const start=migration.indexOf('function public.link_ruah_to_existing_gimports')
  const end=migration.indexOf('$$;',start)
  const fn=migration.slice(start,end)
  assert.ok(fn.includes('org is null or not public.is_admin()'))
  assert.ok(fn.includes("queue_row.status<>'pending_mapping'"))
  assert.ok(fn.includes('Reconciliação pendente da Ruah não encontrada.'))
  assert.ok(fn.includes('O cliente confirmado não corresponde a GIMPORTS SPLITS.'))
  assert.ok(fn.includes("client_id=p_client_id and status='active'"))
  assert.ok(fn.includes('Contrato ativo do cliente confirmado não encontrado.'))
})

test('vínculo Ruah é estritamente idempotente: repetir com os mesmos IDs resolve sem reexecutar nada',()=>{
  const start=migration.indexOf('function public.link_ruah_to_existing_gimports')
  const end=migration.indexOf('$$;',start)
  const fn=migration.slice(start,end)
  assert.ok(fn.includes("if queue_row.status='resolved' then"))
  assert.ok(fn.includes("(queue_row.payload->>'linked_client_id')::uuid=p_client_id"))
  assert.ok(fn.includes("(queue_row.payload->>'linked_contract_id')::uuid=p_contract_id"))
  assert.ok(fn.includes('A Ruah já foi vinculada a outro cliente ou contrato.'))
  const resolvedCheckIdx=fn.indexOf("if queue_row.status='resolved' then")
  const returnIdx=fn.indexOf('return queue_row;',resolvedCheckIdx)
  const mismatchErrorIdx=fn.indexOf('A Ruah já foi vinculada a outro cliente ou contrato.',resolvedCheckIdx)
  const contractUpdateIdx=fn.indexOf('update public.contracts set billing_day=v_billing_day')
  const installmentsUpdateIdx=fn.indexOf('update public.invoice_installments i')
  const finalQueueUpdateIdx=fn.indexOf("update public.data_reconciliation_queue\n  set status='resolved'")
  assert.ok(returnIdx>-1&&returnIdx<mismatchErrorIdx,'match retorna a linha existente antes de checar mismatch')
  assert.ok(
    resolvedCheckIdx<contractUpdateIdx&&returnIdx<contractUpdateIdx&&returnIdx<installmentsUpdateIdx&&returnIdx<finalQueueUpdateIdx,
    'o caminho idempotente (match) retorna antes de qualquer UPDATE em contracts, invoice_installments ou na própria fila'
  )
  // status inesperado (nem pending_mapping nem resolved) continua bloqueado pela guarda original
  assert.ok(fn.includes("if queue_row.status<>'pending_mapping' then"))
})

test('cleanup sem tenant falha explicitamente nas duas funções',()=>{
  assert.equal((migration.match(/Nenhuma organização ativa encontrada\. Dry run cancelado\./g)||[]).length,2)
})

test('interfaces abrem outubro, mostram histórico e protegem ações administrativas',()=>{
  const overview=fs.readFileSync('src/components/FinancialHubPages.jsx','utf8')
  const calendar=fs.readFileSync('src/components/FinancialCalendarPage.jsx','utf8')
  const reconciliation=fs.readFileSync('src/components/FinancialReconciliationPage.jsx','utf8')
  assert.match(overview,/FIRST_FINANCIAL_PERIOD='2026-10'/)
  assert.match(overview,/Saldo inicial ainda não informado/)
  assert.match(calendar,/FIRST_FINANCIAL_DATE='2026-10-01'/)
  assert.match(calendar,/canViewPrivateFinance/)
  assert.match(reconciliation,/isAdmin&&ruah\.status==='pending_mapping'/)
  assert.match(reconciliation,/Vincular Ruah ao cliente existente GIMPORTS SPLITS/)
})
