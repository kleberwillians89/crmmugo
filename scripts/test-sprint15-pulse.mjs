import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {generatePulseAlerts,pulseSummary} from '../src/services/pulse/pulseEngine.js'
const now=new Date('2026-07-14T12:00:00'),clients=[{id:'cl1',company_name:'Cliente X'},{id:'cl2',company_name:'Cliente X'}],team=[{id:'julia',name:'Julia'},{id:'danilo',name:'Danilo'}]
const contracts=[{id:'c1',client_id:'cl1',status:'active',signed:true,monthly_value:3500,setup_value:2000,setup_received_amount:0,end_date:'2026-08-10',responsible_id:null,contract_services:[{id:'s1',service_name:'Social Media',monthly_value:3500,delivery_responsible_id:'julia'}]}]
const installments=[{id:'i1',contract_id:'c1',client_id:'cl1',amount:3500,received_amount:0,due_date:'2026-06-12',status:'overdue',reference_month:'2026-06-01'}]
const proposals=[{id:'p1',client_id:'cl1',title:'Proposta parada',status:'sent',sent_at:'2026-06-01',responsible_id:null}]
const alerts=generatePulseAlerts({clients,contracts,installments,proposals,teamMembers:team},now)
assert.equal(new Set(alerts.map((a)=>a.fingerprint)).size,alerts.length,'duplicate fingerprints must be collapsed')
assert.equal(alerts[0].priority,'critical','critical risks must lead prioritization')
for(const rule of ['overdue-installment','setup-not-received','contract-without-owner','stalled-proposal','proposal-without-owner','possible-duplicate','member-without-tasks'])assert.ok(alerts.some((a)=>a.rule===rule),`missing ${rule}`)
assert.ok(alerts.every((alert)=>!('responsibleId' in alert)),'legacy responsibleId must not be sent')
assert.equal(alerts.find((alert)=>alert.rule==='setup-not-received').assignedTeamMemberId,null,'assignee contract must use team member ids')
const lifecycle=[{priority:'critical',category:'Financeiro',status:'open',score:100},{priority:'high',category:'Contratos',status:'resolved',score:80},{priority:'medium',category:'Comercial',status:'ignored',score:50},{priority:'informational',category:'Equipe',status:'snoozed',snoozed_until:'2099-01-01',score:10}]
assert.deepEqual(pulseSummary(lifecycle).counts,{critical:1,high:0,medium:0,low:0,informational:0},'resolved, ignored and future snoozed alerts must not count')
const migration=readFileSync(new URL('../supabase/migrations/202607140007_sprint15_mugo_pulse.sql',import.meta.url),'utf8')
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
for(const action of ['resolve','ignore','snooze','assign','create_task','note','reopen'])assert.match(migration,new RegExp(`action_name='${action}'`))
assert.match(migration,/unique\(organization_id,fingerprint\)/)
assert.match(migration,/occurrences=occurrences\+1/)
assert.match(migration,/status='resolved'/)
for(const contract of [/execution_id uuid/,/execution_scope text/,/condition_cleared_at/,/auto_resolved_at/,/resolution_source/,/last_detection_run_id/,/recurrence_count/,/event_type[^;]*'condition_cleared'/s,/event_type[^;]*'recurred'/s,/role_name not in\('admin','manager'\)/,/organization_id=org and active/,/on delete restrict/,/idempotency_key/,/interval '90 days'/,/revoke insert,update,delete,truncate/])assert.match(migration,contract)
assert.doesNotMatch(migration,/status='resolved' then 'open'/,'manual resolution alone must not trigger reopening')
assert.match(app,/const canSynchronize=\['admin','manager'\]\.includes\(profile\?\.role\)/,'only admin and manager may synchronize automatically')
assert.match(app,/if\(canSynchronize\)await syncPulseAlerts/,'sync RPC must be guarded by the profile permission')
assert.match(app,/const persisted=await listPulseAlerts/,'all authorized readers must load persisted alerts')
assert.match(app,/const timer=canSynchronize\?setInterval\(monitor,300000\):null/,'unauthorized profiles must not start the five-minute timer')
assert.match(app,/if\(timer\)clearInterval\(timer\)/,'authorized monitor timer must be cleaned up')
console.log('Sprint 15 Pulse passed: lifecycle, permissions, immutable audit and frontend monitor authorization without unauthorized retries.')
