// Atendimento comercial estruturado. Executa fora do webhook e só em organizações opt-in.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {brazilianPhoneCandidates} from '../_shared/internalCommandCore.js'
import {getOperationalWindow} from '../_shared/operationalCalendar.js'
import {generateStructured,transcribeAudio} from '../_shared/aiProvider.js'
import {FOLLOWUP_FALLBACK,FOLLOWUP_SCHEMA,buildKnowledgePrompt,SECOND_CTA_TEXT,buildTriageCtas,interactiveCtaBody,mentionsTeam,composeHandoffResponse,followupDue,pendingInboundText,stripUnauthorizedLinks} from '../_shared/attendanceCore.js'
import {CONVERSATION_PRINCIPLES,UNDERSTANDING_SCHEMA,conversationModelInput,conversationTrace,scopedConversationState,advanceConversationState} from '../_shared/conversationKernel.js'
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

async function askAI(event:any,messages:any[],qualification:any,opportunity:any,client:any,settings:any,attendance:any){
  const schema:any={type:'object',additionalProperties:false,properties:{conversation_kind:{type:['string','null'],enum:[...COMMERCIAL_LEAD_KINDS,null]},intents:{type:'array',items:{type:'string',enum:COMMERCIAL_INTENTS}},response:{type:'string'},contact_updates:{type:'object',additionalProperties:false,properties:{company_name:{type:['string','null']},contact_name:{type:['string','null']},email:{type:['string','null']},contact_role:{type:['string','null']}},required:['company_name','contact_name','email','contact_role']},opportunity_updates:{type:'object',additionalProperties:false,properties:{stage:{type:['string','null']},main_problem:{type:['string','null']},timeline:{type:['string','null']},urgency:{type:['string','null']},budget:{type:['number','null']},estimated_value:{type:['number','null']},next_action:{type:['string','null']},next_action_at:{type:['string','null']},service_interests:{type:'array',items:{type:'string',enum:COMMERCIAL_INTENTS}}},required:['stage','main_problem','timeline','urgency','budget','estimated_value','next_action','next_action_at','service_interests']},qualification_updates:{type:'object',additionalProperties:false,properties:{current_situation:{type:['string','null']},main_problem:{type:['string','null']},objective:{type:['string','null']},urgency:{type:['string','null']},budget:{type:['number','null']},decision_maker:{type:['boolean','null']},timeline:{type:['string','null']},qualified:{type:'boolean'},needs_human:{type:'boolean'},next_action:{type:['string','null']},reasons:{type:'array',items:{type:'string'}},missing_fields:{type:'array',items:{type:'string'}}},required:['current_situation','main_problem','objective','urgency','budget','decision_maker','timeline','qualified','needs_human','next_action','reasons','missing_fields']},summary:{type:'string'},create_task:{type:'boolean'},task:{type:['object','null'],additionalProperties:false,properties:{title:{type:'string'},priority:{type:'string',enum:['low','medium','high','critical']},due_date:{type:['string','null']},notes:{type:['string','null']}},required:['title','priority','due_date','notes']},handoff:{type:'boolean'},handoff_reason:{type:['string','null']},confidence:{type:'number',minimum:0,maximum:1}},required:['conversation_kind','intents','response','contact_updates','opportunity_updates','qualification_updates','summary','create_task','task','handoff','handoff_reason','confidence']}
  schema.properties.understanding=UNDERSTANDING_SCHEMA
  schema.required.push("understanding")
  const context={client:{company_name:client?.company_name||null,contact_name:client?.contact_name||null,contact_role:client?.contact_role||null},qualification:qualification||{},opportunity:opportunity||{},messages:messages.map(row=>({direction:row.direction,text:clean(row.text_content,1000),at:row.created_at})),authorized_pricing:settings.authorized_pricing||{}}
  const system=`${CONVERSATION_PRINCIPLES}\n${COMMERCIAL_SYSTEM_PROMPT}\n${clean(settings.prompt_override,3000)}\nPreencha understanding com intenções abertas. Diferencie suporte/serviço ativo de compra nova antes de abrir oportunidade. Não afirme capacidade ou serviço sem fonte autorizada.\nSe a última mensagem do lead tiver várias linhas, ele mandou mensagens seguidas: responda tudo em UMA mensagem.\n\n${buildKnowledgePrompt(attendance.knowledge,settings,{ownerFirstName:attendance.ownerFirstName,operationalOpen:attendance.operationalOpen})}`
  const user=JSON.stringify(conversationModelInput("external",{state:event.conversation_state,message:pendingInboundText(messages),history:context.messages,context:{...context,active_services:event.active_services||[]}}))
  let decoded
  try{
    const result=await generateStructured({system,user,schema,schemaName:'commercial_decision',maxTokens:1800,timeoutMs:30_000})
    decoded=result.data;event.ai_provider=result.provider;event.ai_model=result.model
  }catch(error:any){
    if(error?.code==='AI_NOT_CONFIGURED'){event.planner_status='http_error';return null}
    if(error?.code==='AI_INVALID_OUTPUT'){event.planner_status='invalid_json';return null}
    event.planner_status='http_error';throw error
  }
  const result=validateCommercialDecision(decoded)
  event.planner_status=result?'ok':'validation_rejected'
  return result
}

