// Processa comandos internos fora do webhook. Deploy e scheduler são manuais.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TASK_COMMAND_WORKER_KEY,
// META_ACCESS_TOKEN e, opcionalmente, OPENAI_API_KEY/TASK_COMMAND_MODEL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { HELP_TEXT, foldText, parseInternalCommand, taskShortId } from '../_shared/internalCommandCore.js'

const headers = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const clean = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const ALLOWED_INTENTS = new Set(['CREATE_TASK','LIST_TODAY','LIST_MINE','LIST_TEAM','LIST_OVERDUE','COMPLETE_TASK','START_TASK','MOVE_TASK','SET_PRIORITY','ASSIGN_TASK','LIST_WAITING_ATTENDANCE','ASSIGN_CONVERSATION','TAKE_CONVERSATION','PAUSE_AUTOMATION','RESUME_AUTOMATION','LIST_PENDING_CHARGES','ACTIVITY_START','ACTIVITY_COMPLETE','RECORD_DECISION','RECORD_OBSERVATION','RECORD_TIME','RECORD_PROPOSAL','UPDATE_PROPOSAL','ATTACH_PROPOSAL_FILE','FINANCIAL_EXPENSE_REQUEST','FINANCIAL_RECEIPT_REQUEST','FREELANCE_INCOME_REQUEST','CONFIRM_FINANCIAL','CANCEL_FINANCIAL','HELP'])

async function aiFallback(rawText: string) {
  const key = Deno.env.get('OPENAI_API_KEY') || ''
  if (!key) return null
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('TASK_COMMAND_MODEL') || 'gpt-5-mini',
      input: [{ role: 'system', content: 'Classifique um comando operacional interno em português. Não invente IDs. Retorne somente JSON.' }, { role: 'user', content: rawText }],
      text: { format: { type: 'json_schema', name: 'task_command', strict: true, schema: { type: 'object', additionalProperties: false, properties: { intent: { type: 'string', enum: [...ALLOWED_INTENTS] }, title: { type: ['string','null'] }, assignee_name: { type: ['string','null'] }, task_short_id: { type: ['string','null'] }, subject_query: { type: ['string','null'] }, priority: { type: ['string','null'], enum: ['low','medium','high','critical',null] }, due_date: { type: ['string','null'] }, summary:{type:['string','null']},amount:{type:['number','null']},hours:{type:['number','null']},category_name:{type:['string','null']},description:{type:['string','null']},project_source:{type:['string','null']},service:{type:['string','null']},currency:{type:['string','null']},proposal_status:{type:['string','null']} }, required: ['intent','title','assignee_name','task_short_id','subject_query','priority','due_date','summary','amount','hours','category_name','description','project_source','service','currency','proposal_status'] } } },
    }), signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return null
  const body = await response.json()
  const outputText=body?.output_text||(body?.output||[]).flatMap((item:any)=>item?.content||[]).find((item:any)=>item?.type==='output_text')?.text
  const parsed = JSON.parse(clean(outputText, 5000) || '{}')
  return ALLOWED_INTENTS.has(parsed.intent) ? { ...parsed, confidence: .65, parser: 'openai' } : null
}

async function sendReply(admin: any, event: any, message: string) {
  const token = Deno.env.get('META_ACCESS_TOKEN') || ''
  const connection = await admin.from('whatsapp_connections').select('phone_number_id').eq('id', event.connection_id).eq('organization_id', event.organization_id).single()
  if (connection.error) throw connection.error
  if (!token || !connection.data?.phone_number_id) throw Object.assign(new Error('Transporte Meta não configurado.'), { code: 'META_CONFIGURATION_MISSING' })
  const prior = await admin.from('whatsapp_messages').select('provider_message_id').eq('connection_id', event.connection_id).eq('idempotency_key', `task-command:${event.id}`).maybeSingle()
  if (prior.error) throw prior.error
  if (prior.data?.provider_message_id) return prior.data.provider_message_id
  const response = await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION') || 'v23.0'}/${connection.data.phone_number_id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: event.wa_id, type: 'text', text: { preview_url: false, body: message.slice(0, 4000) } }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body?.messages?.[0]?.id) throw Object.assign(new Error(clean(body?.error?.message) || 'Falha ao responder pelo WhatsApp.'), { code: response.status >= 500 || response.status === 429 ? 'META_TEMPORARY_ERROR' : 'META_SEND_FAILED' })
  const saved = await admin.from('whatsapp_messages').insert({ organization_id: event.organization_id, connection_id: event.connection_id, conversation_id: event.conversation_id, provider_message_id: body.messages[0].id, idempotency_key: `task-command:${event.id}`, direction: 'out', message_type: 'text', status: 'accepted', text_content: message, sent_at: new Date().toISOString() })
  if (saved.error && saved.error.code !== '23505') throw saved.error
  return body.messages[0].id
}

const findMember = async (admin: any, event: any, name: string | null) => {
  if (!name || ['eu','mim'].includes(foldText(name))) return event.team_member
  const result = await admin.from('team_members').select('id,name,auth_profile_id').eq('organization_id', event.organization_id).eq('active', true)
  if (result.error) throw result.error
  const needle = foldText(name)
  const matches = (result.data || []).filter((item: any) => foldText(item.name).includes(needle) || needle.includes(foldText(item.name)))
  return matches.length === 1 ? matches[0] : null
}
const findTask = async (admin: any, event: any, command: any) => {
  if (command.task_short_id) {
    const result=await admin.rpc('resolve_crm_task_short_id',{p_organization_id:event.organization_id,p_short_id:command.task_short_id})
    if(result.error)throw result.error
    return result.data?.length===1?result.data[0]:null
  }
  const result = await admin.from('crm_tasks').select('id,title,status,metadata').eq('organization_id', event.organization_id).limit(500)
  if (result.error) throw result.error
  const needle = foldText(command.task_query)
  const matches = (result.data || []).filter((item: any) => needle && foldText(item.title).includes(needle))
  return matches.length === 1 ? matches[0] : null
}
const taskLines = (items: any[]) => items.length ? items.slice(0, 15).map((item: any) => `${item.priority === 'high' || item.priority === 'critical' ? '🔴' : '•'} ${taskShortId(item.id)} ${item.title}${item.due_date ? ` — ${item.due_date}` : ''}`).join('\n') : 'Nenhuma tarefa encontrada.'
const brl=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value)
async function recordEvent(admin:any,event:any,type:string,title:string,description:string,metadata:any={}){
  const result=await admin.from('operational_events').upsert({organization_id:event.organization_id,event_type:type,title,description:clean(description,1000),team_member_id:event.team_member_id,conversation_id:event.conversation_id,source:'whatsapp',metadata,idempotency_key:`command:${event.id}:${type}`},{onConflict:'organization_id,idempotency_key',ignoreDuplicates:true})
  if(result.error&&result.error.code!=='42P01')throw result.error
}

