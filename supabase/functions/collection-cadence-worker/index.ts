// Régua de cobrança automática (cron a cada minuto, mesma chave do collection-notification-worker).
// Dia do vencimento: 9h, 12h e 18h. Dias seguintes: 9h, até o pagamento (manual ou Asaas), até o
// cliente tocar em "Já realizei o pagamento" ou até o limite de dias de atraso. Horários configuráveis.
// Antes de cada envio garante a cobrança no Asaas (multa e juros calculados por lá); o link aparece
// quando o cliente toca em "Consultar cobrança".
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {getOperationalWindow} from '../_shared/operationalCalendar.js'
import {collectionPhoneOptions} from '../_shared/collectionCore.js'
import {currentCollectionSlot,paymentClaimBlocks} from '../_shared/collectionCadenceCore.js'
import {asaasConfigFromEnv,ensureAsaasCharge} from '../_shared/asaasCore.js'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)
const TEMPLATE='mugo_alerta_pagamento_pendente',LANGUAGE='pt_BR'
const INSTALLMENT_FIELDS='id,organization_id,client_id,contract_id,due_date,amount,status,received_amount,paid_at,payment_url,clients(company_name,trade_name,contact_name,phone,billing_contact_name,billing_contact_phone)'

async function sendTemplate(admin:any,org:string,row:any,target:any,slotKey:string,connection:any){
  const phone=target.phone.replace(/\D/g,''),now=new Date().toISOString(),key=`collection-cadence:${row.id}:${slotKey}`
  const name=clean(target.name,120).split(/\s+/)[0]||'Cliente'
  const existingContact=await admin.from('whatsapp_contacts').select('display_name').eq('connection_id',connection.id).eq('wa_id',phone).maybeSingle()
  const contact=await admin.from('whatsapp_contacts').upsert({organization_id:org,connection_id:connection.id,wa_id:phone,client_id:row.client_id,...(existingContact.data?.display_name?{}:{display_name:row.clients?.trade_name||row.clients?.company_name}),last_seen_at:now},{onConflict:'connection_id,wa_id'}).select('id').single()
  if(contact.error)throw contact.error
  const conversation=await admin.from('whatsapp_conversations').upsert({organization_id:org,connection_id:connection.id,contact_id:contact.data.id,wa_id:phone,status:'open',queue:'finance_collection',initiated_by:'business',last_outbound_source:'collection'},{onConflict:'connection_id,wa_id'}).select('id').single()
  if(conversation.error)throw conversation.error
  const components=[{type:'body',parameters:[{type:'text',text:name}]}]
  const message=await admin.from('whatsapp_messages').insert({organization_id:org,connection_id:connection.id,conversation_id:conversation.data.id,idempotency_key:key,direction:'out',message_type:'template',status:'queued',template_name:TEMPLATE,template_language:LANGUAGE,template_components:components,text_content:`Template ${TEMPLATE}`}).select('id').single()
  if(message.error)throw message.error
  const token=Deno.env.get('META_ACCESS_TOKEN')||''
  if(!token)throw Object.assign(new Error('META_ACCESS_TOKEN ausente.'),{code:'META_CONFIGURATION_MISSING'})
  let response:Response
  try{response=await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION')||'v23.0'}/${connection.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:phone,type:'template',template:{name:TEMPLATE,language:{code:LANGUAGE},components}}),signal:AbortSignal.timeout(20_000)})}
  catch{
    // Resultado desconhecido: nunca reenvia sozinho (o horário fica marcado como falho, sem retry).
    await admin.from('whatsapp_messages').update({status:'failed',failed_at:now,error_code:'SEND_OUTCOME_UNKNOWN',error_message:'Resultado da Meta desconhecido.'}).eq('id',message.data.id)
    throw Object.assign(new Error('Resultado do envio desconhecido.'),{code:'SEND_OUTCOME_UNKNOWN'})
  }
  const body=await response.json().catch(()=>({})),providerId=clean(body?.messages?.[0]?.id,240)
  if(!response.ok||!providerId){
    await admin.from('whatsapp_messages').update({status:'failed',failed_at:now,error_code:String(response.status),error_message:clean(body?.error?.message)}).eq('id',message.data.id)
    throw Object.assign(new Error(clean(body?.error?.message)||'A Meta recusou o envio.'),{code:`META_${response.status}`})
  }
  await Promise.all([
    admin.from('whatsapp_messages').update({provider_message_id:providerId,status:'accepted',sent_at:now}).eq('id',message.data.id),
    admin.from('whatsapp_conversations').update({last_message_at:now,last_outbound_at:now,last_outbound_source:'collection',queue:'finance_collection',initiated_by:'business'}).eq('id',conversation.data.id),
  ])
  return providerId
}

async function processInstallment(admin:any,org:string,row:any,slot:any,connection:any,asaas:any){
  const reserved=await admin.from('collection_dispatch_log').insert({organization_id:org,installment_id:row.id,client_id:row.client_id,slot_key:slot.slotKey,status:'sending'}).select('id').single()
  if(reserved.error){if(reserved.error.code==='23505')return 'already';throw reserved.error}
  const logId=reserved.data.id
  const finish=(values:any)=>admin.from('collection_dispatch_log').update(values).eq('id',logId)
  try{
    const contacts=await admin.from('client_contacts').select('name,phone,is_primary,active').eq('organization_id',org).eq('client_id',row.client_id).eq('active',true)
    if(contacts.error)throw contacts.error
    const target=collectionPhoneOptions(row.clients||{},contacts.data||[])[0]
    if(!target){await finish({status:'skipped',error_code:'NO_PHONE',error_message:'Cliente sem WhatsApp válido.'});return 'no_phone'}
    let paymentUrl=row.payment_url||null,asaasError=null
    if(asaas){
      try{paymentUrl=(await ensureAsaasCharge({admin,org,installmentId:row.id,config:asaas})).payment_url||paymentUrl}
      catch(error){asaasError=clean((error as any)?.message,300)}
    }
    const providerId=await sendTemplate(admin,org,row,target,slot.slotKey,connection)
    await finish({status:'sent',provider_message_id:providerId,phone:target.phone,contact_name:target.name,payment_url:paymentUrl,sent_at:new Date().toISOString(),error_code:asaasError?'ASAAS_WARNING':null,error_message:asaasError})
    return 'sent'
  }catch(error){
    await finish({status:'failed',error_code:clean((error as any)?.code,80)||'SEND_FAILED',error_message:clean((error as any)?.message,500)})
    throw error
  }
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({ok:false},405)
  const expected=Deno.env.get('COLLECTION_WORKER_KEY')||''
  if(!expected||request.headers.get('X-Collection-Worker-Key')!==expected)return json({ok:false,code:'UNAUTHORIZED'},401)
  const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  if(!url||!service)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const admin=createClient(url,service,{auth:{persistSession:false}})
  let asaas:any=null
  try{asaas=asaasConfigFromEnv((name:string)=>Deno.env.get(name)||'')}catch{asaas=null}
  const settings=await admin.from('organization_settings').select('organization_id,collection_due_day_times,collection_overdue_times,collection_max_overdue_days').eq('collection_cadence_enabled',true)
  if(settings.error)return json({ok:false,code:'SETTINGS_READ_FAILED'},500)
  const result={eligible:0,sent:0,failed:0}
  for(const org of settings.data||[]){
    const window=await getOperationalWindow(admin,org.organization_id)
    if(!window.businessDay)continue
    const oldest=new Date(Date.parse(`${window.localDate}T12:00:00Z`)-Number(org.collection_max_overdue_days??15)*86_400_000).toISOString().slice(0,10)
    const due=await admin.from('invoice_installments').select(INSTALLMENT_FIELDS).eq('organization_id',org.organization_id).lte('due_date',window.localDate).gte('due_date',oldest).in('status',['pending','overdue']).eq('received_amount',0).is('paid_at',null).order('due_date').limit(100)
    if(due.error)throw due.error
    const rows=(due.data||[]).map((row:any)=>({row,slot:currentCollectionSlot({dueDate:row.due_date,today:window.localDate,now:window.localTime,dueDayTimes:org.collection_due_day_times,overdueTimes:org.collection_overdue_times,maxOverdueDays:org.collection_max_overdue_days})})).filter((item:any)=>item.slot)
    if(!rows.length)continue
    const claims=await admin.from('whatsapp_conversation_events').select('details,created_at').eq('organization_id',org.organization_id).eq('event_type','payment_claimed').gte('created_at',`${oldest}T00:00:00Z`)
    if(claims.error)throw claims.error
    const connection=await admin.from('whatsapp_connections').select('id,phone_number_id,waba_id').eq('organization_id',org.organization_id).in('status',['active','degraded']).order('updated_at',{ascending:false}).limit(1).maybeSingle()
    if(connection.error||!connection.data){console.log(JSON.stringify({event:'collection_cadence_no_connection',organization_id:org.organization_id}));continue}
    const template=await admin.from('whatsapp_message_templates').select('status,is_active').eq('organization_id',org.organization_id).eq('waba_id',connection.data.waba_id).eq('name',TEMPLATE).eq('language',LANGUAGE).maybeSingle()
    if(template.error||!template.data||String(template.data.status).toUpperCase()!=='APPROVED'||template.data.is_active===false){console.log(JSON.stringify({event:'collection_cadence_template_unavailable',organization_id:org.organization_id}));continue}
    for(const {row,slot} of rows){
      if(paymentClaimBlocks(claims.data,row))continue
      result.eligible+=1
      try{const outcome=await processInstallment(admin,org.organization_id,row,slot,connection.data,asaas);if(outcome==='sent')result.sent+=1}
      catch(error){result.failed+=1;console.log(JSON.stringify({event:'collection_cadence_failed',installment_id:row.id,slot:slot.slotKey,error:clean((error as any)?.message)}))}
    }
  }
  return json({ok:true,...result})
})
