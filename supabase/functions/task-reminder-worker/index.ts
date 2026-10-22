import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {processTaskReminder,TASK_REMINDER_TEMPLATE,TASK_REMINDER_LANGUAGE} from '../_shared/taskReminderCore.js'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
const value=async(query:any)=>{const result=await query;if(result.error)throw result.error;return result.data}

Deno.serve(async(request)=>{
  if(request.method!=='POST')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405)
  const key=Deno.env.get('TASK_REMINDER_WORKER_KEY')||''
  if(!key||request.headers.get('X-Task-Reminder-Worker-Key')!==key)return json({ok:false,code:'UNAUTHORIZED'},401)
  let body:any
  try{body=await request.json()}catch{return json({ok:false,code:'INVALID_JSON'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(name=>!['source','reminder_id'].includes(name)))return json({ok:false,code:'INVALID_PAYLOAD'},400)
  if(body.reminder_id!=null&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.reminder_id))return json({ok:false,code:'INVALID_REMINDER_ID'},400)
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),token=Deno.env.get('META_ACCESS_TOKEN')||''
  if(!url||!service||!token)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const admin=createClient(url,service,{auth:{persistSession:false}})
  const store={
    task:(row:any)=>value(admin.from('crm_tasks').select('id,organization_id,title,status,assigned_to,due_date,due_time,archived_at,reminder_enabled,reminder_minutes_before').eq('id',row.task_id).eq('organization_id',row.organization_id).maybeSingle()),
    connection:(organizationId:string)=>value(admin.from('whatsapp_connections').select('id,phone_number_id,waba_id').eq('organization_id',organizationId).in('status',['active','degraded']).order('updated_at',{ascending:false}).limit(1).maybeSingle()),
    template:(organizationId:string,wabaId:string)=>value(admin.from('whatsapp_message_templates').select('name,status,is_active,language,category').eq('organization_id',organizationId).eq('waba_id',wabaId).eq('name',TASK_REMINDER_TEMPLATE).eq('language',TASK_REMINDER_LANGUAGE).maybeSingle()),
    authorize:(row:any)=>value(admin.rpc('authorize_task_reminder',{p_id:row.id,p_claim_token:row.claim_token})),
    finish:async(row:any,patch:any)=>{
      // A confirmed acceptance is recorded even if a task edit cancelled its in-flight reminder.
      const result=await admin.from('task_reminder_outbox').update(patch).eq('id',row.id).eq('organization_id',row.organization_id).eq('claim_token',row.claim_token).in('status',['processing','cancelled']).select('id')
      if(result.error||!result.data?.length)throw result.error||new Error('CLAIM_LOST')
    },
  }
  try{
    const rows=await value(admin.rpc('claim_task_reminders',{p_reminder_id:body.reminder_id||null}))
    const counts:Record<string,number>={claimed:rows.length}
    // Concurrent network I/O prevents a batch of 50 timeouts exhausting the edge runtime.
    for(let offset=0;offset<rows.length;offset+=10){
      await Promise.all(rows.slice(offset,offset+10).map(async(row:any)=>{
        try{const status=await processTaskReminder({store,row,token,graphVersion:Deno.env.get('GRAPH_API_VERSION')||'v23.0'});counts[status]=(counts[status]||0)+1}
        catch{counts.storage_failed=(counts.storage_failed||0)+1;console.log(JSON.stringify({event:'task_reminder_storage_failed',reminder_id:row.id}))}
      }))
    }
    return json({ok:true,...counts})
  }catch{return json({ok:false,code:'REMINDER_CLAIM_FAILED'},500)}
})