const formatMoney=(value:number,currency='BRL')=>new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value)
const safeFilename=(value:unknown)=>clean(value||'arquivo',180).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]/g,'-').replace(/-+/g,'-')||'arquivo'
const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(value=>value.toString(16).padStart(2,'0')).join('')

async function findClient(admin:any,organizationId:string,query:unknown){
  const result=await admin.from('clients').select('id,company_name,trade_name,phone,status').eq('organization_id',organizationId).neq('status','archived').limit(1000)
  if(result.error)throw result.error
  const raw=clean(query,240),needle=foldText(raw),digits=raw.replace(/\D/g,'')
  if(!needle)return{kind:'none',items:[]}
  const rows=result.data||[]
  const phoneMatches=digits.length>=8?rows.filter((item:any)=>String(item.phone||'').replace(/\D/g,'').endsWith(digits)||digits.endsWith(String(item.phone||'').replace(/\D/g,''))):[]
  if(phoneMatches.length===1)return{kind:'one',item:phoneMatches[0]}
  if(phoneMatches.length>1)return{kind:'ambiguous',items:phoneMatches}
  const exact=rows.filter((item:any)=>[item.company_name,item.trade_name].some(value=>foldText(value)===needle))
  if(exact.length===1)return{kind:'one',item:exact[0]}
  if(exact.length>1)return{kind:'ambiguous',items:exact}
  const compact=needle.replace(/[^a-z0-9]/g,'')
  const approximate=compact.length>=4?rows.filter((item:any)=>[item.company_name,item.trade_name].some(value=>{const candidate=foldText(value).replace(/[^a-z0-9]/g,'');return candidate.includes(compact)||compact.includes(candidate)})):[]
  return approximate.length===1?{kind:'one',item:approximate[0]}:approximate.length>1?{kind:'ambiguous',items:approximate}:{kind:'none',items:[]}
}

const ambiguity=(label:string,items:any[])=>`Encontrei mais de um cliente ${label}: ${items.slice(0,5).map(item=>item.trade_name||item.company_name).join(', ')}. Qual deles?`

async function latestProposal(admin:any,org:string,clientId:string){
  const result=await admin.from('proposals').select('id,title,status,total_value,currency,opportunity_id,client_id').eq('organization_id',org).eq('client_id',clientId).is('deleted_at',null).order('created_at',{ascending:false}).limit(5)
  if(result.error)throw result.error
  const open=(result.data||[]).filter((item:any)=>!['rejected','lost','expired','cancelled'].includes(item.status))
  return open.length===1?{kind:'one',item:open[0]}:open.length>1?{kind:'ambiguous',items:open}:result.data?.length===1?{kind:'one',item:result.data[0]}:{kind:'none',items:[]}
}

async function pendingCommercial(admin:any,event:any){
  const result=await admin.from('commercial_command_confirmations').select('*').eq('organization_id',event.organization_id).eq('team_member_id',event.team_member_id).in('status',['pending','awaiting_context']).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(result.error)throw result.error
  return result.data
}

