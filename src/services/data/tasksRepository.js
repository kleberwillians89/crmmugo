import {db,isSupabaseProvider,organizationId,unwrap} from './provider'
import {invalidateCrmData} from '../../lib/dataInvalidation'

const select='*, team_members(name), clients(company_name), proposals(title), contracts(contract_number), invoice_installments(reference_month), commercial_opportunities(name,conversation_id), task_external_links(provider,external_url,sync_status,last_synced_at,last_error)'
const legacySelect=select.replace(', task_external_links(provider,external_url,sync_status,last_synced_at,last_error)','')
const unavailable=(error)=>error?.code==='PGRST205'||error?.code==='42P01'||/crm_tasks|operational_events|schema cache/i.test(`${error?.message||''} ${error?.details||''}`)
export const taskShortId=(id)=>`#${String(id||'').replaceAll('-','').slice(0,6).toUpperCase()}`

export async function listTasks(){
  if(!isSupabaseProvider())return{available:false,items:[]}
  let response=await db().from('crm_tasks').select(select).order('due_date',{ascending:true})
  if(response.error&&/task_external_links/i.test(`${response.error.message||''}`))response=await db().from('crm_tasks').select(legacySelect).order('due_date',{ascending:true})
  if(response.error&&unavailable(response.error))return{available:false,items:[]}
  return{available:true,items:unwrap(response)}
}
export async function createTask(values){const payload={...values,due_time:values.due_time||null,source:values.source||'crm',organization_id:await organizationId()};const record=unwrap(await db().from('crm_tasks').insert(payload).select(select).single());invalidateCrmData({resources:['dashboard','intelligence','tasks']});return record}
export async function updateTask(id,values){const patch={...values,...('due_time'in values?{due_time:values.due_time||null}:{})};if(values.status==='completed')patch.completed_at=new Date().toISOString();else if(values.status&&values.status!=='completed')patch.completed_at=null;const record=unwrap(await db().from('crm_tasks').update(patch).eq('id',id).select(select).single());invalidateCrmData({resources:['dashboard','intelligence','tasks']});return record}
export const archiveTask=(id)=>updateTask(id,{status:'cancelled',archived_at:new Date().toISOString()})
export async function addTaskObservation(task,body){const note=String(body||'').trim();if(!note)throw new Error('Informe a observação.');const notes=[task.notes,note].filter(Boolean).join('\n\n');return updateTask(task.id,{notes})}
export async function listOperationalEvents({limit=120}={}){if(!isSupabaseProvider())return{available:false,items:[]};const response=await db().from('operational_events').select('*,team_members(name),clients(company_name),crm_tasks(title),commercial_opportunities(name)').order('occurred_at',{ascending:false}).limit(limit);if(response.error&&unavailable(response.error))return{available:false,items:[]};return{available:true,items:unwrap(response)}}

export async function getOperationalSummary(){
  const empty={available:false,unread:0,waitingHuman:0,botActive:0,pendingCharges:0,overdueCharges:0,integrations:[]}
  if(!isSupabaseProvider())return empty
  const client=db(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const [conversations,charges,integrations,opportunities]=await Promise.all([
    client.from('whatsapp_conversations').select('unread_count,status,attendance_mode,automation_paused'),
    client.from('invoice_installments').select('status,due_date').in('status',['pending','overdue']),
    client.from('task_integration_settings').select('provider,enabled,last_synced_at,last_error'),
    client.from('commercial_opportunities').select('stage,next_action_at'),
  ])
  const rows=conversations.data||[],billing=charges.data||[]
  const leads=opportunities.data||[]
  return{available:!conversations.error,unread:rows.reduce((sum,item)=>sum+Number(item.unread_count||0),0),waitingHuman:rows.filter((item)=>item.status==='pending'&&item.automation_paused).length,botActive:rows.filter((item)=>item.status!=='closed'&&item.attendance_mode==='bot'&&!item.automation_paused).length,pendingCharges:billing.length,overdueCharges:billing.filter((item)=>item.status==='overdue'||item.due_date<today).length,newLeads:leads.filter(item=>['new_lead','in_service'].includes(item.stage)).length,hotLeads:leads.filter(item=>['qualified','meeting','proposal','negotiation'].includes(item.stage)).length,integrations:[{provider:'whatsapp',enabled:!conversations.error,last_error:conversations.error?.message||null},...(integrations.data||[])]}
}
