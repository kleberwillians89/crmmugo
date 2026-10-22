import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {processTaskReminder,reminderEligibility,reminderFailure,reminderRecipient,templateApproved,reminderPayload} from '../supabase/functions/_shared/taskReminderCore.js'
import {attachTaskReminderStates,taskReminderLabel} from '../src/lib/taskReminder.js'

const now=new Date('2026-10-02T16:00:00Z')
const task={id:'task',organization_id:'org',title:'Reunião de projeto',status:'pending',assigned_to:'member',due_date:'2026-10-02',due_time:'14:00:00',archived_at:null,reminder_enabled:true}
const row={id:'reminder',organization_id:'org',task_id:'task',team_member_id:'member',due_at:'2026-10-02T17:00:00Z',scheduled_for:now.toISOString(),attempts:1,claim_token:'claim'}
const member={id:'member',organization_id:'org',name:'Pessoa Responsável',active:true,phone:'11999999999'}
const template={name:'mugo_lembrete_tarefa',language:'pt_BR',status:'APPROVED',is_active:true,category:'UTILITY'}

function scenario({taskPatch={},memberPatch={},templatePatch={},reminderPatch={},replyStatus=200,network=false,authorize=true,storageFail=false}={}){
  const changes=[],calls=[]
  let failure=storageFail
  const store={task:async()=>({...task,...taskPatch}),connection:async()=>({phone_number_id:'123',waba_id:'waba'}),template:async()=>({...template,...templatePatch}),authorize:async()=>authorize?{task:{...task,...taskPatch},member:{...member,...memberPatch}}:null,
    finish:async(_row,patch)=>{if(failure&&patch.status==='sent'){failure=false;throw new Error('database unreachable')}changes.push(patch)}}
  const run=()=>processTaskReminder({store,row:{...row,...reminderPatch},token:'not-real',now:()=>now,fetcher:async(url,init)=>{calls.push({url,payload:JSON.parse(init.body)});if(network)throw new DOMException('timeout','TimeoutError');return{ok:replyStatus===200,status:replyStatus,json:async()=>({messages:[{id:'wamid.real-response-fixture'}]})}}})
  return{run,changes,calls}
}

