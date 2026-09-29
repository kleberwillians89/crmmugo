import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {buildFinancialOverview} from '../src/lib/financialHub.js'
import {parseInternalCommand} from '../supabase/functions/_shared/internalCommandCore.js'

const migration=fs.readFileSync('supabase/migrations/202609250001_financial_whatsapp_pillars.sql','utf8')
const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
const mugozap=fs.readFileSync('supabase/functions/mugozap-api/index.ts','utf8')

test('sessão interna é isolada por organização, membro e telefone e expira em 30 minutos',()=>{
  for(const term of ['internal_assistant_sessions','organization_id','team_member_id','phone','active_intent','pending_action','pending_entity_type','pending_entity_id',"interval '30 minutes'",'unique(organization_id,team_member_id,phone)','force row level security'])assert.ok(migration.includes(term),term)
  assert.doesNotMatch(migration,/\bdelete\s+from\b/i)
})

test('confirmações financeiras possuem tipo e contexto persistente',()=>{
  assert.match(migration,/financial_command_confirmations[\s\S]+action_type[\s\S]+payload jsonb/)
  for(const type of ['expense','receipt','freelance_income'])assert.ok(migration.includes(`'${type}'`),type)
})

test('cobrança interna usa mugozap-api e template canônico somente após confirmação',()=>{
  assert.equal(parseInternalCommand('cobrar Roove').intent,'COLLECTION_SEND')
  assert.match(worker,/active_intent:'COLLECTION_SEND'/)
  assert.match(worker,/sendCollectionViaMugozap/)
  assert.match(worker,/operation:'start_template_conversation'/)
  assert.match(worker,/mugo_alerta_pagamento_pendente/)
  assert.match(worker,/CONFIRM_FINANCIAL[\s\S]+sendCollectionViaMugozap/)
  assert.match(mugozap,/X-Task-Command-Worker-Key/)
  assert.match(mugozap,/INTERNAL_MEMBER_NOT_AUTHORIZED/)
})

test('nova intenção não vira confirmação e cancelamento encerra só a sessão do membro',()=>{
  for(const phrase of ['cancelar','deixa','esquece'])assert.equal(parseInternalCommand(phrase).intent,'CANCEL_FINANCIAL')
  assert.match(worker,/command\.intent==='UNKNOWN'.*awaiting_selection/)
  assert.match(worker,/command\.intent!==event\.session\.active_intent.*clearAssistantSession/)
  assert.match(worker,/eq\('team_member_id',event\.team_member_id\).*eq\('phone',event\.wa_id\)/)
})

test('promessa de pagamento não marca parcela como recebida',()=>{
  assert.ok(migration.includes('collection_payment_promises'))
  assert.match(worker,/collection_kind==='promised'[\s\S]+collection_payment_promises/)
  assert.doesNotMatch(migration,/set\s+(received_amount|paid_at)\s*=/i)
})

test('visão executiva é business-only e não exibe saldo zero como confirmado',()=>{
  const page=fs.readFileSync('src/components/FinancialExecutiveOverviewPage.jsx','utf8')
  assert.match(page,/scope:'business'/)
  assert.match(page,/Saldo inicial ainda não informado\./)
  assert.match(page,/useState\('2026-10'\)/)
  for(const label of ['Receita prevista','Receita recebida','Receita pendente','Receita vencida','Despesa prevista','Despesa paga','Despesa pendente','Despesa vencida','Entradas','Saídas','Saldo atual','Saldo projetado'])assert.ok(page.includes(label),label)
})

test('saldo empresarial considera dívida paga como saída sem misturar freela',()=>{
  const result=buildFinancialOverview({receivables:[{id:'r',reference_month:'2026-10-01',amount:1000,received_amount:1000,status:'paid'}],payables:[{id:'e',reference_month:'2026-10-01',amount:100,paid_amount:100,status:'paid',expenses:{financial_scope:'business',area:'business'}}],debts:[{owner_scope:'business',current_balance:500,debt_payments:[{amount:200,competence:'2026-10-01'}]}],freelance:[{scope:'business',type:'income',status:'received',amount:300,competence:'2026-10-01'}],goals:[],plans:[{competence:'2026-10-01',scope:'business',opening_balance:50}],pipeline:[]},'2026-10',{scope:'business',requireOpeningBalance:true})
  assert.equal(result.cashIn,1000)
  assert.equal(result.cashOut,300)
  assert.equal(result.realBalance,750)
  assert.equal(result.freelanceBalance,300)
})

test('Receitas e Cobranças são áreas financeiras próprias',()=>{
  const revenue=fs.readFileSync('src/components/FinancialRevenuePage.jsx','utf8'),collections=fs.readFileSync('src/components/FinancialCollectionsPage.jsx','utf8'),layout=fs.readFileSync('src/components/FinancialPageLayout.jsx','utf8')
  for(const term of ['Registrar recebimento','Cobrar no WhatsApp','Ver cliente','Ver contrato','Ver histórico','mugo_alerta_pagamento_pendente'])assert.ok(revenue.includes(term),term)
  for(const term of ['Vencidas','Vencem hoje','Próximos 7 dias','Cobrança enviada','Aguardando promessa','Promessa vencida'])assert.ok(collections.includes(term),term)
  assert.match(layout,/\["collections", "Cobranças"\]/)
})
