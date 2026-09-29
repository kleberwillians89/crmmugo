import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {normalizePhoneForWhatsApp} from '../_shared/internalCommandCore.js'
import {getOperationalWindow} from '../_shared/operationalCalendar.js'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)
const TEMPLATE='mugo_alerta_pagamento_pendente',LANGUAGE='pt_BR'

async function processInstallment(admin:any,row:any){
  const phone=normalizePhoneForWhatsApp(row.clients?.billing_contact_phone||row.clients?.phone)
  const key=`collection-due:${row.organization_id}:${row.id}:${row.due_date}`
  const existing=await admin.from('whatsapp_collection_alerts').select('*').eq('organization_id',row.organization_id).eq('installment_id',row.id).eq('notification_type','due_date_collection').eq('due_date_snapshot',row.due_date).maybeSingle()
  if(existing.error)throw existing.error
  if(!phone){
    // Sem telefone válido nunca envia — mas precisa deixar rastro visível (antes retornava false em
    // silêncio, indistinguível de "já enviado", e o time não tinha como saber que faltava cadastro).
    if(!existing.data){
      const reserved=await admin.from('whatsapp_collection_alerts').insert({organization_id:row.organization_id,client_id:row.client_id,installment_id:row.id,contract_id:row.contract_id,wa_id:'sem-telefone',template_name:TEMPLATE,template_language:LANGUAGE,notification_type:'due_date_collection',due_date_snapshot:row.due_date,collection_stage:'failed',action:'template_send_failed',status:'failed',origin:'collection',attempts:1,error_code:'NO_PHONE',error_message:'Cliente sem telefone de cobrança válido (billing_contact_phone/phone).',sanitized_payload:{source:'collection'}})
      if(reserved.error&&reserved.error.code!=='23505')throw reserved.error
    }
    return false
  }
  if(existing.data?.provider_message_id||existing.data?.status==='sending'&&existing.data?.action==='template_send_unconfirmed')return false
  if(existing.data?.status==='failed'&&new Date(existing.data.next_attempt_at||0).getTime()>Date.now())return false
  if(existing.data?.status==='sending'&&Date.now()-new Date(existing.data.updated_at||existing.data.created_at).getTime()<5*60_000)return false
  const connection=await admin.from('whatsapp_connections').select('id,phone_number_id,waba_id').eq('organization_id',row.organization_id).in('status',['active','degraded']).order('updated_at',{ascending:false}).limit(1).maybeSingle()
  if(connection.error||!connection.data)throw connection.error||new Error('Conexão WhatsApp indisponível.')
  const template=await admin.from('whatsapp_message_templates').select('id,status,is_active,components').eq('organization_id',row.organization_id).eq('waba_id',connection.data.waba_id).eq('name',TEMPLATE).eq('language',LANGUAGE).maybeSingle()
  if(template.error)throw template.error
  if(!template.data||String(template.data.status).toUpperCase()!=='APPROVED'||template.data.is_active===false)throw new Error('Template de cobrança não está aprovado e ativo.')
  const now=new Date().toISOString(),name=clean(row.clients?.contact_name||row.clients?.trade_name||row.clients?.company_name,120).split(/\s+/)[0]||'Cliente'
  // Não sobrescreve um display_name já definido (ex.: apelido interno) — só preenche na primeira vez.
  const existingContact=await admin.from('whatsapp_contacts').select('display_name').eq('connection_id',connection.data.id).eq('wa_id',phone).maybeSingle()
  const keepExistingName=Boolean(existingContact.data?.display_name)
  const contact=await admin.from('whatsapp_contacts').upsert({organization_id:row.organization_id,connection_id:connection.data.id,wa_id:phone,client_id:row.client_id,...(keepExistingName?{}:{display_name:row.clients?.trade_name||row.clients?.company_name}),last_seen_at:now},{onConflict:'connection_id,wa_id'}).select('id').single()
  if(contact.error)throw contact.error
  const conversation=await admin.from('whatsapp_conversations').upsert({organization_id:row.organization_id,connection_id:connection.data.id,contact_id:contact.data.id,wa_id:phone,status:'open',queue:'finance_collection',initiated_by:'business',last_outbound_source:'collection'},{onConflict:'connection_id,wa_id'}).select('id').single()
  if(conversation.error)throw conversation.error
  const components=[{type:'body',parameters:[{type:'text',text:name}]}]
  let alert=existing.data
  if(!alert){const reserved=await admin.from('whatsapp_collection_alerts').insert({organization_id:row.organization_id,client_id:row.client_id,installment_id:row.id,contract_id:row.contract_id,wa_id:phone,recipient:phone,template_name:TEMPLATE,template_language:LANGUAGE,template_status:'APPROVED',notification_type:'due_date_collection',due_date_snapshot:row.due_date,collection_stage:'sending',action:'template_send_requested',status:'sending',origin:'collection',attempts:1,sanitized_payload:{idempotency_key:key,source:'collection'}}).select('*').single();if(reserved.error){if(reserved.error.code==='23505')return false;throw reserved.error};alert=reserved.data}
  else{const claimed=await admin.from('whatsapp_collection_alerts').update({status:'sending',collection_stage:'sending',action:'template_send_requested',attempts:Number(alert.attempts||0)+1,error_code:null,error_message:null}).eq('id',alert.id).in('status',['failed','sending']).select('*').maybeSingle();if(claimed.error||!claimed.data)return false;alert=claimed.data}
  const prior=await admin.from('whatsapp_messages').select('id,provider_message_id,status').eq('connection_id',connection.data.id).eq('idempotency_key',key).maybeSingle()
  if(prior.error)throw prior.error
  if(prior.data?.provider_message_id){await admin.from('whatsapp_collection_alerts').update({status:'sent',collection_stage:'waiting_customer',action:'template_sent',provider_message_id:prior.data.provider_message_id,sent_at:now}).eq('id',alert.id);return true}
  let message=prior.data
  if(!message){const reserved=await admin.from('whatsapp_messages').insert({organization_id:row.organization_id,connection_id:connection.data.id,conversation_id:conversation.data.id,idempotency_key:key,direction:'out',message_type:'template',status:'queued',template_name:TEMPLATE,template_language:LANGUAGE,template_components:components,text_content:`Template ${TEMPLATE}`}).select('id').single();if(reserved.error)throw reserved.error;message=reserved.data}
  const token=Deno.env.get('META_ACCESS_TOKEN')||''
  if(!token)throw new Error('META_ACCESS_TOKEN ausente.')
  let response:Response
  try{response=await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION')||'v23.0'}/${connection.data.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:phone,type:'template',template:{name:TEMPLATE,language:{code:LANGUAGE},components}}),signal:AbortSignal.timeout(20_000)})}
  catch{await admin.from('whatsapp_collection_alerts').update({action:'template_send_unconfirmed',error_code:'SEND_OUTCOME_UNKNOWN',error_message:'Envio reservado; resultado da Meta desconhecido.'}).eq('id',alert.id);throw new Error('Resultado do envio desconhecido; não reenviar automaticamente.')}
  const body=await response.json().catch(()=>({})),providerId=clean(body?.messages?.[0]?.id,240)
  if(!response.ok||!providerId){await Promise.all([admin.from('whatsapp_messages').update({status:'failed',failed_at:now,error_code:String(response.status),error_message:clean(body?.error?.message)}).eq('id',message.id),admin.from('whatsapp_collection_alerts').update({status:'failed',collection_stage:'failed',action:'template_send_failed',next_attempt_at:new Date(Date.now()+5*60_000).toISOString(),error_code:String(response.status),error_message:clean(body?.error?.message)}).eq('id',alert.id)]);return false}
  await Promise.all([admin.from('whatsapp_messages').update({provider_message_id:providerId,status:'accepted',sent_at:now}).eq('id',message.id),admin.from('whatsapp_collection_alerts').update({provider_message_id:providerId,status:'sent',collection_stage:'waiting_customer',action:'template_sent',sent_at:now,error_code:null,error_message:null}).eq('id',alert.id),admin.from('whatsapp_conversations').update({last_message_at:now,last_outbound_at:now,last_outbound_source:'collection',queue:'finance_collection',initiated_by:'business'}).eq('id',conversation.data.id)])
  return true
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({ok:false},405)
  const expected=Deno.env.get('COLLECTION_WORKER_KEY')||''
  if(!expected||request.headers.get('X-Collection-Worker-Key')!==expected)return json({ok:false,code:'UNAUTHORIZED'},401)
  const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  if(!url||!service)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const admin=createClient(url,service,{auth:{persistSession:false}}),settings=await admin.from('organization_settings').select('organization_id,collection_dispatch_enabled,collection_dispatch_time').eq('collection_dispatch_enabled',true)
  if(settings.error)return json({ok:false,code:'SETTINGS_READ_FAILED'},500)
  let eligible=0,sent=0
  for(const org of settings.data||[]){
    const window=await getOperationalWindow(admin,org.organization_id)
    if(!window.open||window.localTime<clean(org.collection_dispatch_time||'08:15',5))continue
    const due=await admin.from('invoice_installments').select('id,organization_id,client_id,contract_id,due_date,status,received_amount,clients(company_name,trade_name,contact_name,phone,billing_contact_phone)').eq('organization_id',org.organization_id).lte('due_date',window.localDate).in('status',['pending','overdue']).eq('received_amount',0).is('paid_at',null).order('due_date').limit(50)
    if(due.error)throw due.error
    for(const row of due.data||[]){eligible+=1;try{if(await processInstallment(admin,row))sent+=1}catch(error){console.log(JSON.stringify({event:'collection_dispatch_failed',installment_id:row.id,error:clean((error as any)?.message)}))}}
  }
  return json({ok:true,eligible,sent})
})
