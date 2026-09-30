import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { planInternalSecretaryMessage, safeSecretaryReadRescue, requiresOperationalRead, secretaryActionToCommand, runSecretaryActions, secretaryCommandInputRequest, buildPendingSecretaryPlan, retainSecretaryPlan } from '../supabase/functions/_shared/internalSecretaryAgent.js'
import { getMemberTaskReadModel } from '../supabase/functions/_shared/internalAssistantReadModel.js'

const localDate='2026-09-30'
const teamMembers=[{id:'kleber',name:'Kleber'},{id:'julia',name:'Julia'}]
const response=(value)=>async()=>({ok:true,json:async()=>({output_text:JSON.stringify(value)})})
const read={reply_mode:'execute',actions:[{tool:'plan_my_day',arguments:{date:localDate}}]}
test('planner reports every failure category without body, credentials or prompt',async()=>{
  const cases=[
    ['ok',response(read)],
    ['http_error',async()=>({ok:false,status:503})],
    ['timeout',async()=>{throw Object.assign(new Error('private'),{name:'TimeoutError'})}],
    ['invalid_json',async()=>({ok:true,json:async()=>({output_text:'not json'})})],
    ['canonicalization_rejected',response({actions:[{tool:'delete_all',arguments:{}}]})],
    ['validation_rejected',response({reply_mode:'execute',actions:[{tool:'plan_my_day',arguments:{date:'not a date'}}]})],
  ]
  for(const [expected,fetcher] of cases){
    const statuses=[]
    const result=await planInternalSecretaryMessage({apiKey:'private-key',model:'fixture',message:'qual minha demanda de hoje?',now:{local_date:localDate},fetcher,onPlannerStatus:(status)=>statuses.push(status)})
    assert.equal(statuses.at(-1),expected)
    assert.doesNotMatch(JSON.stringify(statuses),/private|prompt/)
    if(expected!=='ok'){
      const rescue=safeSecretaryReadRescue('qual minha demanda de hoje?',{localDate,teamMembers})
      assert.equal(rescue.actions[0].tool,'plan_my_day')
    }else assert.equal(result.actions[0].tool,'plan_my_day')
  }
})

test('operational variations map exclusively to read tools and dates',()=>{
  for(const text of ['o que tenho hoje?','qual minha demanda de hoje?','quais minhas demandas?','como está meu dia?','quais minhas tarefas hoje?','o que preciso fazer?','o que preciso fazer hoje?','agenda operacional']){
    assert.equal(requiresOperationalRead(text),true,text)
    const result=safeSecretaryReadRescue(text,{localDate,teamMembers})
    assert.equal(result.actions[0].tool,'plan_my_day',text)
    assert.equal(result.actions[0].arguments.date,localDate)
  }
  for(const text of ['tenho algo atrasado?','tem algo atrasado?'])assert.equal(safeSecretaryReadRescue(text,{localDate}).actions[0].arguments.scope,'overdue')
  assert.equal(safeSecretaryReadRescue('como está minha semana?',{localDate}).actions[0].tool,'get_week_summary')
  assert.equal(safeSecretaryReadRescue('o que tenho amanhã?',{localDate}).actions[0].arguments.date,'2026-10-01')
  const julia=safeSecretaryReadRescue('o que a Julia tem hoje?',{localDate,teamMembers})
  assert.equal(julia.actions[0].tool,'list_team_tasks');assert.equal(julia.actions[0].arguments.assignee_name,'Julia')
  assert.equal(safeSecretaryReadRescue('o que a PessoaDesconhecida tem hoje?',{localDate,teamMembers}).reply_mode,'clarify')
  for(const text of ['me ajuda a escrever uma mensagem','cria uma tarefa','o que tenho hoje e conclui tudo','Hoje preciso revisar Gamma às 14h, Julia confere Delta. Ontem trabalhei 2 horas no Gamma.'])assert.equal(safeSecretaryReadRescue(text,{localDate,teamMembers}),null,text)
})

