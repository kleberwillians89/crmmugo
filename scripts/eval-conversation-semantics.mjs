// Opt-in, model-only evaluation. No database, WhatsApp or tool execution.
// Offline: node scripts/eval-conversation-semantics.mjs
// Live: OPENAI_API_KEY=... TASK_COMMAND_MODEL=... node scripts/eval-conversation-semantics.mjs --live
// Reviewed feedback may be supplied as JSON [{id,message,tools,member,session}] with --fixtures <path>.
// Anonymize all feedback before export. Never pass raw production events or secrets.
import fs from 'node:fs'
import {planInternalSecretaryMessage} from '../supabase/functions/_shared/internalSecretaryAgent.js'

const members=['Kleber','Julia','Liliu','Danilo']
const clients=['Aurora','Horizonte','Cedro','Atlântico']
const requests=[name=>`Amanhã preciso revisar a campanha da ${name}`,name=>`n posso esqcer de revisar ${name} amanha`,name=>`Anote para amanhã a revisão de ${name}`,name=>`${name}, revisar a campanha amanha pra mim`]
const cases=members.flatMap((member,i)=>requests.map((phrase,j)=>({id:`create-${i}-${j}`,member,message:phrase(clients[(i+j)%clients.length]),tools:['create_task']})))
const taskId='ab123456-0000-4000-8000-000000000001'
cases.push({id:'reference-reopen',member:'Julia',message:'não pera deixa aquela aberta',tools:['reopen_task'],session:{context:{conversation_state:{scope:'fixture',expires_at:Date.now()+1_800_000,recent_entities:[{ref:`task:${taskId}`,id:taskId,kind:'task',label:'Revisar campanha Aurora',owner_name:'Julia'}],last_successful_action:{tool:'complete_task',entity_ref:`task:${taskId}`}}}}})
const fixtureIndex=process.argv.indexOf('--fixtures')
if(fixtureIndex!==-1){
  const reviewed=JSON.parse(fs.readFileSync(process.argv[fixtureIndex+1],'utf8'))
  if(!Array.isArray(reviewed)||reviewed.some(row=>!row.message||!Array.isArray(row.tools)))throw new Error('Invalid reviewed fixtures')
  cases.push(...reviewed)
}
if(!process.argv.includes('--live')){
  console.log(JSON.stringify({mode:'offline_inventory',cases:cases.length,executed:false,note:'Contract mocks do not prove semantic comprehension. --live requires API credentials; never executes tools.'}))
}else{
  const apiKey=process.env.OPENAI_API_KEY,model=process.env.TASK_COMMAND_MODEL||process.env.OPENAI_MODEL
  if(!apiKey||!model)throw new Error('OPENAI_API_KEY and TASK_COMMAND_MODEL/OPENAI_MODEL required')
  let failures=0
  for(const fixture of cases){
    const plan=await planInternalSecretaryMessage({apiKey,model,message:fixture.message,member:{name:fixture.member},session:fixture.session||null,now:{local_date:'2026-10-01',timezone:'America/Sao_Paulo'},operationalContext:{team_members:members.map((name,i)=>({id:`member-${i}`,name}))}})
    const actual=(plan?.actions||[]).map(action=>action.tool)
    const passed=JSON.stringify([...actual].sort())===JSON.stringify([...fixture.tools].sort())&&plan?.reply_mode==='execute'&&(fixture.id.startsWith('create-')?plan.actions.every(action=>action.arguments.date==='2026-10-02'&&!action.arguments.assignee_name):true)
    if(!passed)failures++
    console.log(JSON.stringify({id:fixture.id,passed,tools:actual,mode:plan?.reply_mode||'unavailable'}))
  }
  console.log(JSON.stringify({cases:cases.length,failures,model,tools_executed:false}))
  process.exitCode=failures?1:0
}
