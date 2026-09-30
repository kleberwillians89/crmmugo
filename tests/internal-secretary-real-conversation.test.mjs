import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSecretaryDate, planInternalSecretaryMessage, secretaryActionToCommand, secretaryCommandInputRequest, runSecretaryActions, buildPendingSecretaryPlan, retainSecretaryPlan, formatSecretaryExecutionReply } from '../supabase/functions/_shared/internalSecretaryAgent.js'

const localDate = '2026-09-30'
const plan = (actions, turn_relation = 'new_request') => ({ reply_mode: 'execute', message: null, actions, turn_relation })
const action = (tool, args) => ({ tool, arguments: args })
async function interpret(message, raw, tasks = [], session = null) {
  return planInternalSecretaryMessage({ apiKey: 'fixture', model: 'fixture', message, now: { local_date: localDate }, session,
    operationalContext: { my_tasks: tasks.map((task) => ({ label: task.title, task_id: task.id, status: task.status })) },
    fetcher: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(raw) }) }),
  })
}

test('normaliza datas reais com calendário válido usando parser compartilhado', () => {
  for (const [text, expected] of [['01/10','2026-10-01'],['1/10','2026-10-01'],['amanhã','2026-10-01'],['hoje',localDate],['ontem','2026-09-29'],['sexta','2026-10-02'],['dia 5','2026-09-05'],['fim do dia',localDate],['31/02',null],['2026-02-31',null]]) assert.equal(normalizeSecretaryDate(text, localDate), expected, text)
})

test('seis turnos reais: enriquece plano incompleto e executa sobre estado mutável', async (t) => {
  const tasks = [{ id: 'mila', title: 'Finalizar site da Mila', status: 'pending' }]
  const hours = []
  let session = null
  const turns = [
    ['Bom dia. Hoje preciso finalizar o site da Cafifa, revisar a campanha da Roove às 14h e coloca para a Julia conferir os roteiros da Origami. Ontem trabalhei 4 horas na Cafifa.', plan([
      action('create_task',{title:'Finalizar site da Cafifa'}), action('create_task',{title:'Revisar campanha Roove'}), action('create_task',{title:'Conferir roteiros da Origami',assignee_name:'Julia'}), action('record_hours',{summary:'Cafifa',hours:4}),
    ])],
    ['qual minha demanda de hoje?',plan([action('get_day_summary',{})])],
    ['Finalizar site da Mila — atrasada - finalizado.',plan([action('record_activity',{summary:'Site da Mila',status:'completed'})])],
    ['Revisar campanha Roove — colocar limite ate 01/10',plan([action('update_task',{task_query:'roove campanha',date:'01/10'})])],
    ['e coloca às 15h',plan([action('update_task',{task_query:'Revisar campanha Roove',time:'15h'})],'correct_plan')],
    ['como ficou meu dia?',plan([action('get_day_summary',{})])],
  ]
  for (let i=0;i<turns.length;i++) {
    const [input, raw] = turns[i]
    const result = await interpret(input,raw,tasks,session)
    assert.equal(result.reply_mode,'execute')
    const commands = result.actions.map(secretaryActionToCommand)
    const executed = []
    const outcome = await runSecretaryActions({messageKey:`t${i}`,commands,executeTool:async(command)=>{
      assert.equal(secretaryCommandInputRequest(command),null)
      executed.push(command.intent)
      let task
      if(command.intent==='CREATE_TASK') { task={id:`task-${tasks.length}`,title:command.title,due_date:command.due_date,due_time:command.due_time,assignee:command.assignee_name||'Kleber',status:'pending'};tasks.push(task) }
      else if(command.intent==='RECORD_TIME') hours.push(command)
      else if(command.intent==='COMPLETE_TASK'||command.intent==='MOVE_TASK') {task=tasks.find((item)=>item.title===command.task_query);assert.ok(task);if(command.intent==='COMPLETE_TASK')task.status='completed';else {if(command.due_date)task.due_date=command.due_date;if(command.due_time)task.due_time=command.due_time}}
      else assert.equal(command.intent,'DAY_SUMMARY')
      return { reply:command.intent==='DAY_SUMMARY'?JSON.stringify(tasks.filter((item)=>item.status==='pending'&&item.assignee==='Kleber')):'Salvo',entity_id:task?.id,entity_type:task?'crm_tasks':null }
    }})
    const saved=retainSecretaryPlan(session?.context.secretary_plan,buildPendingSecretaryPlan({plan:result,commands,messageKey:`t${i}`,outcome}),result.turn_relation)
    session={context:{secretary_plan:saved}}
    const reply=formatSecretaryExecutionReply({commands,outcome,localDate})
    t.diagnostic(JSON.stringify({input,turn_relation:result.turn_relation,planned_tools:result.actions.map((item)=>item.tool),executed_tools:executed,session_result:saved,user_visible_reply:reply}))
    assert.doesNotMatch(reply,/Confirmo estas tarefas|Para quando|data da atividade/)
    if(i===0){assert.equal(tasks.length,4);assert.ok(tasks.slice(1).every((task)=>task.due_date===localDate));assert.equal(tasks[2].due_time,'14:00');assert.equal(tasks[3].assignee,'Julia');assert.equal(hours[0].due_date,'2026-09-29')}
    if(i===2)assert.equal(tasks[0].status,'completed')
    if(i===3)assert.equal(tasks[2].due_date,'2026-10-01')
    if(i===4)assert.equal(tasks[2].due_time,'15:00')
  }
  assert.equal(tasks.length,4)
  assert.equal(hours.length,1)
})

