import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { canonicalizeSecretaryPlan, enrichSecretaryPlan, validateSecretaryPlan, secretaryActionToCommand, secretaryCommandInputRequest, runSecretaryActions, planInternalSecretaryMessage, SECRETARY_ARGUMENT_SCHEMA } from '../supabase/functions/_shared/internalSecretaryAgent.js'

const sender={id:'0374c889-a4ea-4ef7-bfe7-b3772babeb0b',name:'Kleber',organization_id:'mugo'}
const julia={id:'e9fb965c-b1b2-4767-99d7-77849430769a',name:'Julia',organization_id:'mugo',active:true}
const context={team_members:[{...sender,active:true},julia]}
const message='Bom dia. Hoje preciso revisar o projeto Teste Alpha às 14h e coloca para a Julia conferir o projeto Teste Beta. Ontem trabalhei 1 hora no Teste Alpha.'
const raw={actions:[
  {tool:'create_task',arguments:{items:[
    {title:'Revisar projeto Teste Alpha',due_date:'2026-09-30',due_time:'14:00',assignee_member_id:sender.id},
    {title:'Conferir projeto Teste Beta',assignee_member_id:julia.id},
  ]}},
  {tool:'record_hours',arguments:{date:'2026-09-29',hours:1}},
]}
const options={operationalContext:context,authenticatedMember:sender,localDate:'2026-09-30',message}
function pipeline(input=raw,opts=options){
  const canonical=canonicalizeSecretaryPlan(input,opts)
  return canonical && validateSecretaryPlan(enrichSecretaryPlan(canonical,opts))
}

test('raw production plan preserves dates, times, owners and hours through all boundaries',async()=>{
  const original=structuredClone(raw)
  const plan=pipeline()
  assert.deepEqual(raw,original)
  assert.equal(plan.actions.length,3)
  assert.doesNotMatch(JSON.stringify(plan),/due_date|due_time|assignee_member_id|assigned_to|team_member_id|organization_id|member_id|user_id/)
  const commands=plan.actions.map(secretaryActionToCommand)
  assert.equal(commands[0].items[0].due_date,'2026-09-30')
  assert.equal(commands[0].items[0].due_time,'14:00')
  assert.equal(commands[0].assignee_name,null)
  assert.equal(commands[1].items[0].due_date,'2026-09-30')
  assert.equal(commands[1].assignee_name,'Julia')
  assert.equal(commands[2].due_date,'2026-09-29')
  assert.equal(commands[2].summary,'Teste Alpha')
  assert.ok(commands.slice(0,2).every((command)=>secretaryCommandInputRequest(command)===null))
  let calls=0
  const outcome=await runSecretaryActions({messageKey:'production',commands,executeTool:async()=>{calls++;return{reply:'Salvo'}}})
  assert.equal(outcome.completed_tool_calls.length,3)
  assert.deepEqual(outcome.pending_tool_calls,[])
  await runSecretaryActions({messageKey:'production',commands,completedToolCalls:outcome.completed_tool_calls,toolCallResults:outcome.tool_call_results,executeTool:async()=>{calls++}})
  assert.equal(calls,3)
  let request
  const actual=await planInternalSecretaryMessage({apiKey:'fixture',model:'fixture',member:sender,operationalContext:context,message,now:{local_date:'2026-09-30'},fetcher:async(_url,init)=>{
    request=JSON.parse(init.body)
    return{ok:true,json:async()=>({output_text:JSON.stringify(raw)})}
  }})
  assert.deepEqual(actual,plan)
  const schema=request.text.format.schema.properties.actions.items.properties.arguments
  assert.equal(schema.additionalProperties,false)
  assert.deepEqual(schema,SECRETARY_ARGUMENT_SCHEMA)
  assert.doesNotMatch(JSON.stringify(schema),/organization_id|team_member_id|assignee_member_id|assigned_to|due_date|due_time/)
  for(const variant of schema.properties.items.items.anyOf)assert.equal(variant.additionalProperties,false)
})

