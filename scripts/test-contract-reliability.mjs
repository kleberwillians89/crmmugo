import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {assertContractId,buildContractPayload,contractToForm,CONTRACT_DB_FIELDS} from '../src/services/data/contractPayload.js'

const id='84b528f7-ad4f-44b2-98f2-15de6a84a960'
const member='11111111-1111-4111-8111-111111111111'
const source={id,client_id:member,responsible_id:member,contract_number:'10',status:'active',signed:true,signed_at:'2026-07-04T12:00:00Z',start_date:'2026-07-04',end_date:'2026-10-04',minimum_term_months:'3',billing_day:'4',setup_value:'4000.00',monthly_value:'4000',total_value:'16000',auto_renew:false,notes:'  Revisado  ',clients:{company_name:'Amalie'},services:[],raw:{},contractNumber:'10',statusLabel:'Ativo',monthlyValue:4000,undefinedValue:undefined}
const form=contractToForm(source),payload=buildContractPayload(form)
assert.deepEqual(Object.keys(payload).sort(),CONTRACT_DB_FIELDS.filter((key)=>payload[key]!==undefined).sort())
assert.equal(payload.monthly_value,4000)
assert.equal(payload.minimum_term_months,3)
assert.equal(payload.billing_day,4)
assert.equal(payload.signed_at,'2026-07-04')
assert.equal(payload.notes,'Revisado')
assert.equal('clients'in payload,false)
assert.equal('services'in payload,false)
assert.equal('raw'in payload,false)
assert.equal('contractNumber'in payload,false)
assert.equal('statusLabel'in payload,false)
assert.equal('monthlyValue'in payload,false)
assert.deepEqual(buildContractPayload({status:'cancelled'},{partial:true}),{status:'cancelled'})
assert.deepEqual(buildContractPayload({end_date:''},{partial:true}),{end_date:null})
assert.throws(()=>buildContractPayload({client_id:'not-a-uuid'}),/UUID inválido/)
assert.throws(()=>buildContractPayload({monthly_value:'NaN'},{partial:true}),/Valor inválido/)
assert.throws(()=>buildContractPayload({billing_day:32},{partial:true}),/Valor inválido/)
assert.throws(()=>buildContractPayload({status:'unknown'},{partial:true}),/Status de contrato inválido/)
assert.equal(assertContractId(id),id)
assert.throws(()=>assertContractId('invalid'),/ID de contrato inválido/)

const component=await readFile(new URL('../src/components/SupabaseContractsPage.jsx',import.meta.url),'utf8')
assert.equal(/from\(['"]contracts['"]\)/.test(component),false,'O componente não pode acessar contracts diretamente.')
assert.match(component,/contractToForm\(selected\)/)
assert.match(component,/cancelContract\(selected\.id/)
assert.match(component,/renewContract\(selected\.id/)
assert.match(component,/disabled=\{saving\}/)

const migration=await readFile(new URL('../supabase/migrations/202607140001_sprint13_3_contract_reliability.sql',import.meta.url),'utf8')
for(const token of['cancel_contract','renew_contract','contracts_read','contracts_write','contract_reliability_diagnostic'])assert.match(migration,new RegExp(token))
console.log('Contract reliability tests passed: payload, validation, service boundary, cancellation, loading and migration coverage.')
