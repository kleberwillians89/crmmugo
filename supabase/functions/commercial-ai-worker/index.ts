// Atendimento comercial estruturado. Executa fora do webhook e só em organizações opt-in.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {brazilianPhoneCandidates} from '../_shared/internalCommandCore.js'
import {COMMERCIAL_INTENTS,COMMERCIAL_SYSTEM_PROMPT,assessCommercialTemperature,buildCommercialSummary,classifyConversationKind,defaultCommercialDecision,enforceCommercialHandoffPolicy,enforceCommercialResponsePolicy,hasMinimumCommercialContext,qualificationClassification,validateCommercialDecision} from '../_shared/commercialAgentCore.js'
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
const clean=(value:unknown,max=1000)=>String(value??'').trim().slice(0,max)
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const tomorrow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86_400_000))
const asDate=(value:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(clean(value,40))?clean(value,40).slice(0,10):null
const allowedStage=new Set(['new_lead','in_service','qualifying','qualified','meeting','proposal','negotiation','won','lost'])
const stageRank=new Map(['new_lead','in_service','qualifying','qualified','meeting','proposal','negotiation','won','lost'].map((stage,index)=>[stage,index]))
const temperatureRank=new Map([['cold',0],['warm',1],['hot',2]])
const safeArray=(value:any,allowed?:Set<string>)=>Array.isArray(value)?[...new Set(value.map((item:any)=>clean(item,80)).filter((item:string)=>item&&(!allowed||allowed.has(item))))].slice(0,12):[]
const meaningfulPatch=(value:any)=>Object.fromEntries(Object.entries(value||{}).filter(([,item])=>item!==null&&item!==undefined&&item!==''&&(!Array.isArray(item)||item.length>0)))
const mergeInterests=(...values:any[])=>{const merged=safeArray(values.flat(),new Set(COMMERCIAL_INTENTS));return merged.length>1?merged.filter(item=>item!=='OTHER'):merged}
const textContent=(body:any)=>body?.output_text||(body?.output||[]).flatMap((item:any)=>item?.content||[]).find((item:any)=>item?.type==='output_text')?.text

async function askOpenAI(event:any,messages:any[],qualification:any,opportunity:any,client:any,settings:any){
  const key=Deno.env.get('OPENAI_API_KEY')||'',model=Deno.env.get('COMMERCIAL_AI_MODEL')||Deno.env.get('OPENAI_MODEL')||''
  if(!key||!model)return null
  const schema={type:'object',additionalProperties:false,properties:{intents:{type:'array',items:{type:'string',enum:COMMERCIAL_INTENTS}},response:{type:'string'},contact_updates:{type:'object',additionalProperties:false,properties:{company_name:{type:['string','null']},contact_name:{type:['string','null']},email:{type:['string','null']},contact_role:{type:['string','null']}},required:['company_name','contact_name','email','contact_role']},opportunity_updates:{type:'object',additionalProperties:false,properties:{stage:{type:['string','null']},main_problem:{type:['string','null']},timeline:{type:['string','null']},urgency:{type:['string','null']},budget:{type:['number','null']},estimated_value:{type:['number','null']},next_action:{type:['string','null']},next_action_at:{type:['string','null']},service_interests:{type:'array',items:{type:'string',enum:COMMERCIAL_INTENTS}}},required:['stage','main_problem','timeline','urgency','budget','estimated_value','next_action','next_action_at','service_interests']},qualification_updates:{type:'object',additionalProperties:false,properties:{current_situation:{type:['string','null']},main_problem:{type:['string','null']},objective:{type:['string','null']},urgency:{type:['string','null']},budget:{type:['number','null']},decision_maker:{type:['boolean','null']},timeline:{type:['string','null']},qualified:{type:'boolean'},needs_human:{type:'boolean'},next_action:{type:['string','null']},reasons:{type:'array',items:{type:'string'}},missing_fields:{type:'array',items:{type:'string'}}},required:['current_situation','main_problem','objective','urgency','budget','decision_maker','timeline','qualified','needs_human','next_action','reasons','missing_fields']},summary:{type:'string'},create_task:{type:'boolean'},task:{type:['object','null'],additionalProperties:false,properties:{title:{type:'string'},priority:{type:'string',enum:['low','medium','high','critical']},due_date:{type:['string','null']},notes:{type:['string','null']}},required:['title','priority','due_date','notes']},handoff:{type:'boolean'},handoff_reason:{type:['string','null']},confidence:{type:'number',minimum:0,maximum:1}},required:['intents','response','contact_updates','opportunity_updates','qualification_updates','summary','create_task','task','handoff','handoff_reason','confidence']}
  const context={client:{company_name:client?.company_name||null,contact_name:client?.contact_name||null,contact_role:client?.contact_role||null},qualification:qualification||{},opportunity:opportunity||{},messages:messages.map(row=>({direction:row.direction,text:clean(row.text_content,1000),at:row.created_at})),authorized_pricing:settings.authorized_pricing||{}}
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:[{role:'system',content:`${COMMERCIAL_SYSTEM_PROMPT}\n${clean(settings.prompt_override,3000)}`},{role:'user',content:JSON.stringify(context)}],text:{format:{type:'json_schema',name:'commercial_decision',strict:true,schema}}}),signal:AbortSignal.timeout(25_000)})
  if(!response.ok)throw Object.assign(new Error(`OpenAI respondeu ${response.status}.`),{code:response.status===429||response.status>=500?'AI_TEMPORARY_ERROR':'AI_REQUEST_FAILED'})
  const body=await response.json();return validateCommercialDecision(JSON.parse(clean(textContent(body),12000)||'{}'))
}

