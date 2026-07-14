import assert from 'node:assert/strict'
import {buildCausalAnalysis} from '../src/services/intelligence/causalAnalysisEngine.js'
const now=new Date('2026-07-14T12:00:00')
const clients=[{id:'cl1',company_name:'Cliente X'},{id:'cl2',company_name:'Cliente Y'}]
const contracts=[
  {id:'c1',client_id:'cl1',status:'active',signed:true,monthly_value:3500,setup_value:2000,setup_received_amount:0,end_date:'2026-08-10',contract_number:'Y',contract_services:[{service_name:'Social Media',monthly_value:3500,service_status:'active',deliveryResponsible:{name:'Julia'}}]},
  {id:'c2',client_id:'cl2',status:'active',signed:true,monthly_value:6500,end_date:'2027-08-10',contract_services:[{service_name:'Automação',monthly_value:6500,service_status:'active',deliveryResponsible:{name:'Julia'}}]},
]
const installments=[{id:'i1',contract_id:'c1',client_id:'cl1',amount:3500,received_amount:0,due_date:'2026-06-12',status:'overdue',installment_type:'monthly'}]
const proposals=[{id:'p1',title:'Automação Cliente Z',main_service:'Automação',status:'sent',sent_at:'2026-06-01'}]
const findings=buildCausalAnalysis({clients,contracts,installments,proposals},now)
assert.match(findings.find((item)=>item.id==='revenue-drop').statement,/35\.0%/)
assert.match(findings.find((item)=>item.id==='service-share').statement,/Automação representa 65\.0%/)
assert.match(findings.find((item)=>item.id==='workload-julia').statement,/2 entrega/)
assert.match(findings.find((item)=>item.id==='clients-without-billing').statement,/1 cliente/)
assert.match(findings.find((item)=>item.id==='overdue-cl1').statement,/32 dia/)
assert.match(findings.find((item)=>item.id==='setup-c1').statement,/nunca foi recebido/)
assert.match(findings.find((item)=>item.id==='automation-conversion').statement,/mais de 20 dias/)
console.log('Mugô Intelligence causal analysis passed: revenue drop, service mix, team workload, missing billing, delinquency, setup and stalled automation proposals.')