test('exact multi-action then read-after-write through production read model, scoped to tenant/member',async()=>{
  const message='Hoje preciso revisar Gamma às 14h, Julia confere Delta.\nOntem trabalhei 2 horas no Gamma.'
  const plan=await planInternalSecretaryMessage({apiKey:'fixture',model:'fixture',message,member:teamMembers[0],now:{local_date:localDate},operationalContext:{team_members:teamMembers},fetcher:response({reply_mode:'execute',actions:[
    {tool:'create_task',arguments:{items:[{title:'Revisar Gamma',due_date:localDate,due_time:'14:00',assignee_member_id:'kleber'},{title:'Delta',assignee_member_id:'julia'}]}},
    {tool:'record_hours',arguments:{hours:2,date:'2026-09-29'}},
  ]})})
  const rows=[{id:'foreign',organization_id:'other',assigned_to:'kleber',title:'Foreign',due_date:localDate,status:'pending'}]
  const hours=[]
  const commands=plan.actions.map(secretaryActionToCommand)
  const outcome=await runSecretaryActions({messageKey:'write',commands,executeTool:async(command)=>{
    assert.equal(secretaryCommandInputRequest(command),null)
    if(command.intent==='CREATE_TASK')for(const item of command.items)rows.push({id:`task-${rows.length}`,organization_id:'mugo',assigned_to:command.assignee_name==='Julia'?'julia':'kleber',title:item.title,due_date:item.due_date,due_time:item.due_time,status:'pending'})
    else {assert.equal(command.intent,'RECORD_TIME');hours.push(command)}
    return{reply:'Salvo'}
  }})
  assert.equal(outcome.completed_tool_calls.length,3);assert.deepEqual(outcome.pending_tool_calls,[])
  assert.equal(hours[0].hours,2);assert.equal(hours[0].summary,'Gamma');assert.equal(hours[0].due_date,'2026-09-29')
  const before=JSON.stringify(rows)
  const admin={from(table){
    assert.equal(table,'crm_tasks')
    let filtered=[...rows]
    const query={select(){return query},eq(key,value){filtered=filtered.filter((row)=>row[key]===value);return query},not(key){filtered=filtered.filter((row)=>key==='status'?!['completed','cancelled'].includes(row[key]):row[key]!=null);return query},lte(key,value){filtered=filtered.filter((row)=>row[key]<=value);return query},order(){return query},limit(){return Promise.resolve({data:filtered,error:null})}}
    return query // Deliberately no mutation methods.
  }}
  const rescue=safeSecretaryReadRescue('qual minha demanda de hoje?',{localDate,teamMembers})
  const command=secretaryActionToCommand(rescue.actions[0])
  assert.equal(command.intent,'PLAN_MY_DAY')
  const model=await getMemberTaskReadModel(admin,'mugo','kleber',command.due_date)
  assert.deepEqual(model.tasks.map((task)=>task.title),['Revisar Gamma'])
  assert.equal(model.tasks[0].due_time,'14:00')
  assert.equal(JSON.stringify(rows),before)
  const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
  assert.match(worker,/processingPath='secretary_read_rescue'/)
  assert.match(worker,/planner_status:plannerStatus/)
  assert.match(worker,/!operationalReadProbe&&command.intent==='UNKNOWN'/)
  assert.match(worker,/LIST_OVERDUE'\) query = query.eq\('assigned_to',event.team_member_id\)/)
  // A busca de membros usada pelo rescue nunca cruza tenant — sempre filtra pela organização do evento
  // autenticado (nunca vem do texto do usuário).
  assert.match(worker,/const members=await admin\.from\('team_members'\)\.select\('id,name'\)\.eq\('organization_id',event\.organization_id\)\.eq\('active',true\)/)
})

// ===================================================================================================
// HOTFIX 2026-09-30: exemplos literais do pedido — nenhum deles pode cair em UNKNOWN/legacy_fallback.
// ===================================================================================================

test('exemplos literais do hotfix: nenhuma dessas mensagens é null (todas viram um plano de leitura seguro)', () => {
  for(const text of ['qual minha demanda de hoje?','o que tenho hoje?','quais minhas tarefas?','como está meu dia?','o que preciso fazer hoje?','tenho algo atrasado?','como está minha semana?','o que a Julia tem hoje?']){
    const rescue=safeSecretaryReadRescue(text,{localDate,teamMembers})
    assert.notEqual(rescue,null,text)
    assert.equal(rescue.reply_mode,'execute',text)
    assert.ok(['plan_my_day','list_my_tasks','get_week_summary','list_team_tasks'].includes(rescue.actions[0].tool),text)
  }
})

// ===================================================================================================
// Regressão E2E real: a mensagem literal já comprovada em produção (multi-action) precisa continuar
// produzindo exatamente 3 completed_tool_calls / 0 pending, com os mesmos campos (Gamma→Kleber
// 30/09/2026 14:00, Delta→Julia 30/09/2026 sem horário, Horas→2h 29/09/2026 summary="Teste Gamma").
// Read rescue nunca intercepta essa mensagem (tem escrita) — precisa do planner real, como já provado.
// ===================================================================================================

test('regressão E2E real (multi-action de produção): 3 completed_tool_calls, 0 pending, campos exatos', async () => {
  const message='Bom dia. Hoje preciso revisar o projeto Teste Gamma às 14h e coloca para a Julia conferir o projeto Teste Delta. Ontem trabalhei 2 horas no Teste Gamma.'
  assert.equal(safeSecretaryReadRescue(message,{localDate:'2026-09-30',teamMembers}),null)
  const plan=await planInternalSecretaryMessage({
    apiKey:'fixture',model:'fixture',message,member:teamMembers[0],now:{local_date:'2026-09-30'},
    operationalContext:{team_members:teamMembers},
    fetcher:response({reply_mode:'execute',actions:[
      {tool:'create_task',arguments:{items:[
        {title:'Revisar o projeto Teste Gamma',due_date:'2026-09-30',due_time:'14:00'},
        {title:'Conferir o projeto Teste Delta',due_date:'2026-09-30',assignee_member_id:'julia'},
      ]}},
      {tool:'record_hours',arguments:{hours:2,due_date:'2026-09-29',summary:'Teste Gamma'}},
    ]}),
  })
  const commands=plan.actions.map(secretaryActionToCommand)
  const outcome=await runSecretaryActions({messageKey:'e2e-real',commands,executeTool:async(command)=>{
    assert.equal(secretaryCommandInputRequest(command),null)
    return{reply:'Salvo'}
  }})
  assert.equal(outcome.completed_tool_calls.length,3)
  assert.deepEqual(outcome.pending_tool_calls,[])
  assert.equal(commands[0].intent,'CREATE_TASK');assert.equal(commands[0].title,'Revisar o projeto Teste Gamma')
  assert.equal(commands[0].due_date,'2026-09-30');assert.equal(commands[0].due_time,'14:00');assert.equal(commands[0].assignee_name,null)
  assert.equal(commands[1].intent,'CREATE_TASK');assert.equal(commands[1].title,'Conferir o projeto Teste Delta')
  assert.equal(commands[1].due_date,'2026-09-30');assert.equal(commands[1].due_time,null);assert.equal(commands[1].assignee_name,'Julia')
  assert.equal(commands[2].intent,'RECORD_TIME');assert.equal(commands[2].hours,2)
  assert.equal(commands[2].due_date,'2026-09-29');assert.equal(commands[2].summary,'Teste Gamma')
})

// ===================================================================================================
// Uma pergunta de leitura logo após um plano já concluído não pode ficar presa ao plano antigo: o novo
// plano (rescue) precisa substituir o anterior, nunca herdar nem se confundir com ele.
// ===================================================================================================

test('leitura após plano já concluído: o novo plano de leitura substitui o anterior (nunca herda o antigo)', () => {
  const previousCommands=[{intent:'RECORD_TIME',hours:2,summary:'Teste Gamma',due_date:'2026-09-29'}]
  const completedPlan=buildPendingSecretaryPlan({plan:{actions:[{tool:'record_hours',arguments:{}}]},commands:previousCommands,messageKey:'previous',outcome:{completed_tool_calls:['previous:action:0:RECORD_TIME'],pending_tool_calls:[],tool_call_results:{}}})
  assert.ok(completedPlan.actions.every((action)=>action.status==='completed'))
  const readRescue=safeSecretaryReadRescue('qual minha demanda de hoje?',{localDate,teamMembers})
  const newPending=buildPendingSecretaryPlan({plan:readRescue,commands:readRescue.actions.map(secretaryActionToCommand),messageKey:'current'})
  const retained=retainSecretaryPlan(completedPlan,newPending,'new_request')
  // Um plano anterior TOTALMENTE concluído nunca é preservado por engano sobre um novo pedido de leitura.
  assert.deepEqual(retained,newPending)
  assert.notDeepEqual(retained,completedPlan)
})
