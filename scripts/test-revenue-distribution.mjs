import assert from 'node:assert/strict'
import {calculateRevenueDistribution,revenueForPeriod} from '../src/services/finance/revenueDistribution.js'

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

console.log('Revenue distribution passed: 10% single reserve, 90% available, split after reserve, cents remainder, period separation and immutable installments.')