test('60 minutes: eligible; 2 hours: not yet due; 30 minutes: expired first dispatch',()=>{
  assert.equal(reminderEligibility(task,row,now),null)
  assert.equal(reminderEligibility({...task,due_time:'15:00:00'},{...row,due_at:'2026-10-02T18:00:00Z',scheduled_for:'2026-10-02T17:00:00Z'},now),'NOT_DUE')
  assert.equal(reminderEligibility(task,row,new Date('2026-10-02T16:30:00Z')),'REMINDER_EXPIRED')
})
for(const [label,patch,code] of [['completed',{status:'completed'},'TASK_COMPLETED'],['cancelled',{status:'cancelled'},'TASK_CANCELLED'],['archived',{archived_at:now.toISOString()},'TASK_ARCHIVED'],['no assignee',{assigned_to:null},'REMINDER_DISABLED'],['no time',{due_time:null},'REMINDER_DISABLED'],['disabled',{reminder_enabled:false},'REMINDER_DISABLED'],['tenant mismatch',{organization_id:'other'},'TASK_NOT_FOUND'],['reschedule',{due_time:'15:00:00'},'REMINDER_CHANGED'],['reassigned',{assigned_to:'another'},'ASSIGNEE_CHANGED']]){
  test(`${label}: no send`,async()=>{const s=scenario({taskPatch:patch});await s.run();assert.equal(s.calls.length,0);assert.equal(s.changes[0].error_code,code)})
}
test('phone missing / invalid / inactive / wrong tenant is blocked',async()=>{
  for(const [patch,code] of [[{phone:null},'TEAM_MEMBER_PHONE_MISSING'],[{phone:'123'},'INVALID_PHONE'],[{active:false},'TEAM_MEMBER_INACTIVE'],[{organization_id:'other'},'TEAM_MEMBER_INACTIVE']]){
    const s=scenario({memberPatch:patch});await s.run();assert.equal(s.calls.length,0);assert.equal(s.changes[0].status,'blocked');assert.equal(s.changes[0].error_code,code)
  }
})
test('template must be approved, active, utility and canonical name/language',async()=>{
  for(const patch of [{status:'PENDING'},{is_active:false},{is_active:null},{category:'MARKETING'},{name:'other'},{language:'en_US'}]){
    assert.equal(templateApproved({...template,...patch}),false)
    const s=scenario({templatePatch:patch});await s.run();assert.equal(s.calls.length,0);assert.equal(s.changes[0].error_code,'TEMPLATE_NOT_APPROVED')
  }
})
test('successful Meta acceptance persists provider id; immutable template parameters',async()=>{
  const s=scenario();assert.equal(await s.run(),'sent');assert.equal(s.changes[0].provider_message_id,'wamid.real-response-fixture');assert.equal(s.changes[0].sent_at,now.toISOString())
  assert.deepEqual(s.calls[0].payload.template.components[0].parameters.map(item=>item.text),['Pessoa','Reunião de projeto','14:00'])
  assert.equal(s.calls[0].payload.to,'5511999999999')
})
for(const status of [429,500,502,503])test(`Meta ${status}: bounded retry`,async()=>{
  const s=scenario({replyStatus:status});await s.run();assert.equal(s.changes[0].status,'failed');assert.equal(s.changes[0].next_attempt_at,'2026-10-02T16:02:00.000Z');assert.equal(s.changes[0].dispatch_started_at,null)
})
test('timeout before dispatch is retryable; timeout after dispatch is unknown and never resent automatically',async()=>{
  assert.equal(reminderFailure(row,'TIMEOUT',now).next_attempt_at,'2026-10-02T16:02:00.000Z')
  const s=scenario({network:true});await s.run();assert.equal(s.calls.length,1);assert.equal(s.changes[0].error_code,'PROVIDER_RESULT_UNKNOWN');assert.equal(s.changes[0].status,'blocked');assert.equal(s.changes[0].next_attempt_at,null)
})
test('provider acceptance followed by persistence failure also stays unknown',async()=>{
  const s=scenario({storageFail:true});await s.run();assert.equal(s.calls.length,1);assert.equal(s.changes[0].error_code,'PROVIDER_RESULT_UNKNOWN')
})
test('terminal errors and six attempts never retry forever',async()=>{
  for(const status of [400,401,403,404]){const s=scenario({replyStatus:status});await s.run();assert.equal(s.changes[0].next_attempt_at,null)}
  assert.equal(reminderFailure({...row,attempts:6},'500',now).next_attempt_at,null)
  assert.equal(reminderFailure(row,'500',new Date(row.due_at)).status,'cancelled')
})
test('retry schedule 2/5/10/20/30 then terminal; stops before due_at',()=>{
  for(let attempts=1;attempts<=6;attempts++){
    const result=reminderFailure({...row,attempts,due_at:'2026-10-03T17:00:00Z'},'429',now)
    assert.equal(result.next_attempt_at,attempts===6?null:new Date(now.getTime()+[2,5,10,20,30][attempts-1]*60000).toISOString())
  }
  assert.equal(reminderFailure({...row,due_at:'2026-10-02T16:01:00Z'},'500',now).next_attempt_at,null)
})
test('lost claim from concurrent/reassigned worker never dispatches',async()=>{
  const s=scenario({authorize:false});await s.run();assert.equal(s.calls.length,0)
})
test('reminder expired after task starts; timezone rendering uses America/Sao_Paulo',()=>{
  assert.equal(reminderEligibility(task,{...row,attempts:2},new Date(row.due_at)),'REMINDER_EXPIRED')
  assert.equal(reminderPayload(task,member,reminderRecipient(member,'org').phone).template.components[0].parameters[2].text,'14:00')
})
test('UI labels respect toggle, completed and current assignee/date snapshots',()=>{
  const items=attachTaskReminderStates([task],[{...row,status:'sent'}]);assert.equal(taskReminderLabel(items[0]),'Lembrete enviado')
  assert.equal(taskReminderLabel({...task,reminder_status:'blocked'}),'Lembrete pendente')
  assert.equal(taskReminderLabel(task),'🔔 WhatsApp 1h antes')
  assert.equal(taskReminderLabel({...task,reminder_enabled:false}),null)
  assert.equal(taskReminderLabel({...task,due_time:null}),null)
  assert.equal(attachTaskReminderStates([{...task,assigned_to:'new'}],[{...row,status:'sent'}])[0].reminder_status,null)
})
test('worker auth, manual filter, cron scope and local imports are valid',()=>{
  const worker=fs.readFileSync('supabase/functions/task-reminder-worker/index.ts','utf8')
  assert.match(worker,/TASK_REMINDER_WORKER_KEY/);assert.match(worker,/X-Task-Reminder-Worker-Key/);assert.match(worker,/p_reminder_id:body.reminder_id\|\|null/)
  for(const match of worker.matchAll(/from '([^']+)'/g))if(match[1].startsWith('.'))assert.ok(fs.existsSync(path.resolve('supabase/functions/task-reminder-worker',match[1])))
  const cron=fs.readFileSync('scripts/go-live/2026-09-30-activate-task-reminder-cron.sql','utf8')
  assert.match(cron,/'\*\/5 \* \* \* \*'/);assert.doesNotMatch(cron,/collection-notification-worker|team-daily-brief-worker/)
  const sql=fs.readFileSync('supabase/migrations/202609300001_task_reminders.sql','utf8')
  assert.match(sql,/for update skip locked limit 50/i);assert.match(sql,/at time zone 'America\/Sao_Paulo'/);assert.match(sql,/idempotency_key text not null unique/)
  assert.match(sql,/enable row level security/);assert.match(sql,/grant execute on function public.claim_task_reminders\(uuid\) to service_role/)
})
