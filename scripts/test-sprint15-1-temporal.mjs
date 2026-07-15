import assert from 'node:assert/strict'
import {getTemporalContext,nationalHolidays,operationalRecommendation,temporalPriority} from '../src/lib/temporalIntelligence.js'
import {generatePulseAlerts} from '../src/services/pulse/pulseEngine.js'

const at=(iso)=>getTemporalContext(new Date(iso))
const scenarios=[
 ['08:00','2026-07-14T11:00:00Z',false,'manhã'],
 ['10:00','2026-07-14T13:00:00Z',true,'manhã'],
 ['13:00','2026-07-14T16:00:00Z',true,'tarde'],
 ['18:30','2026-07-14T21:30:00Z',false,'noite'],
 ['22:00','2026-07-15T01:00:00Z',false,'noite'],
]
for(const [label,iso,business,period] of scenarios){const context=at(iso);assert.equal(context.formattedTime,label);assert.equal(context.isBusinessHours,business);assert.equal(context.period,period)}
const saturday=at('2026-07-18T13:00:00Z'),sunday=at('2026-07-19T13:00:00Z')
assert.equal(saturday.isWeekend,true);assert.equal(sunday.isWeekend,true);assert.equal(saturday.isBusinessHours,false)
const holiday=at('2026-12-25T13:00:00Z');assert.equal(holiday.isHoliday,true);assert.equal(holiday.holidayName,'Natal');assert.equal(holiday.nextBusinessLabel,'28/12')
assert.equal(nationalHolidays(2026).get('2026-11-20'),'Dia Nacional de Zumbi e da Consciência Negra')
assert.equal(at('2026-07-31T13:00:00Z').isMonthEnd,true);assert.equal(at('2026-08-01T13:00:00Z').isMonthStart,true)
assert.equal(at('2026-07-14T23:46:00Z').nextBusinessLabel,'amanhã')
assert.match(operationalRecommendation(at('2026-07-14T23:46:00Z'),'cobrança'),/Agende a cobrança para amanhã/)
assert.match(operationalRecommendation(at('2026-07-14T13:15:00Z'),'cobrança'),/Realize a cobrança agora/)
assert.equal(temporalPriority(86400000).priority,'critical');assert.equal(temporalPriority(30*86400000).priority,'low')

const base={clients:[{id:'client',company_name:'Cliente'}],contracts:[{id:'contract',client_id:'client',status:'active',signed:true,end_date:'2026-07-15',contract_services:[{id:'service',service_name:'CRM',monthly_value:1,delivery_responsible_id:'owner'}]}],installments:[{id:'bill',client_id:'client',contract_id:'contract',amount:100,received_amount:0,due_date:'2026-07-13',reference_month:'2026-07-01'}],proposals:[],teamMembers:[{id:'owner',name:'Pessoa'}]}
const nightAlerts=generatePulseAlerts(base,new Date('2026-07-14T23:46:00Z')),dayAlerts=generatePulseAlerts(base,new Date('2026-07-14T13:15:00Z'))
assert.equal(nightAlerts.find((item)=>item.rule==='expiring-contract').priority,'critical')
assert.match(nightAlerts.find((item)=>item.rule==='overdue-installment').description,/Agende a cobrança/)
assert.match(dayAlerts.find((item)=>item.rule==='overdue-installment').description,/Realize a cobrança agora/)
console.log('Sprint 15.1 Temporal Intelligence passed: hours, weekends, holiday, month boundaries, temporal priority and Pulse adaptation.')
