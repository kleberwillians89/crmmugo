// Atendimento comercial estruturado. Executa fora do webhook e só em organizações opt-in.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {brazilianPhoneCandidates} from '../_shared/internalCommandCore.js'
import {getOperationalWindow} from '../_shared/operationalCalendar.js'
import {COMMERCIAL_INTENTS,COMMERCIAL_LEAD_KINDS,COMMERCIAL_SYSTEM_PROMPT,applyInterestCorrection,assessCommercialTemperature,buildCommercialSummary,classifyConversationKind,defaultCommercialDecision,enforceCommercialHandoffPolicy,enforceCommercialPrivacyPolicy,enforceCommercialResponsePolicy,hasMinimumCommercialContext,qualificationClassification,validateCommercialDecision} from '../_shared/commercialAgentCore.js'
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

async function dispatchTeamWorker(){
  const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('TEAM_NOTIFICATION_WORKER_KEY')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  if(!url||!key||!service)return
  await fetch(`${url}/functions/v1/team-notification-worker`,{method:'POST',headers:{Authorization:`Bearer ${service}`,'Content-Type':'application/json','X-Team-Notification-Worker-Key':key},body:JSON.stringify({source:'commercial-handoff'}),signal:AbortSignal.timeout(8_000)}).catch(()=>null)
}

