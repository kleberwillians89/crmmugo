import {normalizePhoneForWhatsApp} from './internalCommandCore.js'

export const TASK_REMINDER_TEMPLATE='mugo_lembrete_tarefa'
export const TASK_REMINDER_LANGUAGE='pt_BR'
export const REMINDER_GRACE_MS=10*60_000
const clean=(value,max=240)=>String(value??'').trim().slice(0,max)

// due_at is always calculated by PostgreSQL using its IANA timezone database.
export function reminderEligibility(task,reminder,now=new Date()){
  if(!task||task.organization_id!==reminder.organization_id)return 'TASK_NOT_FOUND'
  if(task.status==='completed')return 'TASK_COMPLETED'
  if(task.status==='cancelled')return 'TASK_CANCELLED'
  if(task.archived_at)return 'TASK_ARCHIVED'
  if(!task.assigned_to||!task.due_date||!task.due_time||task.reminder_enabled===false)return 'REMINDER_DISABLED'
  if(task.assigned_to!==reminder.team_member_id)return 'ASSIGNEE_CHANGED'
  const due=new Date(reminder.due_at)
  if(!Number.isFinite(due.getTime()))return 'REMINDER_EXPIRED'
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(due).map((part)=>[part.type,part.value]))
  if(`${parts.year}-${parts.month}-${parts.day}`!==task.due_date||`${parts.hour}:${parts.minute}:${parts.second}`!==String(task.due_time).slice(0,8).padEnd(8,':00'))return 'REMINDER_CHANGED'
  if(due<=now||(reminder.attempts<=1&&now.getTime()-new Date(reminder.scheduled_for).getTime()>REMINDER_GRACE_MS))return 'REMINDER_EXPIRED'
  if(new Date(reminder.scheduled_for)>now)return 'NOT_DUE'
  return null
}

export function reminderRecipient(member,organizationId){
  if(!member||member.organization_id!==organizationId||member.active!==true)return{error:'TEAM_MEMBER_INACTIVE'}
  if(!clean(member.phone))return{error:'TEAM_MEMBER_PHONE_MISSING'}
  const phone=normalizePhoneForWhatsApp(member.phone)
  return phone?{phone}:{error:'INVALID_PHONE'}
}

export function templateApproved(template){
  return template?.name===TASK_REMINDER_TEMPLATE&&template.status==='APPROVED'&&template.is_active===true&&template.language===TASK_REMINDER_LANGUAGE&&template.category==='UTILITY'
}

export function reminderPayload(task,member,phone){
  return{messaging_product:'whatsapp',recipient_type:'individual',to:phone,type:'template',template:{name:TASK_REMINDER_TEMPLATE,language:{code:TASK_REMINDER_LANGUAGE},components:[{type:'body',parameters:[
    {type:'text',text:clean(member.name,120).split(/\s+/)[0]||'Equipe'},
    {type:'text',text:clean(task.title)},
    {type:'text',text:String(task.due_time).slice(0,5)},
  ]}]}}
}

export function reminderFailure({attempts,due_at},code,now=new Date(),{unknown=false}={}){
  if(unknown)return{status:'blocked',error_code:'PROVIDER_RESULT_UNKNOWN',next_attempt_at:null,failed_at:now.toISOString()}
  const temporary=['429','500','502','503','TIMEOUT','NETWORK_ERROR','READ_FAILED'].includes(String(code))
  const delay=[2,5,10,20,30][attempts-1]
  const next=delay?new Date(now.getTime()+delay*60_000):null
  const expired=new Date(due_at)<=now
  return{status:expired?'cancelled':'failed',error_code:expired?'REMINDER_EXPIRED':String(code),failed_at:now.toISOString(),
    next_attempt_at:temporary&&attempts<6&&next&&next<new Date(due_at)?next.toISOString():null,dispatch_started_at:null}
}

// Dependency injection permits behavioral tests without sending WhatsApp messages.
export async function processTaskReminder({store,row,token,graphVersion='v23.0',fetcher=fetch,now=()=>new Date()}){
  let providerMayHaveReceived=false
  const finish=async(patch)=>{await store.finish(row,{...patch,updated_at:now().toISOString()});return patch.status}
  try{
    if(!token)return await finish({status:'blocked',error_code:'CONFIGURATION_MISSING',next_attempt_at:null})
    const task=await store.task(row)
    const ineligible=reminderEligibility(task,row,now())
    if(ineligible)return await finish({status:'cancelled',error_code:ineligible,next_attempt_at:null})
    const connection=await store.connection(row.organization_id)
    if(!connection?.phone_number_id)return await finish({status:'blocked',error_code:'WHATSAPP_CONNECTION_MISSING',next_attempt_at:null})
    const template=await store.template(row.organization_id,connection.waba_id)
    if(!templateApproved(template))return await finish({status:'blocked',error_code:'TEMPLATE_NOT_APPROVED',next_attempt_at:null})
    // Reload and lock task/member via RPC immediately before dispatch; token fences concurrent workers.
    const authorized=await store.authorize(row)
    if(!authorized)return 'cancelled'
    const recipient=reminderRecipient(authorized.member,row.organization_id)
    if(recipient.error)return await finish({status:'blocked',error_code:recipient.error,next_attempt_at:null,dispatch_started_at:null})
    const recheck=reminderEligibility(authorized.task,row,now())
    if(recheck)return await finish({status:'cancelled',error_code:recheck,next_attempt_at:null,dispatch_started_at:null})
    providerMayHaveReceived=true
    let response
    try{
      response=await fetcher(`https://graph.facebook.com/${graphVersion}/${connection.phone_number_id}/messages`,{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify(reminderPayload(authorized.task,authorized.member,recipient.phone)),signal:AbortSignal.timeout(20_000),
      })
    }catch{
      // Fetch cannot prove non-delivery on timeout/network errors after dispatch. Zero automatic retries.
      return await finish(reminderFailure(row,'NETWORK_ERROR',now(),{unknown:true}))
    }
    if(!response.ok){providerMayHaveReceived=false;return await finish(reminderFailure(row,String(response.status),now()))}
    const body=await response.json().catch(()=>null),providerId=clean(body?.messages?.[0]?.id)
    if(!providerId)return await finish(reminderFailure(row,'INVALID_PROVIDER_RESPONSE',now(),{unknown:true}))
    return await finish({status:'sent',provider_message_id:providerId,sent_at:now().toISOString(),next_attempt_at:null,error_code:null,failed_at:null})
  }catch{
    return await finish(reminderFailure(row,'READ_FAILED',now(),{unknown:providerMayHaveReceived}))
  }
}
