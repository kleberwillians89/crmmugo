import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'

test('feedback PostgreSQL local: migration, RLS, spoofing de reviewer e escopo do evento',t=>{
  try{execFileSync('initdb',['--version'],{stdio:'pipe'})}catch{t.skip('PostgreSQL local indisponível');return}
  const dir=fs.mkdtempSync('/private/tmp/mugo-feedback-pg-')
  const sql=query=>execFileSync('psql',['-X','-h',dir,'-p','55498','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
  let started=false
  const org='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',user='20000000-0000-4000-8000-000000000001',conversation='30000000-0000-4000-8000-000000000001',event='40000000-0000-4000-8000-000000000001'
  try{
    execFileSync('initdb',['-D',`${dir}/data`,'-U','postgres','-A','trust','--no-locale'],{stdio:'pipe'})
    execFileSync('pg_ctl',['-D',`${dir}/data`,'-l',`${dir}/server.log`,'-o',`-F -k ${dir} -h '' -p 55498`,'-w','start'],{stdio:'pipe'});started=true
    sql(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select '${user}'::uuid$$;
      grant usage on schema auth to authenticated;
      create function public.current_organization_id() returns uuid language sql as $$select nullif(current_setting('test.org',true),'')::uuid$$;
      create function public.is_active_user() returns boolean language sql as $$select true$$;
      create table organizations(id uuid primary key);
      create table whatsapp_conversations(id uuid primary key,organization_id uuid);
      create table task_command_events(id uuid primary key,organization_id uuid,conversation_id uuid);
      create table commercial_ai_events(id uuid primary key,organization_id uuid,conversation_id uuid);
      grant select on whatsapp_conversations,task_command_events,commercial_ai_events to authenticated;
      insert into organizations values('${org}'),('${other}');insert into auth.users values('${user}');
      insert into whatsapp_conversations values('${conversation}','${org}');
      insert into task_command_events values('${event}','${org}','${conversation}');`)
    sql(fs.readFileSync('supabase/migrations/202610010001_conversation_feedback.sql','utf8'))
    const insert=`insert into conversation_feedback(organization_id,conversation_id,label,source_kind,source_event_id) values('${org}','${conversation}','context_wrong','internal','${event}')`
    sql(`set role authenticated;set test.org='${org}';${insert};`)
    assert.equal(sql(`set role authenticated;set test.org='${org}';select count(*) from conversation_feedback;`).split('\n').at(-1),'1')
    assert.equal(sql(`set role authenticated;set test.org='${other}';select count(*) from conversation_feedback;`).split('\n').at(-1),'0')
    assert.throws(()=>sql(`set role authenticated;set test.org='${other}';${insert};`),/row-level security/)
    assert.throws(()=>sql(`insert into conversation_feedback(organization_id,conversation_id,reviewer_id,label) values('${other}','${conversation}','${user}','correct');`),/tenant mismatch/)
    assert.throws(()=>sql(`insert into conversation_feedback(organization_id,conversation_id,reviewer_id,label,source_kind,source_event_id) values('${org}','${conversation}','${user}','correct','commercial','${event}');`),/event scope mismatch/)
    assert.throws(()=>sql(`set role authenticated;set test.org='${org}';insert into conversation_feedback(organization_id,conversation_id,reviewer_id,label) values('${org}','${conversation}','${other}','correct');`),/row-level security/)
    assert.equal(sql("select has_table_privilege('authenticated','conversation_feedback','update')"),'f')
    assert.equal(sql("select has_table_privilege('anon','conversation_feedback','select')"),'f')
  }finally{
    if(started)execFileSync('pg_ctl',['-D',`${dir}/data`,'-m','immediate','-w','stop'],{stdio:'pipe'})
    fs.rmSync(dir,{recursive:true,force:true})
  }
})