async function downloadCommercialMedia(admin:any,event:any,pending:any){
  const token=Deno.env.get('META_ACCESS_TOKEN')||'',media=pending.payload?.media||{},mediaId=clean(media.id,200)
  if(!token||!mediaId)throw Object.assign(new Error('Mídia Meta indisponível.'),{code:'MEDIA_CONFIGURATION_MISSING'})
  const version=Deno.env.get('GRAPH_API_VERSION')||'v23.0'
  const metadataResponse=await fetch(`https://graph.facebook.com/${version}/${mediaId}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)})
  const metadata=await metadataResponse.json().catch(()=>({}))
  if(!metadataResponse.ok||!metadata?.url)throw Object.assign(new Error(clean(metadata?.error?.message)||'Não foi possível obter a mídia do WhatsApp.'),{code:'META_MEDIA_LOOKUP_FAILED'})
  const mime=clean(metadata.mime_type||media.mime_type,120).toLowerCase(),allowed=new Set(['application/pdf','image/jpeg','image/png','image/webp']),limit=10*1024*1024
  if(!allowed.has(mime))throw Object.assign(new Error('Formato não permitido. Envie PDF, JPEG, PNG ou WebP.'),{code:'MEDIA_TYPE_NOT_ALLOWED'})
  if(Number(metadata.file_size||0)>limit)throw Object.assign(new Error('Arquivo acima do limite de 10 MB.'),{code:'MEDIA_TOO_LARGE'})
  const fileResponse=await fetch(metadata.url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30_000)})
  if(!fileResponse.ok)throw Object.assign(new Error('Não foi possível baixar a mídia do WhatsApp.'),{code:'META_MEDIA_DOWNLOAD_FAILED'})
  const bytes=await fileResponse.arrayBuffer()
  if(bytes.byteLength>limit)throw Object.assign(new Error('Arquivo acima do limite de 10 MB.'),{code:'MEDIA_TOO_LARGE'})
  const digest=hex(await crypto.subtle.digest('SHA-256',bytes))
  const duplicate=await admin.from('documents').select('id,file_name,storage_bucket,storage_path').eq('organization_id',event.organization_id).eq('content_sha256',digest).maybeSingle()
  if(duplicate.error)throw duplicate.error
  if(duplicate.data)return duplicate.data
  const original=clean(media.filename||metadata.filename||`whatsapp-${mediaId}`,240),filename=safeFilename(original)
  const proposalSegment=pending.proposal_id||'sem-proposta',path=`${event.organization_id}/clients/${pending.client_id}/proposals/${proposalSegment}/${crypto.randomUUID()}-${filename}`
  const uploaded=await admin.storage.from('crm-documents').upload(path,new Uint8Array(bytes),{contentType:mime,upsert:false})
  if(uploaded.error)throw uploaded.error
  const inserted=await admin.from('documents').insert({organization_id:event.organization_id,client_id:pending.client_id,proposal_id:pending.proposal_id||null,opportunity_id:pending.opportunity_id||null,conversation_id:pending.conversation_id||event.conversation_id,document_type:pending.proposal_id?'proposal':'other',file_name:filename,original_filename:original,storage_bucket:'crm-documents',storage_path:path,mime_type:mime,file_size:bytes.byteLength,content_sha256:digest,uploaded_by:event.team_member?.auth_profile_id||null,source:'whatsapp',source_ref:event.provider_message_id||mediaId,notes:'Recebido pelo WhatsApp interno após confirmação explícita.'}).select('id,file_name,storage_bucket,storage_path').single()
  if(inserted.error){await admin.storage.from('crm-documents').remove([path]);throw inserted.error}
  return inserted.data
}

async function confirmCommercial(admin:any,event:any,pending:any,cancel=false){
  if(cancel){const result=await admin.from('commercial_command_confirmations').update({status:'cancelled',resolution_command_event_id:event.id}).eq('id',pending.id).in('status',['pending','awaiting_context']);if(result.error)throw result.error;return 'Operação comercial cancelada. Nada foi registrado.'}
  if(pending.status==='awaiting_context')return 'Ainda preciso saber a qual cliente ou proposta o arquivo deve ser vinculado.'
  const payload=pending.payload||{}
  if(pending.action_type==='proposal_create'){
    let proposal=await admin.from('proposals').select('id,title,status,total_value,currency').eq('organization_id',event.organization_id).eq('source','whatsapp').eq('source_ref',pending.command_event_id).maybeSingle()
    if(proposal.error)throw proposal.error
    if(!proposal.data){
      proposal=await admin.from('proposals').insert({organization_id:event.organization_id,client_id:pending.client_id,opportunity_id:pending.opportunity_id||null,conversation_id:pending.conversation_id||event.conversation_id,title:payload.title,status:payload.status||'draft',sent_at:payload.status==='sent'?payload.proposal_date:null,proposal_date:payload.proposal_date,total_value:payload.amount,currency:payload.currency||'BRL',responsible_id:event.team_member_id,source:'whatsapp',source_ref:pending.command_event_id,lead_source:'whatsapp_internal',notes:payload.notes||null}).select('id,title,status,total_value,currency').single()
      if(proposal.error)throw proposal.error
      if(payload.service){const service=await admin.from('proposal_services').insert({organization_id:event.organization_id,proposal_id:proposal.data.id,service_name:payload.service,quantity:1,one_time_value:payload.amount,commercial_responsible_id:event.team_member_id});if(service.error)throw service.error}
    }
    if(pending.opportunity_id){const moved=await admin.from('commercial_opportunities').update({stage:'proposal',estimated_value:payload.amount,last_interaction_at:new Date().toISOString()}).eq('organization_id',event.organization_id).eq('id',pending.opportunity_id);if(moved.error)throw moved.error}
    await recordEvent(admin,event,'proposal_created','Proposta registrada',payload.title,{proposal_id:proposal.data.id,client_id:pending.client_id,amount:payload.amount,currency:payload.currency})
    if(payload.status==='sent'){const commercial=await admin.from('commercial_events').insert({organization_id:event.organization_id,client_id:pending.client_id,proposal_id:proposal.data.id,event_type:'proposal_sent',title:'Proposta enviada',description:payload.title,new_value:{amount:payload.amount,currency:payload.currency},created_by:event.team_member?.auth_profile_id||null});if(commercial.error)throw commercial.error}
    const confirmed=await admin.from('commercial_command_confirmations').update({status:'confirmed',proposal_id:proposal.data.id,confirmed_at:new Date().toISOString(),resolution_command_event_id:event.id,payload:{...payload,proposal_id:proposal.data.id}}).eq('id',pending.id).eq('status','pending');if(confirmed.error)throw confirmed.error
    return `Proposta registrada ✓\n${payload.title} — ${formatMoney(Number(payload.amount),payload.currency||'BRL')}\nPode me enviar o arquivo se quiser anexar.`
  }
  if(pending.action_type==='proposal_update'){
    const status=payload.status,dates=status==='accepted'?{closed_at:new Date().toISOString()}:status==='rejected'?{lost_at:new Date().toISOString(),closed_at:new Date().toISOString()}:status==='sent'?{sent_at:today()}:{}
    const changed=await admin.from('proposals').update({status,...dates}).eq('organization_id',event.organization_id).eq('id',pending.proposal_id).select('id,title,total_value,currency').single();if(changed.error)throw changed.error
    if(pending.opportunity_id&&['accepted','rejected'].includes(status)){const opportunity=await admin.from('commercial_opportunities').update({stage:status==='accepted'?'won':'lost',closed_at:new Date().toISOString()}).eq('organization_id',event.organization_id).eq('id',pending.opportunity_id);if(opportunity.error)throw opportunity.error}
    const commercial=await admin.from('commercial_events').insert({organization_id:event.organization_id,client_id:pending.client_id,proposal_id:pending.proposal_id,event_type:`proposal_${status}`,title:status==='accepted'?'Proposta aceita':status==='rejected'?'Proposta recusada':'Status da proposta alterado',new_value:{status},created_by:event.team_member?.auth_profile_id||null});if(commercial.error)throw commercial.error
    const confirmed=await admin.from('commercial_command_confirmations').update({status:'confirmed',confirmed_at:new Date().toISOString(),resolution_command_event_id:event.id}).eq('id',pending.id).eq('status','pending');if(confirmed.error)throw confirmed.error
    return `Proposta ${status==='accepted'?'aceita':status==='rejected'?'recusada':'atualizada'} ✓`
  }
  const document=await downloadCommercialMedia(admin,event,pending)
  const confirmed=await admin.from('commercial_command_confirmations').update({status:'confirmed',confirmed_at:new Date().toISOString(),resolution_command_event_id:event.id,payload:{...payload,document_id:document.id}}).eq('id',pending.id).eq('status','pending');if(confirmed.error)throw confirmed.error
  await recordEvent(admin,event,'proposal_document_attached','Arquivo comercial vinculado',document.file_name,{document_id:document.id,proposal_id:pending.proposal_id,client_id:pending.client_id})
  return 'Arquivo salvo e vinculado ✓'
}

async function execute(admin: any, event: any, command: any) {
  const org = event.organization_id
  if (command.intent === 'HELP') return HELP_TEXT
  if(command.intent==='RECORD_PROPOSAL'){
    if(!Number.isFinite(command.amount)||command.amount<=0||!clean(command.subject_query))return 'Preciso do cliente e de um valor válido. Ex.: “anota proposta de site para CAFIFA por R$ 4.500”.'
    const client=await findClient(admin,org,command.subject_query)
    if(client.kind==='ambiguous')return ambiguity(clean(command.subject_query),client.items)
    if(client.kind!=='one')return `Não encontrei o cliente “${clean(command.subject_query)}”. Não criei cadastro nem proposta automaticamente.`
    const prior=await pendingCommercial(admin,event)
    if(prior)return{status:'confirmation_required',reply:'Já existe uma operação comercial aguardando confirmação. Responda “sim” ou “não”.'}
    const opportunities=await admin.from('commercial_opportunities').select('id,stage').eq('organization_id',org).eq('client_id',client.item.id).not('stage','in','(won,lost)').order('updated_at',{ascending:false}).limit(2);if(opportunities.error)throw opportunities.error
    const opportunity=opportunities.data?.length===1?opportunities.data[0]:null
    const service=clean(command.service)||null,title=service?service.replace(/^./,letter=>letter.toUpperCase()):'Proposta comercial',currency=command.currency||'BRL'
    const inserted=await admin.from('commercial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,action_type:'proposal_create',client_id:client.item.id,opportunity_id:opportunity?.id||null,conversation_id:event.conversation_id,status:'pending',payload:{title,service,amount:command.amount,currency,status:command.proposal_status||'draft',proposal_date:today(),client_name:client.item.trade_name||client.item.company_name}}).select('id').single();if(inserted.error)throw inserted.error
    return{status:'confirmation_required',reply:`Registrar proposta de ${formatMoney(command.amount,currency)} para ${client.item.trade_name||client.item.company_name}${service?` — ${service}`:''}? Responda “sim” ou “não”.`}
  }
  if(command.intent==='UPDATE_PROPOSAL'){
    const client=await findClient(admin,org,command.subject_query)
    if(client.kind==='ambiguous')return ambiguity(clean(command.subject_query),client.items)
    if(client.kind!=='one')return `Não encontrei o cliente “${clean(command.subject_query)}”. Nenhuma proposta foi alterada.`
    const proposal=await latestProposal(admin,org,client.item.id)
    if(proposal.kind==='ambiguous')return `Encontrei mais de uma proposta aberta para ${client.item.trade_name||client.item.company_name}. Informe o título da proposta.`
    if(proposal.kind!=='one')return `Não encontrei proposta para ${client.item.trade_name||client.item.company_name}.`
    const prior=await pendingCommercial(admin,event)
    if(prior)return{status:'confirmation_required',reply:'Já existe uma operação comercial aguardando confirmação. Responda “sim” ou “não”.'}
    const status=command.proposal_status
    const inserted=await admin.from('commercial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,action_type:'proposal_update',client_id:client.item.id,opportunity_id:proposal.item.opportunity_id||null,proposal_id:proposal.item.id,conversation_id:event.conversation_id,status:'pending',payload:{status,title:proposal.item.title,client_name:client.item.trade_name||client.item.company_name}}).select('id').single();if(inserted.error)throw inserted.error
    return{status:'confirmation_required',reply:`Alterar “${proposal.item.title}” de ${client.item.trade_name||client.item.company_name} para ${status==='accepted'?'aceita':status==='rejected'?'recusada':'visualizada'}? Responda “sim” ou “não”.`}
  }
  if(command.intent==='ATTACH_PROPOSAL_FILE'){
    if(command.context_query){
      const awaiting=await pendingCommercial(admin,event)
      if(!awaiting||awaiting.action_type!=='proposal_attachment'||awaiting.status!=='awaiting_context')return 'Não há arquivo aguardando contexto.'
      const client=await findClient(admin,org,command.context_query)
      if(client.kind==='ambiguous')return ambiguity(clean(command.context_query),client.items)
      if(client.kind!=='one')return `Não encontrei o cliente “${clean(command.context_query)}”. Informe o nome como aparece no CRM.`
      const proposal=await latestProposal(admin,org,client.item.id)
      if(proposal.kind==='ambiguous')return `Encontrei mais de uma proposta aberta para ${client.item.trade_name||client.item.company_name}. Informe o título da proposta.`
      const updated=await admin.from('commercial_command_confirmations').update({status:'pending',client_id:client.item.id,proposal_id:proposal.kind==='one'?proposal.item.id:null,opportunity_id:proposal.kind==='one'?proposal.item.opportunity_id:null,payload:{...awaiting.payload,client_name:client.item.trade_name||client.item.company_name,proposal_title:proposal.kind==='one'?proposal.item.title:null}}).eq('id',awaiting.id).eq('status','awaiting_context');if(updated.error)throw updated.error
      return{status:'confirmation_required',reply:`Vincular ${awaiting.payload?.filename||'o arquivo'} a ${proposal.kind==='one'?`“${proposal.item.title}” de `:''}${client.item.trade_name||client.item.company_name}? Responda “sim” ou “não”.`}
    }
    const filename=clean(event.media?.filename||`imagem-${event.provider_message_id}`,240)
    const recent=await admin.from('commercial_command_confirmations').select('client_id,opportunity_id,proposal_id,payload').eq('organization_id',org).eq('team_member_id',event.team_member_id).eq('status','confirmed').not('proposal_id','is',null).gte('confirmed_at',new Date(Date.now()-2*60*60*1000).toISOString()).order('confirmed_at',{ascending:false}).limit(1).maybeSingle();if(recent.error)throw recent.error
    const inserted=await admin.from('commercial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,action_type:'proposal_attachment',client_id:recent.data?.client_id||null,opportunity_id:recent.data?.opportunity_id||null,proposal_id:recent.data?.proposal_id||null,conversation_id:event.conversation_id,status:recent.data?.client_id?'pending':'awaiting_context',payload:{media:event.media,filename,provider_message_id:event.provider_message_id,proposal_title:recent.data?.payload?.title||null,client_name:recent.data?.payload?.client_name||null}}).select('id').single();if(inserted.error)throw inserted.error
    if(!recent.data?.client_id)return{status:'confirmation_required',reply:`Recebi ${filename}. A qual cliente ou proposta devo vincular?`}
    return{status:'confirmation_required',reply:`Vincular ${filename} à proposta ${recent.data.payload?.title||''} — ${recent.data.payload?.client_name||'cliente identificado'}? Responda “sim” ou “não”.`}
  }
  if(['CONFIRM_FINANCIAL','CANCEL_FINANCIAL'].includes(command.intent)){
    const resolved=await admin.from('commercial_command_confirmations').select('*').eq('organization_id',org).eq('resolution_command_event_id',event.id).maybeSingle();if(resolved.error)throw resolved.error
    if(resolved.data)return resolved.data.status==='confirmed'?'Operação comercial já confirmada ✓':'Operação comercial cancelada. Nada foi registrado.'
    const pending=await pendingCommercial(admin,event)
    if(pending)return confirmCommercial(admin,event,pending,command.intent==='CANCEL_FINANCIAL')
  }
  if(['ACTIVITY_START','ACTIVITY_COMPLETE','RECORD_DECISION','RECORD_OBSERVATION','RECORD_TIME'].includes(command.intent)){
    const types:any={ACTIVITY_START:'activity_started',ACTIVITY_COMPLETE:'activity_completed',RECORD_DECISION:'client_decision',RECORD_OBSERVATION:'observation_added',RECORD_TIME:'time_recorded'}
    const titles:any={ACTIVITY_START:'Atividade iniciada',ACTIVITY_COMPLETE:'Atividade concluída',RECORD_DECISION:'Decisão registrada',RECORD_OBSERVATION:'Observação registrada',RECORD_TIME:'Horas registradas'}
    await recordEvent(admin,event,types[command.intent],titles[command.intent],command.summary||event.raw_text,{hours:command.hours||null,due_date:command.due_date||null})
    return command.intent==='RECORD_TIME'?`${command.hours} hora${command.hours===1?'':'s'} registrada${command.hours===1?'':'s'} ✓`:`${titles[command.intent]} ✓`
  }
  if(['FINANCIAL_RECEIPT_REQUEST','FREELANCE_INCOME_REQUEST'].includes(command.intent)){
    if(!Number.isFinite(command.amount)||command.amount<=0)return 'Não identifiquei um valor válido para confirmar.'
    const prior=await admin.from('financial_command_confirmations').select('*').eq('organization_id',org).eq('team_member_id',event.team_member_id).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle();if(prior.error)throw prior.error
    if(prior.data)return{status:'confirmation_required',reply:`Já existe uma confirmação financeira pendente de ${brl(Number(prior.data.amount))}. Responda “sim” ou “não”.`}
    if(command.intent==='FREELANCE_INCOME_REQUEST'){
      const description=clean(command.project_source||'Freela')
      const inserted=await admin.from('financial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,amount:command.amount,description,action_type:'freelance_income',payload:{project_source:description,date:command.due_date||today()}}).select('id').single();if(inserted.error)throw inserted.error
      return{status:'confirmation_required',reply:`Registrar ${brl(command.amount)} do freela ${description} no Caixa Freela? Responda “sim” ou “não”.`}
    }
    const rows=await admin.from('invoice_installments').select('id,amount,received_amount,status,due_date,clients(company_name)').eq('organization_id',org).in('status',['pending','partial','overdue']).limit(200);if(rows.error)throw rows.error
    const needle=foldText(command.subject_query),matches=(rows.data||[]).filter((item:any)=>foldText(item.clients?.company_name).includes(needle)&&Math.abs((Number(item.amount)-Number(item.received_amount||0))-Number(command.amount))<0.01)
    if(matches.length!==1)return 'Não encontrei uma única cobrança em aberto com esse cliente e valor. Confira os dados antes de confirmar.'
    const installment=matches[0],description=installment.clients?.company_name||clean(command.subject_query)
    const inserted=await admin.from('financial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,amount:command.amount,description,action_type:'receipt',payload:{installment_id:installment.id}}).select('id').single();if(inserted.error)throw inserted.error
    return{status:'confirmation_required',reply:`Confirmar recebimento de ${brl(command.amount)} de ${description}? Responda “sim” ou “não”.`}
  }
  if(command.intent==='FINANCIAL_EXPENSE_REQUEST'){
    if(!Number.isFinite(command.amount)||command.amount<=0)return 'Não identifiquei um valor válido. Ex.: “gastei 106 reais em tráfego”.'
    const prior=await admin.from('financial_command_confirmations').select('id,amount,description,status').eq('organization_id',org).eq('team_member_id',event.team_member_id).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle()
    if(prior.error)throw prior.error
    if(prior.data)return{status:'confirmation_required',reply:`Já existe uma confirmação pendente: registrar ${brl(Number(prior.data.amount))} em ${prior.data.description}? Responda “sim” ou “não”.`}
    const inserted=await admin.from('financial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,amount:command.amount,description:clean(command.description||command.category_name||'Despesa'),category_name:clean(command.category_name||'')||null,action_type:'expense'}).select('id').single()
    if(inserted.error)throw inserted.error
    await recordEvent(admin,event,'financial_confirmation_requested','Confirmação financeira solicitada',event.raw_text,{confirmation_id:inserted.data.id,amount:command.amount})
    return{status:'confirmation_required',reply:`Registrar despesa de ${brl(command.amount)} em ${clean(command.category_name||command.description||'Despesa')}? Responda “sim” ou “não”.`}
  }
  if(['CONFIRM_FINANCIAL','CANCEL_FINANCIAL'].includes(command.intent)){
    const resolved=await admin.from('financial_command_confirmations').select('*').eq('organization_id',org).eq('resolution_command_event_id',event.id).maybeSingle()
    if(resolved.error)throw resolved.error
    if(resolved.data){if(resolved.data.status!=='confirmed')return 'Lançamento cancelado. Nada foi registrado.';if(resolved.data.action_type==='receipt')return `Recebimento de ${brl(Number(resolved.data.amount))} confirmado ✓`;if(resolved.data.action_type==='freelance_income')return `Entrada de ${brl(Number(resolved.data.amount))} registrada no Caixa Freela ✓`;return `Despesa de ${brl(Number(resolved.data.amount))} registrada ✓`}
    const pending=await admin.from('financial_command_confirmations').select('*').eq('organization_id',org).eq('team_member_id',event.team_member_id).eq('status','pending').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle()
    if(pending.error)throw pending.error
    if(!pending.data)return 'Não há lançamento financeiro aguardando confirmação.'
    if(command.intent==='CANCEL_FINANCIAL'){
      const cancelled=await admin.from('financial_command_confirmations').update({status:'cancelled',resolution_command_event_id:event.id}).eq('id',pending.data.id).eq('status','pending');if(cancelled.error)throw cancelled.error
      await recordEvent(admin,event,'financial_confirmation_cancelled','Lançamento financeiro cancelado',pending.data.description,{confirmation_id:pending.data.id})
      return 'Lançamento cancelado. Nada foi registrado.'
    }
    if(pending.data.action_type==='receipt'){
      const installmentId=pending.data.payload?.installment_id;if(!installmentId)throw new Error('Confirmação sem parcela vinculada.')
      const receipt=await admin.rpc('confirm_installment_receipt_internal',{p_installment_id:installmentId,p_amount:pending.data.amount,p_command_event_id:event.id});if(receipt.error)throw receipt.error
      const confirmed=await admin.from('financial_command_confirmations').update({status:'confirmed',confirmed_at:new Date().toISOString(),resolution_command_event_id:event.id}).eq('id',pending.data.id).eq('status','pending');if(confirmed.error)throw confirmed.error
      await recordEvent(admin,event,'financial_receipt_confirmed','Recebimento confirmado',pending.data.description,{confirmation_id:pending.data.id,installment_id:installmentId,amount:pending.data.amount})
      return `Recebimento de ${brl(Number(pending.data.amount))} confirmado ✓`
    }
    if(pending.data.action_type==='freelance_income'){
      const movementDate=pending.data.payload?.date||today(),movement=await admin.from('freelance_cash_movements').upsert({organization_id:org,project_source:pending.data.payload?.project_source||pending.data.description,type:'income',status:'received',amount:pending.data.amount,movement_date:movementDate,competence:`${movementDate.slice(0,7)}-01`,planned_destination:'undecided',applied:false,scope:'business',idempotency_key:`whatsapp-freelance-${pending.data.id}`,notes:'Confirmado por comando interno.'},{onConflict:'organization_id,idempotency_key'}).select('id').single();if(movement.error)throw movement.error
      const confirmed=await admin.from('financial_command_confirmations').update({status:'confirmed',confirmed_at:new Date().toISOString(),resolution_command_event_id:event.id}).eq('id',pending.data.id).eq('status','pending');if(confirmed.error)throw confirmed.error
      await recordEvent(admin,event,'freelance_income_confirmed','Entrada registrada no Caixa Freela',pending.data.description,{movement_id:movement.data.id,amount:pending.data.amount})
      return `Entrada de ${brl(Number(pending.data.amount))} registrada no Caixa Freela ✓`
    }
    let categoryId=null
    if(pending.data.category_name){const categories=await admin.from('expense_categories').select('id,name').eq('organization_id',org).eq('active',true);if(categories.error)throw categories.error;const needle=foldText(pending.data.category_name),match=(categories.data||[]).filter((item:any)=>foldText(item.name)===needle);categoryId=match.length===1?match[0].id:null}
    const importKey=`whatsapp-expense-${pending.data.id}`
    let expense=await admin.from('expenses').select('id').eq('organization_id',org).eq('import_key',importKey).maybeSingle();if(expense.error)throw expense.error
    if(!expense.data){expense=await admin.from('expenses').insert({organization_id:org,name:pending.data.description,category_id:categoryId,scope:'business',total_amount:pending.data.amount,business_percentage:100,recurrence_type:'once',start_date:today(),due_day:Number(today().slice(-2)),status:'pending',validated:false,created_by:event.team_member?.auth_profile_id||null,import_key:importKey,notes:'Registrada por comando interno com confirmação explícita.'}).select('id').single();if(expense.error)throw expense.error}
    const installment=await admin.from('expense_installments').upsert({organization_id:org,expense_id:expense.data.id,reference_month:`${today().slice(0,7)}-01`,installment_number:1,due_date:today(),amount:pending.data.amount,business_amount:pending.data.amount,status:'pending',idempotency_key:importKey},{onConflict:'organization_id,expense_id,reference_month,installment_number',ignoreDuplicates:true});if(installment.error)throw installment.error
    const confirmed=await admin.from('financial_command_confirmations').update({status:'confirmed',expense_id:expense.data.id,confirmed_at:new Date().toISOString(),resolution_command_event_id:event.id}).eq('id',pending.data.id).eq('status','pending');if(confirmed.error)throw confirmed.error
    await recordEvent(admin,event,'financial_expense_confirmed','Despesa confirmada',pending.data.description,{confirmation_id:pending.data.id,expense_id:expense.data.id,amount:pending.data.amount})
    return `Despesa de ${brl(Number(pending.data.amount))} registrada ✓`
  }
  if (['LIST_MINE','LIST_TODAY','LIST_OVERDUE'].includes(command.intent)) {
    let query = admin.from('crm_tasks').select('id,title,status,priority,due_date').eq('organization_id', org).not('status', 'in', '(completed,cancelled)').order('due_date')
    if (command.intent === 'LIST_MINE') query = query.eq('assigned_to', event.team_member_id)
    if (command.intent === 'LIST_TODAY') query = query.eq('due_date', today())
    if (command.intent === 'LIST_OVERDUE') query = query.lt('due_date', today())
    const result = await query
    if (result.error) throw result.error
    return `${command.intent === 'LIST_OVERDUE' ? 'Tarefas atrasadas' : 'Meu dia'} — ${today()}\n\n${taskLines(result.data || [])}`
  }
  if (command.intent === 'LIST_TEAM') {
    const [members, tasks] = await Promise.all([admin.from('team_members').select('id,name').eq('organization_id', org).eq('active', true), admin.from('crm_tasks').select('assigned_to,status,due_date').eq('organization_id', org).eq('due_date', today())])
    if (members.error || tasks.error) throw members.error || tasks.error
    const needle=foldText(command.assignee_name);const selected=(members.data||[]).filter((member:any)=>!needle||foldText(member.name).includes(needle))
    if(command.assignee_name&&selected.length!==1)return `Não encontrei um único membro ativo chamado “${clean(command.assignee_name)}”.`
    return `Equipe hoje\n\n${selected.map((member: any) => { const mine = (tasks.data || []).filter((task: any) => task.assigned_to === member.id); return `${member.name}: ${mine.filter((task: any) => !['completed','cancelled'].includes(task.status)).length} pendentes · ${mine.filter((task: any) => task.status === 'completed').length} concluídas` }).join('\n')}`
  }
  if (command.intent === 'CREATE_TASK') {
    const assignee = await findMember(admin, event, command.assignee_name)
    if (command.assignee_name && !assignee) return `Não encontrei um único membro ativo chamado “${clean(command.assignee_name)}”. Confira o nome e tente novamente.`
    if (!clean(command.title) || !command.due_date) return 'Preciso do título e de uma data sem ambiguidade. Ex.: “cria tarefa para Julia revisar Roove amanhã”.'
    const existing=await admin.from('crm_tasks').select('id,title,due_date').eq('organization_id',org).eq('source_ref',event.id).maybeSingle()
    if(existing.error)throw existing.error
    const inserted = existing.data?{data:existing.data,error:null}:await admin.from('crm_tasks').insert({ organization_id: org, title: clean(command.title, 240), assigned_to: assignee?.id || event.team_member_id, due_date: command.due_date, priority: command.priority || 'medium', source: 'whatsapp', source_ref: event.id, metadata: { origin: 'whatsapp', command_event_id: event.id } }).select('id,title,due_date').single()
    if (inserted.error) throw inserted.error
    return `Tarefa criada ✓\n${taskShortId(inserted.data.id)} ${inserted.data.title}\nPrazo: ${inserted.data.due_date}`
  }
  if (['COMPLETE_TASK','START_TASK','MOVE_TASK','SET_PRIORITY','ASSIGN_TASK'].includes(command.intent)) {
    const task = await findTask(admin, event, command)
    if (!task) return 'Não encontrei uma única tarefa com essa referência. Use o código curto, por exemplo #A1B2C3.'
    const patch: any = { metadata: { ...(task.metadata || {}), origin: 'whatsapp', command_event_id: event.id } }
    if (command.intent === 'COMPLETE_TASK') { patch.status = 'completed'; patch.completed_at = new Date().toISOString() }
    if (command.intent === 'START_TASK') patch.status = 'in_progress'
    if (command.intent === 'MOVE_TASK') patch.due_date = command.due_date
    if (command.intent === 'SET_PRIORITY') patch.priority = command.priority
    if (command.intent === 'ASSIGN_TASK') { const member = await findMember(admin, event, command.assignee_name); if (!member) return 'Não encontrei um único responsável ativo com esse nome.'; patch.assigned_to = member.id }
    const changed = await admin.from('crm_tasks').update(patch).eq('id', task.id).eq('organization_id', org)
    if (changed.error) throw changed.error
    return `${taskShortId(task.id)} atualizada ✓`
  }
  if (command.intent === 'LIST_WAITING_ATTENDANCE') {
    if(command.subject_query){const result=await admin.from('whatsapp_conversations').select('assigned_team_member_id,whatsapp_contacts!inner(display_name,profile_name)').eq('organization_id',org).neq('status','closed').limit(200);if(result.error)throw result.error;const needle=foldText(command.subject_query),matches=(result.data||[]).filter((item:any)=>foldText(item.whatsapp_contacts?.display_name||item.whatsapp_contacts?.profile_name).includes(needle));if(matches.length!==1)return 'Não encontrei uma única conversa com esse nome.';if(!matches[0].assigned_team_member_id)return `${clean(command.subject_query)} ainda não tem responsável.`;const owner=await admin.from('team_members').select('name').eq('id',matches[0].assigned_team_member_id).eq('organization_id',org).maybeSingle();if(owner.error)throw owner.error;return owner.data?.name?`${clean(command.subject_query)} está com ${owner.data.name}.`:`${clean(command.subject_query)} ainda não tem responsável.`}
    const result = await admin.from('whatsapp_conversations').select('id,wa_id,handoff_reason,whatsapp_contacts(display_name,profile_name)').eq('organization_id', org).eq('status', 'pending').eq('automation_paused', true)
    if (result.error) throw result.error
    const lines = (result.data || []).map((item: any) => `• ${item.whatsapp_contacts?.display_name || item.whatsapp_contacts?.profile_name || `final ${item.wa_id.slice(-4)}`}`)
    return lines.length ? `Aguardando atendimento: ${lines.length}\n\n${lines.join('\n')}` : 'Ninguém está aguardando atendimento humano.'
  }
  if (command.intent === 'LIST_PENDING_CHARGES') {
    const result = await admin.from('invoice_installments').select('id,due_date,amount,clients(company_name)').eq('organization_id', org).in('status', ['pending','overdue']).order('due_date').limit(20)
    if (result.error) throw result.error
    return (result.data || []).length ? `Cobranças pendentes: ${result.data.length}\n\n${result.data.map((item: any) => `• ${item.clients?.company_name || 'Cliente'} — ${item.due_date}`).join('\n')}` : 'Não há cobranças pendentes no CRM.'
  }
  if (['ASSIGN_CONVERSATION','TAKE_CONVERSATION','PAUSE_AUTOMATION','RESUME_AUTOMATION'].includes(command.intent)) {
    const contacts = await admin.from('whatsapp_conversations').select('id,connection_id,assigned_to,whatsapp_contacts(display_name,profile_name)').eq('organization_id', org).neq('status', 'closed').limit(200)
    if (contacts.error) throw contacts.error
    const needle = foldText(command.subject_query)
    const matches = (contacts.data || []).filter((item: any) => needle && foldText(item.whatsapp_contacts?.display_name || item.whatsapp_contacts?.profile_name).includes(needle))
    if (matches.length !== 1) return 'Não encontrei uma única conversa com esse nome. Informe o nome como aparece na Caixa de entrada.'
    const conversation = matches[0]; const patch: any = {}; let member = event.team_member
    if (command.intent === 'ASSIGN_CONVERSATION') { member = await findMember(admin, event, command.assignee_name); if (!member) return 'Não encontrei um único responsável ativo com esse nome.' }
    if (['ASSIGN_CONVERSATION','TAKE_CONVERSATION'].includes(command.intent)) Object.assign(patch, { assigned_to: member?.auth_profile_id || null, assigned_team_member_id: member?.id || event.team_member_id, assigned_at: new Date().toISOString(), attendance_mode: 'human', status: 'open', automation_paused: true })
    if (command.intent === 'PAUSE_AUTOMATION') Object.assign(patch, { automation_paused: true, attendance_mode: 'paused' })
    if (command.intent === 'RESUME_AUTOMATION') Object.assign(patch, { automation_paused: false, attendance_mode: 'bot' })
    const changed = await admin.from('whatsapp_conversations').update(patch).eq('id', conversation.id).eq('organization_id', org)
    if (changed.error) throw changed.error
    await admin.from('whatsapp_conversation_events').insert({ organization_id: org, connection_id: conversation.connection_id, conversation_id: conversation.id, event_type: foldText(command.intent), actor_id: event.team_member?.auth_profile_id || null, details: { source: 'whatsapp_command', command_event_id: event.id } })
    return 'Conversa atualizada ✓'
  }
  return HELP_TEXT
}

async function processEvent(admin: any, event: any) {
  const claimed = await admin.from('task_command_events').update({ status: 'processing', attempts: Number(event.attempts || 0) + 1 }).eq('id', event.id).in('status', ['pending','failed']).select('id').maybeSingle()
  if (claimed.error || !claimed.data) return false
  try {
    let command: any = ['document','image'].includes(event.message_type)&&event.media?.id
      ? {intent:'ATTACH_PROPOSAL_FILE',confidence:1}
      : parseInternalCommand(event.raw_text)
    if(command.intent==='UNKNOWN'){
      const awaiting=await pendingCommercial(admin,event)
      command=awaiting?.action_type==='proposal_attachment'&&awaiting.status==='awaiting_context'
        ? {intent:'ATTACH_PROPOSAL_FILE',context_query:event.raw_text,confidence:1}
        : await aiFallback(event.raw_text)||command
    }
    const member = await admin.from('team_members').select('id,name,auth_profile_id').eq('id', event.team_member_id).eq('organization_id', event.organization_id).eq('active', true).single()
    if (member.error) throw Object.assign(new Error('Membro interno não está mais ativo.'), { code: 'TEAM_MEMBER_INACTIVE' })
    event.team_member = member.data
    await recordEvent(admin,event,'whatsapp_command','Comando interno recebido',event.raw_text||event.media?.filename||event.message_type,{intent:command.intent,message_type:event.message_type})
    const outcome:any = command.intent === 'UNKNOWN' ? HELP_TEXT : await execute(admin, event, command)
    const reply=typeof outcome==='string'?outcome:outcome.reply
    const providerMessageId = await sendReply(admin, event, reply)
    await admin.from('task_command_events').update({ status: outcome?.status||'completed', parsed_command: command, result: { reply, provider_message_id: providerMessageId }, processed_at: new Date().toISOString(), error_code: null, error_message: null }).eq('id', event.id)
    return true
  } catch (error: any) {
    const attempts = Number(event.attempts || 0) + 1
    const terminal = attempts >= 6 || ['TEAM_MEMBER_INACTIVE','META_CONFIGURATION_MISSING'].includes(error?.code)
    await admin.from('task_command_events').update({ status: terminal ? 'dead_letter' : 'failed', next_attempt_at: new Date(Date.now() + Math.min(3600, 2 ** attempts * 30) * 1000).toISOString(), error_code: clean(error?.code || error?.name, 100), error_message: clean(error?.message, 500), processed_at: terminal ? new Date().toISOString() : null }).eq('id', event.id)
    return false
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const expected = Deno.env.get('TASK_COMMAND_WORKER_KEY') || ''
  if (!expected || request.headers.get('X-Task-Command-Worker-Key') !== expected) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ ok: false, code: 'CONFIGURATION_MISSING' }, 503)
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const due = await admin.from('task_command_events').select('*').in('status', ['pending','failed']).lte('next_attempt_at', new Date().toISOString()).order('created_at').limit(20)
  if (due.error) return json({ ok: false, code: 'QUEUE_READ_FAILED' }, 500)
  let processed = 0
  for (const event of due.data || []) if (await processEvent(admin, event)) processed += 1
  return json({ ok: true, claimed: due.data?.length || 0, processed })
})