test('read requests interrompem plano e Alpha amanhã retoma sem duplicar',async()=>{
  const first=await interpret('preciso fazer Alpha',plan([action('create_task',{title:'Fazer Alpha'})]))
  const commands=first.actions.map(secretaryActionToCommand)
  assert.match(secretaryCommandInputRequest(commands[0]),/Para quando/)
  const pending=buildPendingSecretaryPlan({plan:first,commands,messageKey:'alpha'})
  for(const input of ['antes disso, o que tenho hoje?','como está minha semana?','quantas tarefas estão atrasadas?','como está a Julia?']){
    const read=await interpret(input,plan([action('list_my_tasks',{})],'continue_plan'),[],{context:{secretary_plan:pending}})
    assert.equal(read.turn_relation,'new_request')
    const current=buildPendingSecretaryPlan({plan:read,commands:read.actions.map(secretaryActionToCommand),messageKey:input})
    assert.equal(retainSecretaryPlan(pending,current,read.turn_relation,100).actions[0].arguments.title,'Fazer Alpha')
    assert.equal(retainSecretaryPlan({...pending,interrupted_at:100},current,read.turn_relation,1800100),current)
  }
  const resumed=await interpret('Alpha amanhã',plan([action('create_task',{title:'Fazer Alpha',date:'amanhã'})],'continue_plan'),[],{context:{secretary_plan:pending}})
  assert.equal(resumed.actions[0].arguments.date,'2026-10-01')
  const cancelled=await interpret('esquece isso',plan([action('create_task',{title:'Alpha',date:'hoje'})],'cancel_plan'))
  assert.deepEqual(cancelled.actions,[])
  assert.equal(retainSecretaryPlan(pending,null,'cancel_plan'),null)
})

test('generaliza sem nomes fixos, rejeita ambiguidade e explica data inválida',async()=>{
  const enriched=await interpret('Hoje termino Projeto Alpha, revisar Beta às 16 e Maria confere Gamma. Ontem trabalhei 3h no Alpha.',plan([
    action('create_task',{title:'Projeto Alpha'}),action('create_task',{title:'Revisar Beta'}),action('create_task',{title:'Gamma',assignee_name:'Maria'}),action('record_hours',{summary:'Alpha',hours:3}),
  ]))
  assert.deepEqual(enriched.actions.map((item)=>item.arguments.date),[localDate,localDate,localDate,'2026-09-29'])
  assert.equal(enriched.actions[1].arguments.time,'16:00')
  const tasks=[{id:'alpha',title:'Projeto Alpha'},{id:'beta',title:'Revisar Beta'}]
  const completed=await interpret('Projeto Alpha finalizado',plan([action('record_activity',{summary:'Projeto Alpha',status:'completed'})]),tasks)
  assert.equal(completed.actions[0].tool,'complete_task')
  for(const input of ['Beta para 02/10','colocar revisar Beta para 02/10','Beta 02/10']) {
    const updated=await interpret(input,plan([action('update_task',{task_query:'Beta',date:'02/10'})]),tasks)
    assert.equal(updated.actions[0].arguments.date,'2026-10-02')
    assert.equal(updated.actions[0].arguments.task_query,'Revisar Beta')
  }
  const timed=await interpret('e às 13h',plan([action('update_task',{task_query:'Revisar Beta',time:'13h'})],'correct_plan'),tasks)
  assert.equal(secretaryActionToCommand(timed.actions[0]).due_time,'13:00')
  const ambiguous=await interpret('Beta finalizado',plan([action('record_activity',{summary:'Beta',status:'completed'})]),[...tasks,{title:'Publicar Beta'}])
  assert.equal(ambiguous.reply_mode,'clarify');assert.match(ambiguous.message,/Qual delas/)
  const invalid=await interpret('Beta para 31/02',plan([action('update_task',{task_query:'Beta',date:'31/02'})]),tasks)
  assert.match(invalid.message,/Qual data/);assert.doesNotMatch(invalid.message,/Não posso/)
  const invalidIso=await interpret('Beta para 31/02',plan([action('update_task',{task_query:'Beta',date:'2026-02-31'})]),tasks)
  assert.match(invalidIso.message,/Qual data/)
  const injected=await interpret('Projeto Alpha finalizado',plan([action('record_activity',{summary:'Projeto Alpha',status:'completed',organization_id:'other'})]),tasks)
  assert.deepEqual(injected.actions,[]);assert.match(injected.message,/Não posso/)
})