async function askOpenAI(event:any,messages:any[],qualification:any,opportunity:any,client:any,settings:any){
  const key=Deno.env.get('OPENAI_API_KEY')||'',model=Deno.env.get('COMMERCIAL_AI_MODEL')||Deno.env.get('OPENAI_MODEL')||''
  if(!key||!model)return null
  const schema={type:'object',additionalProperties:false,properties:{conversation_kind:{type:['string','null'],enum:[...COMMERCIAL_LEAD_KINDS,null]},intents:{type:'array',items:{type:'string',enum:COMMERCIAL_INTENTS}},response:{type:'string'},contact_updates:{type:'object',additionalProperties:false,properties:{company_name:{type:['string','null']},contact_name:{type:['string','null']},email:{type:['string','null']},contact_role:{type:['string','null']}},required:['company_name','contact_name','email','contact_role']},opportunity_updates:{type:'object',additionalProperties:false,properties:{stage:{type:['string','null']},main_problem:{type:['string','null']},timeline:{type:['string','null']},urgency:{type:['string','null']},budget:{type:['number','null']},estimated_value:{type:['number','null']},next_action:{type:['string','null']},next_action_at:{type:['string','null']},service_interests:{type:'array',items:{type:'string',enum:COMMERCIAL_INTENTS}}},required:['stage','main_problem','timeline','urgency','budget','estimated_value','next_action','next_action_at','service_interests']},qualification_updates:{type:'object',additionalProperties:false,properties:{current_situation:{type:['string','null']},main_problem:{type:['string','null']},objective:{type:['string','null']},urgency:{type:['string','null']},budget:{type:['number','null']},decision_maker:{type:['boolean','null']},timeline:{type:['string','null']},qualified:{type:'boolean'},needs_human:{type:'boolean'},next_action:{type:['string','null']},reasons:{type:'array',items:{type:'string'}},missing_fields:{type:'array',items:{type:'string'}}},required:['current_situation','main_problem','objective','urgency','budget','decision_maker','timeline','qualified','needs_human','next_action','reasons','missing_fields']},summary:{type:'string'},create_task:{type:'boolean'},task:{type:['object','null'],additionalProperties:false,properties:{title:{type:'string'},priority:{type:'string',enum:['low','medium','high','critical']},due_date:{type:['string','null']},notes:{type:['string','null']}},required:['title','priority','due_date','notes']},handoff:{type:'boolean'},handoff_reason:{type:['string','null']},confidence:{type:'number',minimum:0,maximum:1}},required:['conversation_kind','intents','response','contact_updates','opportunity_updates','qualification_updates','summary','create_task','task','handoff','handoff_reason','confidence']}
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
  // display_name/profile_name do WhatsApp não é evidência de nome pessoal (pode ser empresa, marca,
  // apelido ou nome do aparelho) — vira só um rótulo de company_name até a pessoa se identificar de
  // verdade na conversa. contact_name fica null até então (nunca "Oi, Roove!" a partir do display_name).
  if(!client){const display=clean(contact.display_name||contact.profile_name,240)||`Lead WhatsApp • ${contact.wa_id.slice(-4)}`;const inserted=await admin.from('clients').insert({organization_id:event.organization_id,company_name:display,contact_name:null,phone:contact.wa_id,lead_source:contact.source||'WHATSAPP_ORGANIC',status:'lead'}).select('*').single();if(inserted.error)throw inserted.error;client=inserted.data;created=true}
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
    // Prioridade absoluta do humano: se alguém já assumiu (ou pausou a automação) entre o insert do
    // evento e este processamento, a IA nunca responde — evita corrida bot-vs-humano.
    if(conversationResult.data.attendance_mode==='human'||conversationResult.data.automation_paused===true){
      await admin.from('commercial_ai_events').update({status:'skipped',decision:{reason:'human_attendance_active'},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id).eq('organization_id',event.organization_id)
      return true
    }

    const conversation=conversationResult.data,contact=conversation.whatsapp_contacts
    const resolvedClient=await resolveClient(admin,event,contact);let client=resolvedClient.client
    let commercialOwnerProfileId=null,commercialOwnerName=null
    if(settingsResult.data.commercial_owner_id){
      const owner=await admin.from('team_members').select('auth_profile_id,name').eq('id',settingsResult.data.commercial_owner_id).eq('organization_id',event.organization_id).eq('active',true).maybeSingle()
      if(owner.error)throw owner.error
      commercialOwnerProfileId=owner.data?.auth_profile_id||null
      commercialOwnerName=clean(owner.data?.name,120)||null
    }

    // A mensagem ATUAL decide se uma oportunidade pode nascer — nunca o histórico antigo (que pode ter
    // SITE/ECOMMERCE de uma demanda já encerrada). Por isso o histórico/inbound é buscado e a
    // classificação determinística roda ANTES de qualquer decisão de criar commercial_opportunity.
    const history=await admin.from('whatsapp_messages').select('direction,text_content,created_at').eq('conversation_id',event.conversation_id).order('created_at',{ascending:false}).limit(14)
    if(history.error)throw history.error
    const messages=(history.data||[]).reverse(),inbound=messages.filter((row:any)=>row.direction==='in').at(-1)?.text_content||''

    let opportunity=(await admin.from('commercial_opportunities').select('*').eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).not('stage','in','(won,lost)').maybeSingle()).data
    if(!opportunity){
      const currentKind=classifyConversationKind(inbound,{hasExistingClient:!resolvedClient.created,previousKind:null})
      // Cliente já existente + mensagem atual de suporte/financeiro/rotina sem demanda nova clara NUNCA
      // vira oportunidade comercial — só "quero um novo site/tráfego/projeto" (new_business) pode criar
      // uma. Faz handoff humano com a infraestrutura já existente (whatsapp_conversations +
      // team_notification_outbox + crm_tasks) — nenhuma tabela/fluxo novo.
      if(!resolvedClient.created&&['support','finance','existing_client'].includes(currentKind.kind)){
        const now=new Date().toISOString(),handoffRef=`commercial-support-handoff:${event.conversation_id}:${event.id}`
        const handoffUpdates=await admin.from('whatsapp_conversations').update({status:'pending',attendance_mode:'human',automation_paused:true,assigned_to:commercialOwnerProfileId||null,assigned_team_member_id:settingsResult.data.commercial_owner_id||null,handoff_reason:`existing_client_${currentKind.kind}`,handoff_at:now}).eq('id',event.conversation_id).eq('organization_id',event.organization_id)
        if(handoffUpdates.error)throw handoffUpdates.error
        const audit=await admin.from('whatsapp_conversation_events').insert({organization_id:event.organization_id,connection_id:event.connection_id,conversation_id:event.conversation_id,event_type:'commercial_handoff',details:{kind:currentKind.kind,reason:currentKind.reason,client_id:client.id,opportunity_id:null}})
        if(audit.error)throw audit.error
        if(settingsResult.data.commercial_owner_id){
          const leadName=client.contact_name||client.company_name
          const notify=await admin.from('team_notification_outbox').upsert({organization_id:event.organization_id,team_member_id:settingsResult.data.commercial_owner_id,notification_type:'operational_alert',idempotency_key:handoffRef,payload:{kind:`existing_client_${currentKind.kind}`,conversation_id:event.conversation_id,client_id:client.id,name:leadName,company:client.company_name,message:clean(inbound,500),lead_phone:contact.wa_id,candidate_items:[{index:1,type:'conversation',conversation_id:event.conversation_id,label:leadName}]}},{onConflict:'organization_id,idempotency_key',ignoreDuplicates:true})
          if(notify.error)throw notify.error
          await dispatchTeamWorker()
        }
        const task=await admin.from('crm_tasks').upsert({organization_id:event.organization_id,title:`${currentKind.kind==='finance'?'Financeiro':'Suporte'} — ${client.contact_name||client.company_name}`,status:'pending',priority:'medium',due_date:today(),assigned_to:settingsResult.data.commercial_owner_id||null,client_id:client.id,task_type:'general',source:'automation',source_ref:handoffRef,notes:`Mensagem: ${clean(inbound,500)}\nTelefone: +${contact.wa_id}\nClassificação: ${currentKind.kind}`,metadata:{origin:'automation',sync_external:true,existing_client_handoff:true,kind:currentKind.kind}},{onConflict:'organization_id,source_ref'})
        if(task.error)throw task.error
        const response=commercialOwnerName?`Perfeito. Vou passar esse contexto para ${commercialOwnerName.split(' ')[0]} continuar com você.`:'Certo. Vou encaminhar o contexto desta conversa para a pessoa responsável continuar com você.'
        const providerMessageId=await sendMessage(admin,event,conversation,response)
        await admin.from('commercial_ai_events').update({status:'completed',decision:{reason:'existing_client_non_commercial',kind:currentKind.kind,provider_message_id:providerMessageId},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id)
        return true
      }
      const utm=contact.utm||{}
      const created=await admin.from('commercial_opportunities').insert({organization_id:event.organization_id,client_id:client.id,conversation_id:event.conversation_id,assigned_to:settingsResult.data.commercial_owner_id||null,name:client.company_name,source:contact.source||client.lead_source||'WHATSAPP_ORGANIC',campaign:contact.campaign||null,ad_name:contact.ad_name||null,utm_source:utm.utm_source||null,utm_medium:utm.utm_medium||null,utm_campaign:utm.utm_campaign||null,utm_content:utm.utm_content||null,stage:'in_service',last_interaction_at:new Date().toISOString()}).select('*').single()
      if(created.error)throw created.error
      opportunity=created.data
      await admin.from('whatsapp_conversations').update({opportunity_id:opportunity.id}).eq('id',event.conversation_id).eq('organization_id',event.organization_id)
    }

    const qResult=await admin.from('commercial_qualifications').select('*').eq('opportunity_id',opportunity.id).maybeSingle()
    if(qResult.error)throw qResult.error
    const qualification=qResult.data||{}
    const decisionContext={qualification,opportunity,client,messages,authorized_pricing:settingsResult.data.authorized_pricing||{}}
    let decision=await askOpenAI(event,messages,qualification,opportunity,client,settingsResult.data).catch(()=>null)||defaultCommercialDecision(inbound,decisionContext)
    decision=validateCommercialDecision(decision)||defaultCommercialDecision(inbound,decisionContext)
    decision=enforceCommercialHandoffPolicy(decision,inbound,decisionContext)
    decision=enforceCommercialResponsePolicy(decision,inbound,decisionContext)
    // Última palavra sobre o texto: nenhuma resposta (da IA real ou do fallback) pode soar como se
    // soubesse dado interno da equipe — mesmo que a IA tente, ela nunca recebe esse dado no contexto.
    decision=enforceCommercialPrivacyPolicy(decision,inbound)
    // Segunda checagem, agora que a chamada à OpenAI (que pode levar alguns segundos) já terminou —
    // fecha a janela de corrida caso um humano assuma DURANTE o processamento, antes de qualquer
    // persistência ou envio acontecer.
    const recheck=await admin.from('whatsapp_conversations').select('attendance_mode,automation_paused').eq('id',event.conversation_id).eq('organization_id',event.organization_id).single()
    if(recheck.error)throw recheck.error
    if(recheck.data.attendance_mode==='human'||recheck.data.automation_paused===true){
      await admin.from('commercial_ai_events').update({status:'skipped',decision:{reason:'human_attendance_active'},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id).eq('organization_id',event.organization_id)
      return true
    }

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
    // A mensagem ATUAL pode remover ou estreitar o foco ("esquece o site, por enquanto só tráfego") —
    // mergeInterests sozinho só soma; sem a correção por cima, um interesse já abandonado voltava sempre.
    const interests=applyInterestCorrection(inbound,mergeInterests(qualification.service_interest,opportunity.service_interests,decision.intents,decision.opportunity_updates?.service_interests))
    // A IA pode propor conversation_kind a partir do histórico completo — só é aceito quando vem do
    // enum conhecido (já validado em validateCommercialDecision); sem isso, cai no classificador
    // determinístico, que também serve de base quando a OpenAI está indisponível.
    const leadKind=COMMERCIAL_LEAD_KINDS.includes(decision.conversation_kind)
      ?{kind:decision.conversation_kind,reason:'Classificado pela IA a partir do histórico da conversa.'}
      :classifyConversationKind(inbound,{hasExistingClient:!resolvedClient.created,previousKind:opportunity.lead_kind})
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
      const operationalWindow=await getOperationalWindow(admin,event.organization_id)
      const handoffUpdates=await admin.from('whatsapp_conversations').update({status:'pending',attendance_mode:'human',automation_paused:true,assigned_to:commercialOwnerProfileId||null,assigned_team_member_id:settingsResult.data.commercial_owner_id||null,handoff_reason:decision.handoff_reason||'qualified_commercial_lead',handoff_at:now,handoff_sla_started_at:operationalWindow.open?now:null,assigned_at:settingsResult.data.commercial_owner_id?now:null}).eq('id',event.conversation_id).eq('organization_id',event.organization_id);if(handoffUpdates.error)throw handoffUpdates.error
      const audit=await admin.from('whatsapp_conversation_events').insert({organization_id:event.organization_id,connection_id:event.connection_id,conversation_id:event.conversation_id,event_type:'commercial_handoff',details:{opportunity_id:opportunity.id,reason:decision.handoff_reason,temperature:temperature.temperature}});if(audit.error)throw audit.error
      const taskTitle=`COMERCIAL — Falar com ${client.contact_name||client.company_name}${client.contact_name&&client.company_name?` — ${client.company_name}`:''}`
      const task=await admin.from('crm_tasks').upsert({organization_id:event.organization_id,title:taskTitle,status:'pending',priority:q.urgency==='high'?'high':'medium',due_date:today(),assigned_to:settingsResult.data.commercial_owner_id||null,client_id:client.id,opportunity_id:opportunity.id,task_type:'commercial',source:'automation',source_ref:handoffRef,notes:[`Interesse: ${interests.join(' + ')}`,`Temperatura: ${temperature.temperature} — ${temperature.reason}`,`Telefone: +${contact.wa_id}`,`Origem: ${opportunity.source}`,`Resumo: ${summary}`,`Próxima ação: ${nextAction||'Realizar diagnóstico comercial'}`].join('\n'),metadata:{origin:'automation',sync_external:true,commercial_handoff:true}},{onConflict:'organization_id,source_ref'}).select('id').maybeSingle();if(task.error)throw task.error
      if(settingsResult.data.commercial_owner_id){
        const leadName=client.contact_name||client.company_name
        const notify=await admin.from('team_notification_outbox').upsert({organization_id:event.organization_id,team_member_id:settingsResult.data.commercial_owner_id,notification_type:'qualified_lead_handoff',idempotency_key:handoffRef,payload:{kind:'qualified_lead_handoff',conversation_id:event.conversation_id,opportunity_id:opportunity.id,name:leadName,company:client.company_name,interests,source:opportunity.source,temperature:temperature.temperature,urgency:q.urgency||'Não informada',need:ou.main_problem||q.main_problem||q.objective,summary,next_action:nextAction||'Entender escopo e preparar próximo passo',lead_phone:contact.wa_id,candidate_items:[{index:1,type:'conversation',conversation_id:event.conversation_id,label:leadName}] }},{onConflict:'organization_id,idempotency_key',ignoreDuplicates:true});if(notify.error)throw notify.error
        await dispatchTeamWorker()
      }
      if(!operationalWindow.open)decision.response='Recebi seu pedido e já deixei tudo registrado para o nosso time. Estamos fora do horário de atendimento e uma pessoa continua com você por aqui no próximo período útil.'
      else if(settingsResult.data.commercial_owner_id&&commercialOwnerName)decision.response=`Perfeito. ${commercialOwnerName.split(' ')[0]}, do nosso time, continua com você por aqui.`
    }

    const providerMessageId=await sendMessage(admin,event,conversation,decision.response)
    await admin.from('commercial_ai_events').update({status:'completed',decision:{...decision,temperature,lead_kind:leadKind,provider_message_id:providerMessageId,opportunity_id:opportunity.id},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id)
    return true
  }catch(error:any){const attempts=Number(event.attempts||0)+1,terminal=attempts>=6||['META_CONFIGURATION_MISSING','AI_REQUEST_FAILED'].includes(error?.code);await admin.from('commercial_ai_events').update({status:terminal?'dead_letter':'failed',next_attempt_at:new Date(Date.now()+Math.min(3600,2**attempts*30)*1000).toISOString(),error_code:clean(error?.code||error?.name,100),error_message:clean(error?.message,500),processed_at:terminal?new Date().toISOString():null}).eq('id',event.id);return false}
}
Deno.serve(async request=>{if(request.method!=='POST')return json({ok:false},405);const expected=Deno.env.get('COMMERCIAL_AI_WORKER_KEY')||'';if(!expected||request.headers.get('X-Commercial-AI-Worker-Key')!==expected)return json({ok:false,code:'UNAUTHORIZED'},401);const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return json({ok:false,code:'CONFIGURATION_MISSING'},503);const admin=createClient(url,key,{auth:{persistSession:false}}),due=await admin.from('commercial_ai_events').select('*').in('status',['pending','failed']).lte('next_attempt_at',new Date().toISOString()).order('created_at').limit(10);if(due.error)return json({ok:false,code:'QUEUE_READ_FAILED'},500);let processed=0;for(const event of due.data||[])if(await processEvent(admin,event))processed+=1;return json({ok:true,claimed:due.data?.length||0,processed})})