async function sendMessage(admin:any,event:any,conversation:any,text:string){
  const token=Deno.env.get('META_ACCESS_TOKEN')||'';if(!token)throw Object.assign(new Error('Meta não configurada.'),{code:'META_CONFIGURATION_MISSING'})
  const connection=await admin.from('whatsapp_connections').select('phone_number_id').eq('id',event.connection_id).eq('organization_id',event.organization_id).single();if(connection.error)throw connection.error
  const key=`commercial-ai:${event.id}`,existing=await admin.from('whatsapp_messages').select('provider_message_id').eq('connection_id',event.connection_id).eq('idempotency_key',key).maybeSingle();if(existing.error)throw existing.error;if(existing.data?.provider_message_id)return existing.data.provider_message_id
  const response=await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION')||'v23.0'}/${connection.data.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:conversation.wa_id,type:'text',text:{preview_url:false,body:text}}),signal:AbortSignal.timeout(20_000)})
  const body=await response.json().catch(()=>({}));if(!response.ok||!body?.messages?.[0]?.id)throw Object.assign(new Error(clean(body?.error?.message)||'Falha no envio comercial.'),{code:response.status===429||response.status>=500?'META_TEMPORARY_ERROR':'META_SEND_FAILED'})
  const saved=await admin.from('whatsapp_messages').insert({organization_id:event.organization_id,connection_id:event.connection_id,conversation_id:event.conversation_id,provider_message_id:body.messages[0].id,idempotency_key:key,direction:'out',message_type:'text',status:'accepted',text_content:text,sent_at:new Date().toISOString()});if(saved.error&&saved.error.code!=='23505')throw saved.error
  await admin.from('whatsapp_conversations').update({last_message_at:new Date().toISOString(),last_outbound_at:new Date().toISOString()}).eq('id',event.conversation_id).eq('organization_id',event.organization_id)
  return body.messages[0].id
}