async function sendMessage(admin:any,event:any,conversation:any,text:string,idempotencyKey?:string,cta?:any){
  const token=Deno.env.get('META_ACCESS_TOKEN')||'';if(!token)throw Object.assign(new Error('Meta não configurada.'),{code:'META_CONFIGURATION_MISSING'})
  const connection=await admin.from('whatsapp_connections').select('phone_number_id').eq('id',event.connection_id).eq('organization_id',event.organization_id).single();if(connection.error)throw connection.error
  const key=idempotencyKey||`commercial-ai:${event.id}`,existing=await admin.from('whatsapp_messages').select('provider_message_id').eq('connection_id',event.connection_id).eq('idempotency_key',key).maybeSingle();if(existing.error)throw existing.error;if(existing.data?.provider_message_id)return existing.data.provider_message_id
  const response=await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION')||'v23.0'}/${connection.data.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(cta?{messaging_product:'whatsapp',recipient_type:'individual',to:conversation.wa_id,type:'interactive',interactive:interactiveCtaBody(text,cta)}:{messaging_product:'whatsapp',recipient_type:'individual',to:conversation.wa_id,type:'text',text:{preview_url:false,body:text}}),signal:AbortSignal.timeout(20_000)})
  const body=await response.json().catch(()=>({}));if(!response.ok||!body?.messages?.[0]?.id)throw Object.assign(new Error(clean(body?.error?.message)||'Falha no envio comercial.'),{code:response.status===429||response.status>=500?'META_TEMPORARY_ERROR':'META_SEND_FAILED'})
  const saved=await admin.from('whatsapp_messages').insert({organization_id:event.organization_id,connection_id:event.connection_id,conversation_id:event.conversation_id,provider_message_id:body.messages[0].id,idempotency_key:key,direction:'out',message_type:cta?'interactive':'text',status:'accepted',media:cta?{cta}:{},text_content:cta?`${text}\n[Botão: ${cta.label}]`:text,sent_at:new Date().toISOString()});if(saved.error&&saved.error.code!=='23505')throw saved.error
  await admin.from('whatsapp_conversations').update({last_message_at:new Date().toISOString(),last_outbound_at:new Date().toISOString()}).eq('id',event.conversation_id).eq('organization_id',event.organization_id)
  return body.messages[0].id
}

const graphVersion=()=>Deno.env.get('GRAPH_API_VERSION')||'v23.0'
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

