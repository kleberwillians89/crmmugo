import assert from 'node:assert/strict'
import {execFileSync,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import fs from 'node:fs'
import test from 'node:test'

// Isolated PostgreSQL over a private Unix socket. Never reads Supabase credentials or connects remotely.
const run=promisify(execFile)
test('real PostgreSQL: triggers, timezone, RLS, retries, reassignment, atomic claim and dispatch fence',async(t)=>{
  try{execFileSync('initdb',['--version'],{stdio:'pipe'})}catch{t.skip('Local PostgreSQL binaries not installed');return}
  const dir=fs.mkdtempSync('/private/tmp/mugo-reminder-pg-')
  const args=['-X','-h',dir,'-p','55497','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
  const sql=(query)=>execFileSync('psql',args,{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
  let started=false
  try{
    execFileSync('initdb',['-D',`${dir}/data`,'-U','postgres','-A','trust','--no-locale'],{stdio:'pipe'})
    execFileSync('pg_ctl',['-D',`${dir}/data`,'-l',`${dir}/server.log`,'-o',`-F -k ${dir} -h '' -p 55497`,'-w','start'],{stdio:'pipe'})
    started=true
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.organizations(id uuid primary key);
      create table public.team_members(id uuid primary key,organization_id uuid references public.organizations(id),name text,phone text,active boolean default true);
      create table public.crm_tasks(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),title text,status text default 'pending',assigned_to uuid references public.team_members(id),due_date date,due_time time,archived_at timestamptz,task_type text);
      create function public.current_organization_id() returns uuid language sql as $$select nullif(current_setting('test.org',true),'')::uuid$$;
      create function public.is_active_user() returns boolean language sql as $$select true$$;
      insert into organizations values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
      insert into team_members(id,organization_id,name,phone) values
      ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','One','11999999999'),
      ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Two','11988888888'),
      ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Foreign','11977777777');`)
    sql(fs.readFileSync('supabase/migrations/202609300001_task_reminders.sql','utf8'))
    const org='10000000-0000-4000-8000-000000000001',owner='20000000-0000-4000-8000-000000000001',nextOwner='20000000-0000-4000-8000-000000000002'
    const task=(suffix,offset='60 minutes',extra='')=>sql(`insert into crm_tasks(id,organization_id,assigned_to,title,due_date,due_time ${extra?',status':''}) select '30000000-0000-4000-8000-${suffix}', '${org}','${owner}','Fixture', ((now()+interval '${offset}') at time zone 'America/Sao_Paulo')::date,((now()+interval '${offset}') at time zone 'America/Sao_Paulo')::time ${extra?`, '${extra}'`:''};`)
    task('000000000001')
    assert.equal(sql(`select count(*) from task_reminder_outbox`),'1')
    assert.equal(sql(`select bool_and(due_at=(t.due_date+t.due_time) at time zone 'America/Sao_Paulo' and scheduled_for=due_at-interval '60 minutes') from task_reminder_outbox r join crm_tasks t on t.id=r.task_id`),'t')
    task('000000000002','2 hours')
    assert.equal(sql(`select count(*) from task_reminder_outbox where scheduled_for>now()`),'1')
    task('000000000003','30 minutes')
    assert.equal(sql(`select error_code from task_reminder_outbox where task_id='30000000-0000-4000-8000-000000000003'`),'REMINDER_EXPIRED')
    task('000000000004','2 hours','completed');task('000000000005','2 hours','cancelled')
    assert.equal(sql(`select count(*) from task_reminder_outbox where task_id in ('30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000005')`),'0')
    sql(`insert into crm_tasks(organization_id,title,due_date,due_time) values('${org}','Unassigned',current_date,'15:00');insert into crm_tasks(organization_id,assigned_to,title,due_date) values('${org}','${owner}','No time',current_date);`)
    assert.equal(sql('select count(*) from task_reminder_outbox'),'3')
    sql(`update crm_tasks set due_time=due_time+interval '1 hour' where id='30000000-0000-4000-8000-000000000002';`)
    assert.equal(sql(`select count(*) from task_reminder_outbox where task_id='30000000-0000-4000-8000-000000000002' and status='cancelled'`),'1')
    sql(`update crm_tasks set assigned_to='${nextOwner}' where id='30000000-0000-4000-8000-000000000002';`)
    assert.equal(sql(`select team_member_id from task_reminder_outbox where task_id='30000000-0000-4000-8000-000000000002' and status='pending'`),nextOwner)
    sql(`update crm_tasks set archived_at=now() where id='30000000-0000-4000-8000-000000000002';`)
    assert.equal(sql(`select count(*) from task_reminder_outbox where task_id='30000000-0000-4000-8000-000000000002' and status='pending'`),'0')
    // Two separate sessions hold their row locks concurrently; only one can claim the eligible slot.
    const concurrent=await Promise.all([1,2].map(()=>run('psql',[...args,'-c',`begin; select id from claim_task_reminders(); select pg_sleep(0.2); commit;`],{encoding:'utf8'})))
    const ids=concurrent.flatMap(result=>result.stdout.split('\n').filter(line=>/^[a-f0-9-]{36}$/.test(line)))
    assert.equal(ids.length,1);assert.equal(new Set(ids).size,1)
    assert.equal(sql('select count(*) from claim_task_reminders()'),'0')
    const id=ids[0],claim=sql(`select claim_token from task_reminder_outbox where id='${id}'`)
    assert.equal(sql(`select authorize_task_reminder('${id}',gen_random_uuid()) is null`),'t')
    assert.equal(sql(`select authorize_task_reminder('${id}','${claim}')->'member'->>'id'`),owner)
    assert.equal(sql(`select authorize_task_reminder('${id}','${claim}') is null`),'t')
    sql(`update task_reminder_outbox set processing_started_at=now()-interval '11 minutes' where id='${id}';select count(*) from claim_task_reminders();`)
    assert.equal(sql(`select error_code from task_reminder_outbox where id='${id}'`),'PROVIDER_RESULT_UNKNOWN')
    assert.equal(sql(`select count(*) from claim_task_reminders('${id}')`),'0')
    // RLS and RPC grants prevent authenticated clients from claiming or writing the outbox.
    assert.equal(sql(`set role authenticated; set test.org='10000000-0000-4000-8000-000000000002'; select count(*) from task_reminder_outbox;`).split('\n').at(-1),'0')
    assert.equal(sql(`select has_function_privilege('authenticated','public.claim_task_reminders(uuid)','execute')`),'f')
    assert.equal(sql(`select has_table_privilege('authenticated','public.task_reminder_outbox','insert')`),'f')
    assert.throws(()=>sql(`update task_reminder_outbox set team_member_id='20000000-0000-4000-8000-000000000003' where id='${id}'`),/tenant mismatch/)
    // A claimed reminder invalidated by task completion cannot be authorized for delivery.
    task('000000000006')
    const claimed=JSON.parse(sql(`select row_to_json(r) from claim_task_reminders() r`))
    sql(`update crm_tasks set status='completed' where id='30000000-0000-4000-8000-000000000006'`)
    assert.equal(sql(`select authorize_task_reminder('${claimed.id}','${claimed.claim_token}') is null`),'t')
    task('000000000007')
    const sent=JSON.parse(sql(`select row_to_json(r) from claim_task_reminders() r`))
    sql(`select authorize_task_reminder('${sent.id}','${sent.claim_token}');update task_reminder_outbox set status='sent',provider_message_id='wamid.fixture',sent_at=now() where id='${sent.id}';`)
    assert.equal(sql(`select count(*) from claim_task_reminders('${sent.id}')`),'0')
    sql(`update crm_tasks set assigned_to='${nextOwner}' where id='30000000-0000-4000-8000-000000000007'`)
    assert.equal(sql(`select count(*) from task_reminder_outbox where task_id='30000000-0000-4000-8000-000000000007'`),'1')
    assert.equal(sql(`select status from task_reminder_outbox where id='${sent.id}'`),'sent')
  }finally{
    if(started)execFileSync('pg_ctl',['-D',`${dir}/data`,'-m','immediate','-w','stop'],{stdio:'pipe'})
    // Only the unique directory created by this test is removed.
    fs.rmSync(dir,{recursive:true,force:true})
  }
})