test('nested identities and unknown fields fail closed before any handler',()=>{
  for(const field of ['organization_id','team_member_id','member_id','user_id','assigned_to','assignee_member_id','unknown']){
    const input={reply_mode:'execute',actions:[{tool:'create_task',arguments:{items:[{title:'Teste',[field]:'other'}]}}]}
    assert.equal(canonicalizeSecretaryPlan(input,options),null,field)
    assert.equal(validateSecretaryPlan(input),null,field)
    assert.throws(()=>secretaryActionToCommand(input.actions[0]),/Non-canonical/)
  }
  for(const member of [{...julia,organization_id:'another'},{...julia,active:false}]){
    assert.equal(canonicalizeSecretaryPlan(raw,{...options,operationalContext:{team_members:[sender,member]}}),null)
  }
  assert.equal(canonicalizeSecretaryPlan(raw,{...options,operationalContext:{team_members:[sender]}}),null)
})

test('aliases require consistent values and adapter refuses incompatible shapes',()=>{
  const input={reply_mode:'execute',actions:[{tool:'create_task',arguments:{title:'Teste',due_date:'2026-10-01',due_time:'14:00'}}]}
  assert.throws(()=>secretaryActionToCommand(input.actions[0]),/Non-canonical/)
  const plan=pipeline(input)
  assert.equal(secretaryActionToCommand(plan.actions[0]).due_date,'2026-10-01')
  assert.equal(secretaryActionToCommand(plan.actions[0]).due_time,'14:00')
  input.actions[0].arguments.date='2026-10-02'
  assert.equal(canonicalizeSecretaryPlan(input,options),null)
})

test('per-item assignee, priority and type survive deterministic splitting',()=>{
  const input={actions:[{tool:'create_task',arguments:{date:'2026-10-01',priority:'medium',items:[
    {title:'A',time:'14:00',assignee_name:null,priority:'high',task_type:'meeting'},
    {title:'B',assignee_name:'Maria',priority:'low',task_type:'general'},
  ]}}]}
  const commands=pipeline(input).actions.map(secretaryActionToCommand)
  assert.deepEqual(commands.map((command)=>[command.assignee_name,command.priority,command.task_type]),[[null,'high','meeting'],['Maria','low','general']])
  assert.ok(commands.every((command)=>command.items[0].due_date==='2026-10-01'))
  assert.equal(commands[0].items[0].due_time,'14:00')
})

test('shared temporal scopes propagate but local tomorrow overrides today',()=>{
  const input={actions:[{tool:'create_task',arguments:{items:[{title:'A'},{title:'B',assignee_name:'Maria'}]}}]}
  for(const [text,expected] of [
    ['Hoje preciso A às 14 e coloca Maria para fazer B.',['2026-09-30','2026-09-30']],
    ['Amanhã A e coloca Maria para fazer B.',['2026-10-01','2026-10-01']],
    ['Hoje A e Maria faz B amanhã.',['2026-09-30','2026-10-01']],
  ]){
    const plan=pipeline(input,{...options,message:text})
    assert.deepEqual(plan.actions.map((action)=>action.arguments.items[0].date),expected,text)
    if(text.includes('14'))assert.equal(plan.actions[0].arguments.items[0].time,'14:00')
  }
})

test('partial execution still records hours; missing context is not invented',async()=>{
  const plan=pipeline({actions:[{tool:'create_task',arguments:{title:'Pedido sem prazo'}},{tool:'record_hours',arguments:{hours:2,date:'2026-09-29'}}]},{...options,message:'Criar Pedido sem prazo. Ontem trabalhei 2 horas.'})
  assert.equal(plan.actions[1].arguments.summary,undefined)
  const commands=plan.actions.map(secretaryActionToCommand)
  const effects=[]
  const result=await runSecretaryActions({messageKey:'partial',commands,executeTool:async(command)=>{
    const question=secretaryCommandInputRequest(command)
    if(question)return{pending:true,status:'awaiting_context',reply:question}
    effects.push(command.intent);return{reply:'Salvo'}
  }})
  assert.deepEqual(effects,['RECORD_TIME'])
  assert.equal(result.pending_tool_calls.length,1)
  assert.equal(result.completed_tool_calls.length,1)
  const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
  assert.match(worker,/plan:secretaryPlan,commands:secretaryCommands/)
  assert.match(worker,/validateSecretaryPlan\(savedSecretaryPlan.plan\)/)
})