// Marca a mensagem do lead como lida e mostra "digitando…" (até ~25s ou até a resposta sair).
async function markReadAndTyping(admin:any,event:any,typing:boolean){
  const token=Deno.env.get('META_ACCESS_TOKEN')||'';if(!token||!event.provider_message_id)return
  const connection=await admin.from('whatsapp_connections').select('phone_number_id').eq('id',event.connection_id).eq('organization_id',event.organization_id).maybeSingle();if(connection.error||!connection.data?.phone_number_id)return
  const body:any={messaging_product:'whatsapp',status:'read',message_id:event.provider_message_id};if(typing)body.typing_indicator={type:'text'}
  await fetch(`https://graph.facebook.com/${graphVersion()}/${connection.data.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8_000)}).catch(()=>null)
}

// Áudios do lead viram texto antes da IA ler o histórico.
async function transcribePendingAudio(admin:any,event:any){
  const token=Deno.env.get('META_ACCESS_TOKEN')||''
  const rows=await admin.from('whatsapp_messages').select('id,media,text_content').eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).eq('direction','in').in('message_type',['audio','voice']).order('created_at',{ascending:false}).limit(3)
  if(rows.error)return
  for(const row of rows.data||[]){
    if(clean(row.text_content)||row.media?.transcription_attempted)continue
    let text:string|null=null
    try{
      if(token&&row.media?.id){
        const meta=await fetch(`https://graph.facebook.com/${graphVersion()}/${row.media.id}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15_000)}).then(r=>r.ok?r.json():null)
        if(meta?.url){const file=await fetch(meta.url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30_000)});if(file.ok)text=await transcribeAudio({bytes:new Uint8Array(await file.arrayBuffer()),mimeType:clean(row.media?.mime_type,80)||'audio/ogg'})}
      }
    }catch{text=null}
    await admin.from('whatsapp_messages').update({text_content:text?`[áudio] ${clean(text,3800)}`:'[O lead enviou um áudio que não pôde ser transcrito — peça com gentileza para escrever o principal]',media:{...(row.media||{}),transcription_attempted:true,transcribed:Boolean(text)}}).eq('id',row.id).eq('organization_id',event.organization_id)
  }
}