async function resolveClient(admin:any,event:any,contact:any){
  if(contact.client_id){const current=await admin.from('clients').select('*').eq('id',contact.client_id).eq('organization_id',event.organization_id).single();if(!current.error)return{client:current.data,created:false}}
  const phones=brazilianPhoneCandidates(contact.wa_id);const existing=await admin.from('clients').select('*').eq('organization_id',event.organization_id).in('phone',phones).neq('status','archived').limit(2);if(existing.error)throw existing.error
  let client=existing.data?.[0],created=false
  if(!client){const display=clean(contact.display_name||contact.profile_name,240)||`Lead WhatsApp • ${contact.wa_id.slice(-4)}`;const inserted=await admin.from('clients').insert({organization_id:event.organization_id,company_name:display,contact_name:display,phone:contact.wa_id,lead_source:contact.source||'WHATSAPP_ORGANIC',status:'lead'}).select('*').single();if(inserted.error)throw inserted.error;client=inserted.data;created=true}
  await admin.from('whatsapp_contacts').update({client_id:client.id}).eq('id',contact.id).eq('organization_id',event.organization_id)
  return{client,created}
}

async function processEvent(admin:any,event:any){
  const claim=await admin.from('commercial_ai_events').update({status:'processing',attempts:Number(event.attempts||0)+1}).eq('id',event.id).in('status',['pending','failed']).select('id').maybeSingle();if(claim.error||!claim.data)return false
  try{
    const [conversationResult,settingsResult]=await Promise.all([
      admin.from('whatsapp_conversations').select('*,whatsapp_contacts(*)').eq('id',event.conversation_id).eq('organization_id',event.organization_id).single(),
      admin.from('commercial_settings').select('*').eq('organization_id',event.organization_id).maybeSingle(),
    ])
    if(conversationResult.error||settingsResult.error)throw conversationResult.error||settingsResult.error
    if(settingsResult.data?.ai_mode!=='controlled_auto'){
      await admin.from('commercial_ai_events').update({status:'skipped',decision:{reason:'commercial_ai_disabled'},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id).eq('organization_id',event.organization_id)
      return true
    }

    const conversation=conversationResult.data,contact=conversation.whatsapp_contacts
    const resolvedClient=await resolveClient(admin,event,contact);let client=resolvedClient.client
    let commercialOwnerProfileId=null
    if(settingsResult.data.commercial_owner_id){
      const owner=await admin.from('team_members').select('auth_profile_id').eq('id',settingsResult.data.commercial_owner_id).eq('organization_id',event.organization_id).maybeSingle()
      if(owner.error)throw owner.error
      commercialOwnerProfileId=owner.data?.auth_profile_id||null
    }

    let opportunity=(await admin.from('commercial_opportunities').select('*').eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).not('stage','in','(won,lost)').maybeSingle()).data
    if(!opportunity){
      const utm=contact.utm||{}
      const created=await admin.from('commercial_opportunities').insert({organization_id:event.organization_id,client_id:client.id,conversation_id:event.conversation_id,assigned_to:settingsResult.data.commercial_owner_id||null,name:client.company_name,source:contact.source||client.lead_source||'WHATSAPP_ORGANIC',campaign:contact.campaign||null,ad_name:contact.ad_name||null,utm_source:utm.utm_source||null,utm_medium:utm.utm_medium||null,utm_campaign:utm.utm_campaign||null,utm_content:utm.utm_content||null,stage:'in_service',last_interaction_at:new Date().toISOString()}).select('*').single()
      if(created.error)throw created.error
      opportunity=created.data
      await admin.from('whatsapp_conversations').update({opportunity_id:opportunity.id}).eq('id',event.conversation_id).eq('organization_id',event.organization_id)
    }

    const [qResult,history]=await Promise.all([
      admin.from('commercial_qualifications').select('*').eq('opportunity_id',opportunity.id).maybeSingle(),
      admin.from('whatsapp_messages').select('direction,text_content,created_at').eq('conversation_id',event.conversation_id).order('created_at',{ascending:false}).limit(14),
    ])
    if(qResult.error||history.error)throw qResult.error||history.error
    const qualification=qResult.data||{},messages=(history.data||[]).reverse(),inbound=messages.filter((row:any)=>row.direction==='in').at(-1)?.text_content||''
    const decisionContext={qualification,opportunity,client,messages,authorized_pricing:settingsResult.data.authorized_pricing||{}}
    let decision=await askOpenAI(event,messages,qualification,opportunity,client,settingsResult.data).catch(()=>null)||defaultCommercialDecision(inbound,decisionContext)
    decision=validateCommercialDecision(decision)||defaultCommercialDecision(inbound,decisionContext)
    decision=enforceCommercialHandoffPolicy(decision,inbound,decisionContext)
    decision=enforceCommercialResponsePolicy(decision,inbound,decisionContext)

    const contactPatch:any={}
    for(const key of ['contact_name','email'])if(decision.contact_updates[key])contactPatch[key]=clean(decision.contact_updates[key],240)
    if(decision.contact_updates.company_name)contactPatch.company_name=clean(decision.contact_updates.company_name,240)
    if(resolvedClient.created&&contactPatch.email){
      const emailMatch=await admin.from('clients').select('*').eq('organization_id',event.organization_id).eq('email',contactPatch.email.toLowerCase()).neq('id',client.id).neq('status','archived').limit(2)
      if(emailMatch.error)throw emailMatch.error
      if(emailMatch.data?.length===1){
        const originalId=client.id;client=emailMatch.data[0]
        await Promise.all([
          admin.from('whatsapp_contacts').update({client_id:client.id}).eq('id',contact.id).eq('organization_id',event.organization_id),
          admin.from('commercial_opportunities').update({client_id:client.id,name:client.company_name}).eq('id',opportunity.id).eq('organization_id',event.organization_id),
          admin.from('clients').update({status:'archived',notes:`Consolidado automaticamente no cliente ${client.id} por e-mail idêntico durante qualificação.`}).eq('id',originalId).eq('organization_id',event.organization_id),
        ])
      }
    }
    if(Object.keys(contactPatch).length){const updatedClient=await admin.from('clients').update(contactPatch).eq('id',client.id).eq('organization_id',event.organization_id);if(updatedClient.error)throw updatedClient.error}

    const qualificationPatch=meaningfulPatch(decision.qualification_updates)
    const interests=mergeInterests(qualification.service_interest,opportunity.service_interests,decision.intents,decision.opportunity_updates?.service_interests)
    const leadKind=classifyConversationKind(inbound,{hasExistingClient:!resolvedClient.created,previousKind:opportunity.lead_kind})
    const q:any={...qualification,...qualificationPatch,organization_id:event.organization_id,opportunity_id:opportunity.id,company_name:decision.contact_updates.company_name||qualification.company_name||null,contact_name:decision.contact_updates.contact_name||qualification.contact_name||client.contact_name,service_interest:interests,qualified:Boolean(qualification.qualified||qualificationPatch.qualified),reasons:safeArray(qualificationPatch.reasons||qualification.reasons),missing_fields:safeArray(qualificationPatch.missing_fields||qualification.missing_fields)}
    const assessedTemperature=assessCommercialTemperature({text:inbound,interests,qualification:q,leadKind:leadKind.kind})
    const temperature=(temperatureRank.get(opportunity.temperature)??-1)>(temperatureRank.get(assessedTemperature.temperature)??-1)?{temperature:opportunity.temperature,reason:opportunity.temperature_reason||assessedTemperature.reason}:assessedTemperature
    if(!decision.handoff&&temperature.temperature==='hot'&&hasMinimumCommercialContext(q)){decision.handoff=true;decision.handoff_reason='hot_lead_with_context'}
    if(!decision.handoff&&Number(decision.confidence)<.45){decision.handoff=true;decision.handoff_reason='low_confidence'}
    if(decision.handoff&&!/encaminhar|respons.vel continuar/i.test(decision.response))decision.response='Certo. Vou encaminhar o contexto desta conversa para a pessoa responsável continuar com você.'
    q.needs_human=Boolean(decision.handoff);q.classification=qualificationClassification(q)
    delete q.id;delete q.created_at;delete q.updated_at
    const savedQ=await admin.from('commercial_qualifications').upsert(q,{onConflict:'opportunity_id'});if(savedQ.error)throw savedQ.error

    const ou=decision.opportunity_updates||{}
    const proposedStage=decision.handoff?(q.qualified?'qualified':'qualifying'):(allowedStage.has(ou.stage)?ou.stage:'qualifying')
    const stage=(stageRank.get(proposedStage)??0)>=(stageRank.get(opportunity.stage)??0)?proposedStage:opportunity.stage
    const nextAction=clean(ou.next_action||q.next_action,500)||opportunity.next_action||null
    const nextActionAt=clean(ou.next_action_at,50)||opportunity.next_action_at||null
    const summary=buildCommercialSummary({client,qualification:q,opportunity:{...opportunity,...ou,next_action:nextAction},interests})||decision.summary||opportunity.conversation_summary||clean(inbound,1000)
    const opportunityPatch:any={stage,temperature:temperature.temperature,temperature_reason:temperature.reason,lead_kind:leadKind.kind,lead_kind_reason:leadKind.reason,service_interests:interests,contact_role:clean(decision.contact_updates.contact_role,240)||opportunity.contact_role||null,main_problem:clean(ou.main_problem,1000)||opportunity.main_problem||null,timeline:clean(ou.timeline,300)||opportunity.timeline||null,urgency:clean(ou.urgency,80)||opportunity.urgency||null,budget:Number.isFinite(ou.budget)?ou.budget:opportunity.budget??null,estimated_value:Number.isFinite(ou.estimated_value)?ou.estimated_value:opportunity.estimated_value??null,next_action:nextAction,next_action_at:nextActionAt,conversation_summary:summary,qualification_reason:(q.reasons||[]).join(' · ')||opportunity.qualification_reason||null,last_interaction_at:new Date().toISOString()}
    const changed=await admin.from('commercial_opportunities').update(opportunityPatch).eq('id',opportunity.id).eq('organization_id',event.organization_id);if(changed.error)throw changed.error
    const savedSummary=await admin.from('conversation_summaries').upsert({organization_id:event.organization_id,conversation_id:event.conversation_id,opportunity_id:opportunity.id,summary,structured_data:{intents:interests,qualification:q,temperature,lead_kind:leadKind},message_count:messages.length,last_message_at:new Date().toISOString()},{onConflict:'conversation_id'});if(savedSummary.error)throw savedSummary.error

    const followupRef=`commercial-followup:${opportunity.id}`
    const existingFollowup=await admin.from('crm_tasks').select('id,status').eq('organization_id',event.organization_id).eq('source_ref',followupRef).maybeSingle();if(existingFollowup.error)throw existingFollowup.error
    const followupChanged=clean(nextAction)!==clean(opportunity.next_action)||clean(nextActionAt)!==clean(opportunity.next_action_at)
    if(!decision.handoff&&!['won','lost'].includes(stage)&&leadKind.kind==='new_business'&&nextAction&&(!existingFollowup.data||followupChanged)){
      const followup=await admin.from('crm_tasks').upsert({organization_id:event.organization_id,title:`FOLLOW-UP — ${client.contact_name||client.company_name}`,status:'pending',completed_at:null,priority:'medium',due_date:asDate(nextActionAt)||tomorrow(),assigned_to:settingsResult.data.commercial_owner_id||null,client_id:client.id,opportunity_id:opportunity.id,task_type:'follow_up',source:'automation',source_ref:followupRef,notes:`Próxima ação: ${nextAction}\nResumo: ${summary}`,metadata:{origin:'automation',sync_external:true,commercial_followup:true,next_action:nextAction}},{onConflict:'organization_id,source_ref'});if(followup.error)throw followup.error
    }else if((decision.handoff||['won','lost'].includes(stage))&&existingFollowup.data&&['pending','in_progress'].includes(existingFollowup.data.status)){
      const cancelled=await admin.from('crm_tasks').update({status:'cancelled',completed_at:null}).eq('id',existingFollowup.data.id).eq('organization_id',event.organization_id);if(cancelled.error)throw cancelled.error
    }

    if(decision.handoff){
      const now=new Date().toISOString(),handoffRef=`commercial-handoff:${opportunity.id}`
      const handoffUpdates=await admin.from('whatsapp_conversations').update({status:'pending',attendance_mode:'human',automation_paused:true,assigned_to:commercialOwnerProfileId||null,assigned_team_member_id:settingsResult.data.commercial_owner_id||null,handoff_reason:decision.handoff_reason||'qualified_commercial_lead',handoff_at:now,assigned_at:settingsResult.data.commercial_owner_id?now:null}).eq('id',event.conversation_id).eq('organization_id',event.organization_id);if(handoffUpdates.error)throw handoffUpdates.error
      const audit=await admin.from('whatsapp_conversation_events').insert({organization_id:event.organization_id,connection_id:event.connection_id,conversation_id:event.conversation_id,event_type:'commercial_handoff',details:{opportunity_id:opportunity.id,reason:decision.handoff_reason,temperature:temperature.temperature}});if(audit.error)throw audit.error
      const taskTitle=`COMERCIAL — Falar com ${client.contact_name||client.company_name}${client.contact_name&&client.company_name?` — ${client.company_name}`:''}`
      const task=await admin.from('crm_tasks').upsert({organization_id:event.organization_id,title:taskTitle,status:'pending',priority:q.urgency==='high'?'high':'medium',due_date:today(),assigned_to:settingsResult.data.commercial_owner_id||null,client_id:client.id,opportunity_id:opportunity.id,task_type:'commercial',source:'automation',source_ref:handoffRef,notes:[`Interesse: ${interests.join(' + ')}`,`Temperatura: ${temperature.temperature} — ${temperature.reason}`,`Telefone: +${contact.wa_id}`,`Origem: ${opportunity.source}`,`Resumo: ${summary}`,`Próxima ação: ${nextAction||'Realizar diagnóstico comercial'}`].join('\n'),metadata:{origin:'automation',sync_external:true,commercial_handoff:true}},{onConflict:'organization_id,source_ref'}).select('id').maybeSingle();if(task.error)throw task.error
      const notify=await admin.from('commercial_notification_outbox').insert({organization_id:event.organization_id,opportunity_id:opportunity.id,conversation_id:event.conversation_id,idempotency_key:handoffRef,payload:{name:client.contact_name||client.company_name,company:client.company_name,interests,source:opportunity.source,temperature:temperature.temperature,urgency:q.urgency||'Não informada',need:ou.main_problem||q.main_problem||q.objective,summary,next_action:nextAction||'Entender escopo e preparar próximo passo',lead_phone:contact.wa_id}});if(notify.error&&notify.error.code!=='23505')throw notify.error
    }

    const providerMessageId=await sendMessage(admin,event,conversation,decision.response)
    await admin.from('commercial_ai_events').update({status:'completed',decision:{...decision,temperature,lead_kind:leadKind,provider_message_id:providerMessageId,opportunity_id:opportunity.id},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id)
    return true
  }catch(error:any){const attempts=Number(event.attempts||0)+1,terminal=attempts>=6||['META_CONFIGURATION_MISSING','AI_REQUEST_FAILED'].includes(error?.code);await admin.from('commercial_ai_events').update({status:terminal?'dead_letter':'failed',next_attempt_at:new Date(Date.now()+Math.min(3600,2**attempts*30)*1000).toISOString(),error_code:clean(error?.code||error?.name,100),error_message:clean(error?.message,500),processed_at:terminal?new Date().toISOString():null}).eq('id',event.id);return false}
}
Deno.serve(async request=>{if(request.method!=='POST')return json({ok:false},405);const expected=Deno.env.get('COMMERCIAL_AI_WORKER_KEY')||'';if(!expected||request.headers.get('X-Commercial-AI-Worker-Key')!==expected)return json({ok:false,code:'UNAUTHORIZED'},401);const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return json({ok:false,code:'CONFIGURATION_MISSING'},503);const admin=createClient(url,key,{auth:{persistSession:false}}),due=await admin.from('commercial_ai_events').select('*').in('status',['pending','failed']).lte('next_attempt_at',new Date().toISOString()).order('created_at').limit(10);if(due.error)return json({ok:false,code:'QUEUE_READ_FAILED'},500);let processed=0;for(const event of due.data||[])if(await processEvent(admin,event))processed+=1;return json({ok:true,claimed:due.data?.length||0,processed})})
