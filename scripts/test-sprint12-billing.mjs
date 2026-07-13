import assert from 'node:assert/strict'
import {buildInstallmentSchedule,contractFinancialStatus} from '../src/lib/contractBilling.js'
import {calculateFinancialSummary} from '../src/lib/financialMetrics.js'
const contract={id:'amalie',status:'active',signed:true,monthly_value:4000,start_date:'2026-07-04',end_date:'2026-10-04',minimum_term_months:3,billing_day:4,setup_value:0,setup_received_amount:0}
const installments=buildInstallmentSchedule(contract)
assert.equal(installments.length,3)
assert.deepEqual(installments.map((item)=>item.amount),[4000,4000,4000])
assert.equal(contractFinancialStatus({...contract,invoice_installments:installments},new Date('2026-07-01')).balance,12000)
const paid=[{...installments[0],status:'paid',received_amount:4000},installments[1],installments[2]]
const summary=calculateFinancialSummary([contract],paid)
assert.equal(summary.monthlyReceived,4000)
assert.equal(summary.monthlyPending,8000)
assert.equal(paid[1].received_amount,0)
