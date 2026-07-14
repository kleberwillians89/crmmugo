import assert from 'node:assert/strict'
import { calculateAllocationIntegrity, calculateFinancialSummary } from '../src/lib/financialMetrics.js'
import { errorPresentation } from '../src/lib/userError.js'

const today='2026-07-14'
const contract=(id,values={})=>({id,status:'active',setup_value:0,setup_received_amount:0,monthly_value:0,minimum_term_months:1,...values})
const row=(id,contractId,values={})=>({id,contract_id:contractId,installment_type:'monthly',amount:1000,received_amount:0,status:'pending',due_date:'2026-07-14',...values})
const summary=(contracts,installments)=>calculateFinancialSummary(contracts,installments,{today})

// 1. Setup legado sem parcelas: fallback explícito, sem recebimento fictício.
let result=summary([contract('legacy-setup',{setup_value:1000,setup_received_amount:250})],[])
assert.deepEqual([result.setupContracted,result.setupReceived,result.setupPending],[1000,250,750])
assert.deepEqual(result.legacySetupContracts,['legacy-setup'])

// 2 e 14. Parcela de setup substitui integralmente os dois campos legados.
result=summary([contract('real-setup',{setup_value:9999,setup_received_amount:8888})],[row('setup','real-setup',{installment_type:'setup',amount:1200,received_amount:400,status:'partial'})])
assert.deepEqual([result.setupContracted,result.setupReceived,result.setupPending],[1200,400,800])
assert.equal(result.legacySetupCount,0)

// 3 e 15. Mensalidades reais substituem a projeção do contrato.
result=summary([contract('real-monthly',{monthly_value:9000,minimum_term_months:12})],[row('m1','real-monthly'),row('m2','real-monthly',{due_date:'2026-08-14'})])
assert.deepEqual([result.monthlyExpected,result.monthlyEstimated,result.monthlyPending],[2000,0,2000])

// 4 e 11. Cancelamento zera previsto/saldo, mas preserva recebimento confirmado.
result=summary([contract('cancelled-row')],[row('cancelled','cancelled-row',{amount:1000,received_amount:300,status:'cancelled',due_date:'2026-07-01'})])
assert.deepEqual([result.monthlyExpected,result.monthlyReceived,result.monthlyPending,result.monthlyOverdue,result.monthlyFuture],[0,300,0,0,0])

// 5. Parcela paga entra em previsto e recebido, sem saldo.
result=summary([contract('paid')],[row('paid','paid',{amount:1000,received_amount:1000,status:'paid',due_date:'2026-07-01'})])
assert.deepEqual([result.monthlyExpected,result.monthlyReceived,result.monthlyPending],[1000,1000,0])

// 6. Parcela parcialmente paga usa somente o saldo restante.
result=summary([contract('partial')],[row('partial','partial',{amount:1000,received_amount:350,status:'partially_paid'})])
assert.deepEqual([result.monthlyReceived,result.monthlyPending,result.monthlyFuture],[350,650,650])

// 7. Vencido: não cancelado, saldo positivo e vencimento anterior a hoje.
result=summary([contract('overdue')],[row('overdue','overdue',{amount:800,received_amount:100,status:'overdue',due_date:'2026-07-13'})])
assert.deepEqual([result.monthlyPending,result.monthlyOverdue,result.monthlyFuture],[700,700,0])

// 8. Futuro inclui hoje e datas posteriores.
result=summary([contract('future')],[row('future','future',{amount:800,status:'open',due_date:'2026-07-14'})])
assert.deepEqual([result.monthlyPending,result.monthlyOverdue,result.monthlyFuture],[800,0,800])

// 9. Parcelas e campos legados simultâneos nunca são somados.
result=summary([contract('mixed',{setup_value:5000,setup_received_amount:5000,monthly_value:7000,minimum_term_months:6})],[row('s','mixed',{installment_type:'setup',amount:1000,received_amount:1000,status:'paid'}),row('m','mixed',{amount:2000,status:'pending'})])
assert.deepEqual([result.setupContracted,result.setupReceived,result.monthlyExpected,result.monthlyEstimated,result.totalExpected],[1000,1000,2000,0,3000])

// 10. Sem parcelas: mensalidade é projeção estimada e não vira saldo a receber.
result=summary([contract('estimated',{monthly_value:900,minimum_term_months:3})],[])
assert.deepEqual([result.monthlyExpected,result.monthlyEstimated,result.monthlyPending,result.totalExpected],[0,2700,0,2700])
assert.equal(result.hasEstimatedMonthlyRevenue,true)

// 12 e 13. Rateio deve fechar no centavo e expor diferença quando não fecha.
let allocations=calculateAllocationIntegrity([{id:'ok',amount:100,invoice_installment_allocations:[{amount:33.33},{amount:33.33},{amount:33.34}]}])
assert.deepEqual(allocations[0],{installmentId:'ok',amount:100,allocated:100,difference:0,valid:true})
allocations=calculateAllocationIntegrity([{id:'cent',amount:100,invoice_installment_allocations:[{amount:33.33},{amount:33.33},{amount:33.33}]}])
assert.deepEqual(allocations[0],{installmentId:'cent',amount:100,allocated:99.99,difference:0.01,valid:false})

// Resultado agregado: previsto, recebido, saldo, vencido, futuro, setup, mensalidade e total.
result=summary([contract('aggregate',{setup_value:500,setup_received_amount:100})],[row('past','aggregate',{amount:1000,received_amount:200,status:'partial',due_date:'2026-07-01'}),row('next','aggregate',{amount:1000,status:'pending',due_date:'2026-08-01'})])
assert.deepEqual({setup:result.setupContracted,monthly:result.monthlyExpected,expected:result.totalExpected,received:result.totalReceived,open:result.totalOpen,overdue:result.totalOverdue,future:result.totalFuture},{setup:500,monthly:2000,expected:2500,received:300,open:2200,overdue:800,future:1000})

// Erro técnico preserva evidências exigidas, inclusive constraint e recordId.
const error={code:'23505',message:'duplicate key value violates unique constraint "invoice_unique"',details:'Key already exists',hint:'Review the payload',status:409}
const presented=errorPresentation(error,'Falha.',{operation:'create',entity:'invoice_installment',recordId:'row-1'})
assert.deepEqual({code:presented.technical.code,status:presented.technical.status,constraint:presented.technical.constraint,operation:presented.technical.operation,entity:presented.technical.entity,recordId:presented.technical.recordId},{code:'23505',status:409,constraint:'invoice_unique',operation:'create',entity:'invoice_installment',recordId:'row-1'})

console.log('Financial source of truth passed: 15 scenarios, status math, legacy fallbacks, partial payments, cancelled history, allocation cents and error evidence.')