// Modo copiloto: a IA escreve, uma pessoa aprova no CRM. Modo automático: envia.
async function deliver(admin:any,event:any,conversation:any,text:string,mode:string,ctas:any[]=[]){
  if(mode!=='copilot'){
    const id=await sendMessage(admin,event,conversation,text,undefined,ctas[0]||null)
    // segundo número da equipe: mensagem curta com o outro botão
    if(ctas[1])await sendMessage(admin,event,conversation,SECOND_CTA_TEXT,`commercial-ai:${event.id}:cta2`,ctas[1]).catch(()=>null)
    return id
  }
  await admin.from('commercial_reply_drafts').update({status:'superseded',decided_at:new Date().toISOString()}).eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).eq('status','pending')
  const draft=await admin.from('commercial_reply_drafts').insert({organization_id:event.organization_id,conversation_id:event.conversation_id,event_id:event.id,draft_text:ctas.length?`${text}\n\n${ctas.map((c:any)=>`${c.label}: ${c.url}`).join('\n')}`:text})
  if(draft.error&&draft.error.code!=='23505')throw draft.error
  return null
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
  const startedAt=Date.now()
  const claim=await admin.from('commercial_ai_events').update({status:'processing',attempts:Number(event.attempts||0)+1}).eq('id',event.id).in('status',['pending','failed']).select('id').maybeSingle();if(claim.error||!claim.data)return false
  try{
    const [conversationResult,settingsResult]=await Promise.all([
      admin.from('whatsapp_conversations').select('*,whatsapp_contacts(*)').eq('id',event.conversation_id).eq('organization_id',event.organization_id).single(),
      admin.from('commercial_settings').select('*').eq('organization_id',event.organization_id).maybeSingle(),
    ])
    if(conversationResult.error||settingsResult.error)throw conversationResult.error||settingsResult.error
    const aiMode=settingsResult.data?.ai_mode
    if(aiMode!=='controlled_auto'&&aiMode!=='copilot'){
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
    if(!contact||contact.organization_id!==event.organization_id||contact.contact_type==='internal'||contact.team_member_id){
      await admin.from('commercial_ai_events').update({status:'skipped',decision:{reason:'identity_not_external'},processed_at:new Date().toISOString()}).eq('id',event.id).eq('organization_id',event.organization_id)
      return true
    }
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
    // Mensagens seguidas: se outra mensagem do lead já chegou depois desta, o evento mais novo responde tudo de uma vez.
    const newer=await admin.from('commercial_ai_events').select('id').eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).gt('created_at',event.created_at).in('status',['pending','processing','failed']).limit(1)
    if(newer.error)throw newer.error
    if(newer.data?.length){await admin.from('commercial_ai_events').update({status:'skipped',decision:{reason:'superseded_by_newer_message'},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id).eq('organization_id',event.organization_id);return true}
    // No copiloto quem lê é a pessoa do time: não marcamos como lido nem mostramos "digitando…".
    if(aiMode==='controlled_auto')await markReadAndTyping(admin,event,true)
    await transcribePendingAudio(admin,event)
    const [knowledgeResult,attendanceWindow]=await Promise.all([
      admin.from('ai_knowledge_entries').select('category,title,content,active,sort_order').eq('organization_id',event.organization_id).eq('active',true).order('sort_order').limit(80),
      getOperationalWindow(admin,event.organization_id),
    ])
    const attendance={knowledge:knowledgeResult.error?[]:(knowledgeResult.data||[]),ownerFirstName:commercialOwnerName?commercialOwnerName.split(' ')[0]:null,operationalOpen:attendanceWindow.open}
    const finalize=(text:string)=>stripUnauthorizedLinks(text,{meetingLink:settingsResult.data.meeting_link,knowledge:attendance.knowledge})
    const history=await admin.from('whatsapp_messages').select('direction,text_content,created_at').eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).order('created_at',{ascending:false}).limit(14)
    if(history.error)throw history.error
    const messages=(history.data||[]).reverse(),inbound=messages.filter((row:any)=>row.direction==='in').at(-1)?.text_content||''

    const opportunityResult=await admin.from('commercial_opportunities').select('*').eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).not('stage','in','(won,lost)').maybeSingle()
    if(opportunityResult.error)throw opportunityResult.error
    let opportunity=opportunityResult.data
    const services=await admin.from('contracts').select('contract_services(service_name)').eq('organization_id',event.organization_id).eq('client_id',client.id).eq('status','active').limit(20)
    if(services.error)throw services.error
    event.active_services=(services.data||[]).flatMap((row:any)=>row.contract_services||[]).map((row:any)=>row.service_name)
    const qualificationResult=opportunity?await admin.from('commercial_qualifications').select('*').eq('organization_id',event.organization_id).eq('opportunity_id',opportunity.id).maybeSingle():{data:null,error:null}
    if(qualificationResult.error)throw qualificationResult.error
    const knownQualification=qualificationResult.data
    const previousEvent=await admin.from('commercial_ai_events').select('decision').eq('organization_id',event.organization_id).eq('conversation_id',event.conversation_id).eq('status','completed').neq('id',event.id).order('processed_at',{ascending:false}).limit(1).maybeSingle()
    if(previousEvent.error)throw previousEvent.error
    const conversationScope=`${event.organization_id}:external:${event.conversation_id}`
    event.conversation_state=scopedConversationState(previousEvent.data?.decision?.conversation_trace?.conversation_state_next,conversationScope)
    const semanticDecision=await askAI(event,messages,knownQualification,opportunity,client,settingsResult.data,attendance).catch((error:any)=>{event.planner_status=['AbortError','TimeoutError'].includes(error?.name)?'timeout':event.planner_status||'http_error';return null})
    const humanGate=await admin.from('whatsapp_conversations').select('attendance_mode,automation_paused').eq('organization_id',event.organization_id).eq('id',event.conversation_id).single()
    if(humanGate.error)throw humanGate.error
    if(humanGate.data.attendance_mode==='human'||humanGate.data.automation_paused){
      await admin.from('commercial_ai_events').update({status:'skipped',decision:{reason:'human_attendance_active'},processed_at:new Date().toISOString()}).eq('organization_id',event.organization_id).eq('id',event.id)
      return true
    }
    const trace=(decision:any,response:string,results:any={})=>({...conversationTrace({identityType:'external',understanding:decision?.understanding,state:event.conversation_state,plannerStatus:event.planner_status,path:semanticDecision?'commercial_semantic':'commercial_safe_fallback',actions:[],results,response,startedAt}),conversation_state_next:advanceConversationState(event.conversation_state,{scope:conversationScope,understanding:decision?.understanding})})
    if(!opportunity){
      const currentKind=semanticDecision?.conversation_kind&&semanticDecision.confidence>=0.6?{kind:semanticDecision.conversation_kind,reason:'semantic_understanding'}:classifyConversationKind(inbound,{hasExistingClient:!resolvedClient.created,previousKind:null})
      // Cliente já existente + mensagem atual de suporte/financeiro/rotina sem demanda nova clara NUNCA
      // vira oportunidade comercial — só "quero um novo site/tráfego/projeto" (new_business) pode criar
      // uma. Faz handoff humano com a infraestrutura já existente (whatsapp_conversations +
      // team_notification_outbox + crm_tasks) — nenhuma tabela/fluxo novo.
      if(['support','finance','existing_client'].includes(currentKind.kind)||(currentKind.kind!=='new_business'&&semanticDecision?.handoff)){
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
        const providerMessageId=await deliver(admin,event,conversation,response,aiMode,buildTriageCtas(settingsResult.data,{summary:`${currentKind.kind==='finance'?'financeiro':currentKind.kind==='support'?'suporte':'atendimento'} — ${clean(inbound,120)}`,contactName:client.contact_name}))
        await admin.from('commercial_ai_events').update({status:'completed',decision:{reason:'existing_client_non_commercial',kind:currentKind.kind,provider_message_id:providerMessageId,conversation_trace:trace(semanticDecision,response,{handoff:true})},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id)
        return true
      }
      if(currentKind.kind!=='new_business'){
        const discoveryContext={client,messages,authorized_pricing:settingsResult.data.authorized_pricing||{}}
        let discovery=semanticDecision||defaultCommercialDecision(inbound,discoveryContext)
        discovery=enforceCommercialPrivacyPolicy(enforceCommercialResponsePolicy(discovery,inbound,discoveryContext),inbound)
        const live=await admin.from('whatsapp_conversations').select('attendance_mode,automation_paused').eq('organization_id',event.organization_id).eq('id',event.conversation_id).single()
        if(live.error)throw live.error
        if(live.data.attendance_mode==='human'||live.data.automation_paused){await admin.from('commercial_ai_events').update({status:'skipped',processed_at:new Date().toISOString()}).eq('organization_id',event.organization_id).eq('id',event.id);return true}
        const discoveryText=finalize(discovery.response)
        const providerMessageId=await deliver(admin,event,conversation,discoveryText,aiMode,mentionsTeam(discoveryText)?buildTriageCtas(settingsResult.data,{summary:clean(inbound,120),contactName:client.contact_name}):[])
        await admin.from('commercial_ai_events').update({status:'completed',decision:{...discovery,opportunity_id:null,provider_message_id:providerMessageId,conversation_trace:trace(discovery,discovery.response,{opportunity_created:false})},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id).eq('organization_id',event.organization_id)
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
    let decision=semanticDecision||defaultCommercialDecision(inbound,decisionContext)
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
      // A própria IA escreve o repasse (retomando o pedido); só completamos quem continua e o horário.
      decision.response=composeHandoffResponse({modelResponse:decision.response,ownerFirstName:attendance.ownerFirstName,operationalOpen:operationalWindow.open})
    }

    const finalText=finalize(decision.response)
    const triageCta=(decision.handoff||mentionsTeam(finalText))?buildTriageCtas(settingsResult.data,{summary:interests.length?interests.join(' + ').toLowerCase():clean(inbound,120),contactName:client.contact_name}):[]
    const providerMessageId=await deliver(admin,event,conversation,finalText,aiMode,triageCta)
    await admin.from('commercial_ai_events').update({status:'completed',decision:{...decision,temperature,lead_kind:leadKind,provider_message_id:providerMessageId,opportunity_id:opportunity.id,conversation_trace:trace(decision,decision.response,{opportunity_id:opportunity.id,handoff:decision.handoff})},processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',event.id)
    return true
  }catch(error:any){const attempts=Number(event.attempts||0)+1,terminal=attempts>=6||['META_CONFIGURATION_MISSING','AI_REQUEST_FAILED'].includes(error?.code);await admin.from('commercial_ai_events').update({decision:{...(event.decision||{}),conversation_trace:conversationTrace({identityType:'external',understanding:null,state:event.conversation_state,plannerStatus:event.planner_status||'error',path:'failed',response:null,startedAt,error:error?.code||error?.name})},status:terminal?'dead_letter':'failed',next_attempt_at:new Date(Date.now()+Math.min(3600,2**attempts*30)*1000).toISOString(),error_code:clean(error?.code||error?.name,100),error_message:clean(error?.message,500),processed_at:terminal?new Date().toISOString():null}).eq('id',event.id);return false}
}
// Retomada única de lead que parou de responder (dentro da janela de 24h e do horário de atendimento).
async function processFollowups(admin:any){
  const settings=await admin.from('commercial_settings').select('*').eq('ai_mode','controlled_auto').eq('followup_enabled',true)
  if(settings.error)return 0
  let sent=0
  for(const config of settings.data||[]){
    const window=await getOperationalWindow(admin,config.organization_id);if(!window.open)continue
    const since=new Date(Date.now()-23.5*3_600_000).toISOString()
    const candidates=await admin.from('whatsapp_conversations').select('id,organization_id,connection_id,wa_id,attendance_mode,automation_paused,last_inbound_at,last_outbound_at,opportunity_id').eq('organization_id',config.organization_id).eq('attendance_mode','bot').eq('automation_paused',false).gt('last_inbound_at',since).limit(50)
    if(candidates.error)continue
    for(const conversation of candidates.data||[]){
      if(!followupDue(conversation,config))continue
      const recent=await admin.from('whatsapp_messages').select('id,direction,text_content,idempotency_key,created_at').eq('organization_id',config.organization_id).eq('conversation_id',conversation.id).order('created_at',{ascending:false}).limit(12)
      if(recent.error||!recent.data?.length)continue
      const anchor=recent.data.find((row:any)=>row.direction==='out')
      if(!anchor||String(anchor.idempotency_key||'').startsWith('commercial-followup:'))continue
      const claim=await admin.from('commercial_followups').insert({organization_id:config.organization_id,conversation_id:conversation.id,anchor_message_id:anchor.id,status:'sent'}).select('id').single()
      if(claim.error)continue
      let text=FOLLOWUP_FALLBACK,send=true
      try{
        const history=[...recent.data].reverse().map((row:any)=>({direction:row.direction,text:clean(row.text_content,600)}))
        const result=await generateStructured({schemaName:'followup',schema:FOLLOWUP_SCHEMA,maxTokens:400,timeoutMs:20_000,
          system:`Você é do time comercial da Mugô no WhatsApp. O lead parou de responder nossa última mensagem. Escreva UMA retomada curta (máx. 2 frases), natural, sem pressão, retomando o assunto da conversa e terminando com uma pergunta simples. Não repita a última mensagem. Nunca diga que é IA. Se a conversa já terminou de forma natural (agradecimento, despedida, "vou ver e te aviso"), devolva send=false.`,
          user:JSON.stringify({conversa:history})})
        send=result.data?.send!==false;text=clean(result.data?.text,600)||FOLLOWUP_FALLBACK
      }catch{/* sem IA: usa o texto padrão */}
      if(!send){await admin.from('commercial_followups').update({status:'skipped'}).eq('id',claim.data.id);continue}
      try{
        await sendMessage(admin,{id:`followup-${anchor.id}`,organization_id:config.organization_id,connection_id:conversation.connection_id,conversation_id:conversation.id},conversation,text,`commercial-followup:${anchor.id}`)
        await admin.from('commercial_followups').update({text_content:text}).eq('id',claim.data.id);sent+=1
      }catch(error:any){await admin.from('commercial_followups').update({status:'failed',error_message:clean(error?.message,300)}).eq('id',claim.data.id)}
    }
  }
  return sent
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({ok:false},405)
  const expected=Deno.env.get('COMMERCIAL_AI_WORKER_KEY')||''
  if(!expected||request.headers.get('X-Commercial-AI-Worker-Key')!==expected)return json({ok:false,code:'UNAUTHORIZED'},401)
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!key)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const admin=createClient(url,key,{auth:{persistSession:false}})
  const body=await request.json().catch(()=>({}))
  // Chamado pelo webhook: responde na hora (a Meta precisa do 200 rápido) e processa em segundo plano,
  // respeitando a espera de agrupamento de mensagens.
  const runtime=(globalThis as any).EdgeRuntime
  if(body?.source==='whatsapp-webhook'&&typeof runtime?.waitUntil==='function'){
    runtime.waitUntil(drainQueue(admin).catch(()=>null))
    return json({ok:true,accepted:true},202)
  }
  return json({ok:true,...await drainQueue(admin),followups:await processFollowups(admin).catch(()=>0)})
})

async function drainQueue(admin:any){
  // Pega também eventos que vencem nos próximos 20s (espera de agrupamento de mensagens) e aguarda até a hora.
  const horizon=new Date(Date.now()+20_000).toISOString()
  const due=await admin.from('commercial_ai_events').select('*').in('status',['pending','failed']).lte('next_attempt_at',horizon).order('created_at').limit(10)
  if(due.error)return {claimed:0,processed:0,error:'QUEUE_READ_FAILED'}
  let processed=0
  for(const event of due.data||[]){
    const wait=Date.parse(event.next_attempt_at)-Date.now()
    if(wait>0)await sleep(Math.min(wait,20_000))
    if(await processEvent(admin,event))processed+=1
  }
  return {claimed:due.data?.length||0,processed}
}
