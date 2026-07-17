import assert from 'node:assert/strict'
import {calculateCategorizedRevenue,calculateRevenueDistribution,classifyInstallmentRevenue,revenueForPeriod} from '../src/services/finance/revenueDistribution.js'
import {readFileSync} from 'node:fs'

let result=calculateRevenueDistribution(1000)
assert.deepEqual(result,{grossCents:100000,reservePercentage:10,reserveCents:10000,availableCents:90000,members:3,perPersonCents:30000,remainderCents:0})
result=calculateRevenueDistribution(30000)
assert.deepEqual([result.reserveCents,result.availableCents,result.perPersonCents,result.remainderCents],[300000,2700000,900000,0])
result=calculateRevenueDistribution(1000.01)
assert.deepEqual([result.reserveCents,result.availableCents,result.perPersonCents,result.remainderCents],[10000,90001,30000,1])
assert.deepEqual(calculateRevenueDistribution(0),{grossCents:0,reservePercentage:10,reserveCents:0,availableCents:0,members:3,perPersonCents:0,remainderCents:0})
assert.throws(()=>calculateRevenueDistribution(-1),/não negativo/)

const original={id:'one',amount:3000,received_amount:1200,status:'partial',reference_month:'2026-07',manual_confirmation_at:'2026-07-10T12:00:00Z'}
const rows=[original,{id:'two',amount:500,received_amount:500,status:'paid',reference_month:'2026-08',paid_at:'2026-07-11T12:00:00Z'},{id:'cancelled',amount:900,status:'cancelled',reference_month:'2026-07'}]
assert.equal(revenueForPeriod(rows,'2026-07','forecast'),3000)
assert.equal(revenueForPeriod(rows,'2026-07','realized'),1700)
assert.deepEqual(original,{id:'one',amount:3000,received_amount:1200,status:'partial',reference_month:'2026-07',manual_confirmation_at:'2026-07-10T12:00:00Z'})
assert.equal(calculateRevenueDistribution(3000).reserveCents,30000)

assert.deepEqual(classifyInstallmentRevenue({installment_type:'monthly'}),{category:'recurring',source:'installment_type:monthly',confidence:'exact',type:'monthly'})
assert.deepEqual(classifyInstallmentRevenue({installment_type:'setup'}),{category:'setup',source:'installment_type:setup',confidence:'exact',type:'setup'})
assert.deepEqual(classifyInstallmentRevenue({installment_type:'project'}),{category:'setup',source:'installment_type:project',confidence:'exact',type:'project'})
assert.equal(classifyInstallmentRevenue({installment_type:'unknown'}).category,'other')
const categorized=calculateCategorizedRevenue([{amount:1000,status:'pending',reference_month:'2026-07',installment_type:'monthly',client_id:'a'},{amount:500,status:'pending',reference_month:'2026-07',installment_type:'setup',client_id:'b'},{amount:250,status:'pending',reference_month:'2026-07',installment_type:'other',client_id:'c'}],'2026-07','forecast')
assert.equal(categorized.total.grossCents,175000)
assert.equal(categorized.total.reserveCents,Object.values(categorized.categories).reduce((sum,item)=>sum+item.distribution.reserveCents,0))
assert.equal(categorized.total.availableCents,Object.values(categorized.categories).reduce((sum,item)=>sum+item.distribution.availableCents,0))
assert.equal(Object.values(categorized.categories).reduce((sum,item)=>sum+item.distribution.grossCents,0),categorized.total.grossCents)
const rounded=calculateCategorizedRevenue([{amount:.05,status:'pending',reference_month:'2026-07',installment_type:'monthly'},{amount:.05,status:'pending',reference_month:'2026-07',installment_type:'setup'}],'2026-07','forecast')
assert.equal(rounded.total.reserveCents,Object.values(rounded.categories).reduce((sum,item)=>sum+item.distribution.reserveCents,0))

const form=readFileSync(new URL('../src/components/InstallmentFormModal.jsx',import.meta.url),'utf8'),css=readFileSync(new URL('../src/App.css',import.meta.url),'utf8')
assert.match(form,/Tipo de receita/)
assert.match(form,/required=\{form\.installment_type==='monthly'\}/)
assert.match(form,/onSubmit=\{submit\}/)
assert.match(form,/Projeto pontual/)
assert.match(css,/@media\(max-width:720px\).*installment-list-row/s)

console.log('Revenue distribution passed: categorized monthly/setup/project/other totals, 10% reserve, period separation, form validation, responsiveness and immutable installments.')
