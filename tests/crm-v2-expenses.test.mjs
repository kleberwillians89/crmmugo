import assert from 'node:assert/strict'
import { businessShare, mergeCashFlow, summarizeExpenses } from '../src/lib/expenseMetrics.js'

assert.equal(businessShare({scope:'business',amount:100,business_percentage:15}),100)
assert.equal(businessShare({scope:'personal',amount:100,business_percentage:100}),0)
assert.equal(businessShare({scope:'pending_review',amount:100,business_percentage:100}),0)
assert.equal(businessShare({scope:'shared',amount:199.9,business_percentage:35}),69.97)
assert.equal(businessShare({scope:'shared',amount:100,business_percentage:101}),0)
assert.equal(businessShare({scope:'business',amount:-100,business_percentage:100}),0)
assert.equal(businessShare({scope:'business',amount:'not-a-number',business_percentage:100}),0)

const summary=summarizeExpenses([
  {amount:100,business_amount:100,paid_amount:100,status:'paid',expenses:{scope:'business'}},
  {amount:200,business_amount:0,paid_amount:0,status:'pending',expenses:{scope:'personal'}},
  {amount:300,business_amount:150,paid_amount:0,status:'pending',expenses:{scope:'shared'}},
  {amount:999,business_amount:999,paid_amount:0,status:'pending',expenses:{scope:'pending_review'}},
])
assert.deepEqual(summary,{total:1599,business:250,paid:100,open:150})

const flow=mergeCashFlow([{id:'r',due_date:'2026-08-10',amount:500,received_amount:0,status:'pending',clients:{company_name:'Cliente'}}],[{id:'p',due_date:'2026-08-11',amount:100,business_amount:50,paid_amount:0,status:'pending',expenses:{name:'Conta',scope:'shared'}}])
assert.deepEqual(flow.map(item=>item.balance),[500,450])
console.log('CRM V2 expense metrics: ok')
