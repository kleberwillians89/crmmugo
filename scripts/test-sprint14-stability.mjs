import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {calculateFinancialSummary} from '../src/lib/financialMetrics.js'
import {effectiveInstallmentStatus,installmentBalance} from '../src/lib/contractBilling.js'
import {errorPresentation} from '../src/lib/userError.js'

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const contracts=[{id:'c1',status:'active',setup_value:4000,setup_received_amount:4000},{id:'c2',status:'active',setup_value:1000,setup_received_amount:250}]
const installments=[
  {id:'setup',contract_id:'c1',installment_type:'setup',amount:4000,received_amount:1500,status:'partial',due_date:'2026-07-01'},
  {id:'partial',contract_id:'c1',installment_type:'monthly',amount:3500,received_amount:1000,status:'partial',due_date:'2026-07-01'},
  {id:'future',contract_id:'c1',installment_type:'monthly',amount:3500,received_amount:0,status:'pending',due_date:'2099-08-01'},
  {id:'cancelled',contract_id:'c1',installment_type:'monthly',amount:3500,received_amount:0,status:'cancelled',due_date:'2026-07-01'},
]
const totals=calculateFinancialSummary(contracts,installments)
assert.equal(totals.setupContracted,5000)
assert.equal(totals.setupReceived,1750,'setup installment must replace, not add to, the legacy contract accumulator')
assert.equal(totals.setupPending,3250)
assert.equal(totals.monthlyReceived,1000,'setup receipt must not be counted as monthly')
assert.equal(totals.monthlyPending,6000,'cancelled installment must not remain open')
assert.equal(totals.totalReceived,2750)
assert.equal(totals.totalOpen,9250)
assert.equal(installmentBalance(installments[1]),2500)
assert.equal(effectiveInstallmentStatus(installments[3]),'cancelled')

const remote={code:'23505',message:'duplicate key value violates unique constraint',details:'Key already exists',hint:'Use a different reference',status:409}
const presented=errorPresentation(remote,'Falha.',{operation:'gerar',entity:'parcela',id:'abc'})
assert.equal(presented.technical.code,'23505')
assert.equal(presented.technical.status,409)
assert.equal(presented.technical.operation,'gerar')
assert.equal(presented.technical.id,'abc')
assert.equal(presented.technical.recordId,'abc')

const clientsRepository=read('src/services/data/clientsRepository.js'),finance=read('src/components/FinancePage.jsx'),proposalActions=read('src/components/ProposalActions.jsx'),paymentModal=read('src/components/InstallmentPaymentModal.jsx'),setupModal=read('src/components/SetupPaymentModal.jsx'),css=read('src/App.css'),checklist=read('docs/SPRINT14_STABILITY_CHECKLIST.md'),legacyApi=read('src/lib/api.js'),diagnosticPage=read('src/components/SupabaseDiagnosticPage.jsx'),diagnosticService=read('src/services/data/systemDiagnosticsRepository.js')
assert.match(clientsRepository,/document_number:digits/)
assert.match(clientsRepository,/billing_contact_phone:digits/)
assert.doesNotMatch(clientsRepository,/\.update\(values\)/)
assert.match(finance,/item\.installment_type==='setup'/)
assert.match(finance,/errorPresentation/)
assert.match(proposalActions,/busyId/)
assert.match(paymentModal,/saving\?'Salvando…'/)
assert.match(setupModal,/saving\?'Salvando…'/)
assert.match(css,/:focus-visible/)
assert.match(css,/safe-area-inset-bottom/)
assert.match(checklist,/Mobile 430\/390\/375/)
assert.doesNotMatch(legacyApi,/console\.warn/)
assert.match(legacyApi,/throw new Error\(`Não foi possível enviar a proposta/)
assert.doesNotMatch(diagnosticPage,/getSupabaseClient|\.rpc\(|\.from\(/)
assert.equal((diagnosticService.match(/rpc\('financial_integrity_diagnostic'\)/g)||[]).length,1)
console.log('Sprint 14 stability passed: financial source of truth, cancelled balances, error evidence, normalization, double-click guards and responsive safeguards.')
