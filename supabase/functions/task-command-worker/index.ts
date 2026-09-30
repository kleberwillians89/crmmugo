// Processa comandos internos fora do webhook. Deploy e scheduler são manuais.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TASK_COMMAND_WORKER_KEY,
// META_ACCESS_TOKEN e, opcionalmente, OPENAI_API_KEY/TASK_COMMAND_MODEL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { HELP_TEXT, REFERENTIAL_ALL_WORDS, REFERENTIAL_ORDINAL_MAP, foldReferential, foldText, isTaskCreationCommandOnly, parseInternalCommand, parseTaskSchedule, resolveRelativeDate, splitInlineNumberedList, taskShortId, taskTitleFromText } from '../_shared/internalCommandCore.js'
import { getMemberTaskReadModel } from '../_shared/internalAssistantReadModel.js'
import { planInternalSecretaryMessage, runSecretaryActions, secretaryActionToCommand } from '../_shared/internalSecretaryAgent.js'

const headers = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const clean = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const tomorrowDate = () => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
const describeDatePt = (dueDate: string) => {
  const ddmm = `${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}`
  if (dueDate === today()) return `hoje, ${ddmm}`
  if (dueDate === tomorrowDate()) return `amanhã, ${ddmm}`
  return ddmm
}
// due_date é uma DATE (sem timezone) — só reordena os dígitos, nunca reconstrói via new Date().
const ddmmyyyy = (dueDate: string) => { const [y, m, d] = String(dueDate).split('-'); return `${d}/${m}/${y}` }
// created_at é um timestamptz real — precisa converter para America/Sao_Paulo (nunca due_date, que é
// só o prazo; "registrada em" é sempre o momento real do INSERT).
const formatRegisteredAt = (createdAt: string) => {
  const date = new Date(createdAt)
  const datePart = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
  const timePart = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(date)
  return `${datePart} às ${timePart}`
}
// HELP nunca é fallback universal — reservado para pedidos explícitos de ajuda (ver GREETING_PATTERN/
// HELP_PATTERN no parser). Texto livre não reconhecido recebe uma pergunta de esclarecimento genérica.
const CLARIFY_TEXT = 'Não entendi esse comando. Pode me dizer de outro jeito o que você precisa?'
const ALLOWED_INTENTS = new Set(['CREATE_TASK','LIST_TODAY','LIST_MINE','LIST_TEAM','LIST_OVERDUE','DAY_SUMMARY','WEEK_SUMMARY','PLAN_MY_DAY','COMPLETE_TASK','START_TASK','CANCEL_TASK','UPDATE_TASK_STATUS','MOVE_TASK','SET_PRIORITY','ASSIGN_TASK','LIST_WAITING_ATTENDANCE','ASSIGN_CONVERSATION','TAKE_CONVERSATION','PAUSE_AUTOMATION','RESUME_AUTOMATION','LIST_PENDING_CHARGES','ACTIVITY_START','ACTIVITY_COMPLETE','ACTIVITY_DATE_RESOLUTION','RECORD_DECISION','RECORD_OBSERVATION','RECORD_TIME','RECORD_PROPOSAL','UPDATE_PROPOSAL','ATTACH_PROPOSAL_FILE','FINANCIAL_EXPENSE_REQUEST','FINANCIAL_RECEIPT_REQUEST','FREELANCE_INCOME_REQUEST','CONFIRM_FINANCIAL','CANCEL_FINANCIAL','COLLECTION_ACTIVITY','COLLECTION_SEND','FOLLOW_UP','CLIENT_UPDATE','DOCUMENT','QUERY_OVERDUE_RECEIVABLES','QUERY_RECEIVED_TOTAL','QUERY_EXPENSES','QUERY_PENDING_CONFIRMATIONS','QUERY_WEEKLY_HOURS','HELP'])
// Comandos que expõem ou movimentam financeiro empresarial/comercial sensível: exigem admin ou manager.
// Tarefas, atividades, horas, observações e solicitação de despesa continuam liberadas ao operador.
const FINANCIAL_ADMIN_INTENTS = new Set(['FINANCIAL_RECEIPT_REQUEST','FREELANCE_INCOME_REQUEST','COLLECTION_SEND','LIST_PENDING_CHARGES','RECORD_PROPOSAL','UPDATE_PROPOSAL','QUERY_OVERDUE_RECEIVABLES','QUERY_RECEIVED_TOTAL','QUERY_EXPENSES'])

// Contexto estruturado (intenção pendente, itens numerados já apresentados, últimas trocas) — a IA
// resolve continuação/referência/ambiguidade a partir disso, nunca inventando IDs ou registros.
async function aiFallback(rawText: string, context: Record<string, unknown> = {}) {
  const key = Deno.env.get('OPENAI_API_KEY') || ''
  if (!key) return null
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('TASK_COMMAND_MODEL') || Deno.env.get('OPENAI_MODEL') || '',
      input: [{ role: 'system', content: 'Classifique um comando operacional interno em português. Use o contexto de sessão (active_intent, state, candidate_items, mensagens recentes) para resolver continuações e referências. Nunca invente IDs, registros ou dados fora do contexto recebido. Retorne somente JSON.' }, { role: 'user', content: JSON.stringify({ message: rawText, ...context }) }],
      text: { format: { type: 'json_schema', name: 'task_command', strict: true, schema: { type: 'object', additionalProperties: false, properties: { intent: { type: 'string', enum: [...ALLOWED_INTENTS] }, title: { type: ['string','null'] }, assignee_name: { type: ['string','null'] }, task_short_id: { type: ['string','null'] }, subject_query: { type: ['string','null'] }, priority: { type: ['string','null'], enum: ['low','medium','high','critical',null] }, due_date: { type: ['string','null'] }, summary:{type:['string','null']},amount:{type:['number','null']},hours:{type:['number','null']},category_name:{type:['string','null']},description:{type:['string','null']},project_source:{type:['string','null']},service:{type:['string','null']},currency:{type:['string','null']},proposal_status:{type:['string','null']},collection_kind:{type:['string','null'],enum:['contacted','unpaid_status','promised',null]},period:{type:['string','null'],enum:['today','month',null]},month_name:{type:['string','null']} }, required: ['intent','title','assignee_name','task_short_id','subject_query','priority','due_date','summary','amount','hours','category_name','description','project_source','service','currency','proposal_status','collection_kind','period','month_name'] } } },
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
// Busca natural por título/palavras — short id é só um fallback, nunca obrigatório. Retorna
// {kind:'one'|'ambiguous'|'none'} para o chamador decidir entre executar direto ou listar opções.
const findTask = async (admin: any, event: any, command: any) => {
  if (command.task_short_id) {
    const result=await admin.rpc('resolve_crm_task_short_id',{p_organization_id:event.organization_id,p_short_id:command.task_short_id})
    if(result.error)throw result.error
    return result.data?.length===1?{kind:'one',item:result.data[0]}:{kind:'none',items:[]}
  }
  const needle = foldText(command.task_query)
  if (!needle) return { kind: 'none', items: [] }
  const result = await admin.from('crm_tasks').select('id,title,status,due_date,priority,metadata').eq('organization_id', event.organization_id).not('status', 'in', '(completed,cancelled)').limit(500)
  if (result.error) throw result.error
  const rows = result.data || []
  const exact = rows.filter((item: any) => foldText(item.title) === needle)
  if (exact.length === 1) return { kind: 'one', item: exact[0] }
  if (exact.length > 1) return { kind: 'ambiguous', items: exact }
  const matches = rows.filter((item: any) => foldText(item.title).includes(needle) || needle.includes(foldText(item.title)))
  return matches.length === 1 ? { kind: 'one', item: matches[0] } : matches.length > 1 ? { kind: 'ambiguous', items: matches } : { kind: 'none', items: [] }
}
// Aplica a ação de tarefa (usada tanto no acerto direto quanto após resolver a seleção numerada).
async function applyTaskAction(admin: any, event: any, task: any, intent: string, fields: any) {
  const patch: any = { metadata: { ...(task.metadata || {}), origin: 'whatsapp', command_event_id: event.id } }
  if (intent === 'COMPLETE_TASK') { patch.status = 'completed'; patch.completed_at = new Date().toISOString() }
  if (intent === 'START_TASK') patch.status = 'in_progress'
  if (intent === 'CANCEL_TASK') patch.status = 'cancelled'
  if (intent === 'UPDATE_TASK_STATUS') patch.status = fields.task_status
  if (intent === 'MOVE_TASK') patch.due_date = fields.due_date
  if (intent === 'SET_PRIORITY') patch.priority = fields.priority
  if (intent === 'ASSIGN_TASK') {
    const member = await findMember(admin, event, fields.assignee_name)
    if (!member) return { reply: 'Não encontrei um único responsável ativo com esse nome.' }
    patch.assigned_to = member.id
  }
  const changed = await admin.from('crm_tasks').update(patch).eq('id', task.id).eq('organization_id', event.organization_id)
  if (changed.error) throw changed.error
  event.entity_type = 'crm_tasks'; event.entity_id = task.id
  return { reply: `${taskShortId(task.id)} atualizada ✓` }
}
const taskLines = (items: any[]) => items.length ? items.slice(0, 15).map((item: any) => `${item.priority === 'high' || item.priority === 'critical' ? '🔴' : '•'} ${taskShortId(item.id)} ${item.title}${item.due_date ? ` — ${item.due_date}` : ''}`).join('\n') : 'Nenhuma tarefa encontrada.'
const compactSecretaryCommands=(commands:any[])=>{
  const creates=commands.filter((item:any)=>item.intent==='CREATE_TASK')
  if(creates.length<2||new Set(creates.map((item:any)=>item.assignee_name||'')).size>1)return commands
  const first=creates[0]
  const items=creates.flatMap((item:any)=>Array.isArray(item.items)&&item.items.length?item.items:[{title:item.title,due_date:item.due_date,due_time:item.due_time,task_type:item.task_type}])
  const remaining=commands.filter((item:any)=>item.intent!=='CREATE_TASK')
  // CREATE_TASK sempre fica por último: ele pode abrir confirmação de data na sessão e nenhuma
  // action posterior deve limpar esse contexto antes da resposta do membro.
  return [...remaining,{...first,title:items[0]?.title||null,due_date:items[0]?.due_date||null,items}]
}
const brl=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value)
const dayWindow=(day:string=today())=>({start:`${day}T00:00:00-03:00`,end:`${day}T23:59:59.999-03:00`})
const friendlyFailure=(error:any)=>{
  const code=clean(error?.code,100)
  if(['COLLECTION_ENGINE_MISSING','META_CONFIGURATION_MISSING'].includes(code))return 'Não consegui enviar agora porque o WhatsApp da Mugô está sem conexão com a Meta.'
  if(code==='COLLECTION_PHONE_MISSING')return 'Não consegui enviar porque esse cliente está sem telefone financeiro válido no CRMugo.'
  return null
}
// Financeiro/comercial sensível via WhatsApp exige perfil admin ou manager vinculado (mesmo padrão
// de public.can_write() no restante do CRM). Sem profile vinculado, o ator é tratado como operador.
async function isAdminActor(admin:any,event:any){
  if(!event.team_member?.auth_profile_id)return false
  const profile=await admin.from('profiles').select('role').eq('id',event.team_member.auth_profile_id).eq('organization_id',event.organization_id).eq('active',true).maybeSingle()
  if(profile.error)throw profile.error
  return ['admin','manager'].includes(profile.data?.role)
}
async function recordEvent(admin:any,event:any,type:string,title:string,description:string,metadata:any={},itemIndex:number|null=null,occurredAt:string|null=null){
  const actionPart=Number.isInteger(event.action_index)?`:action:${event.action_index}`:''
  const idempotencyKey=itemIndex===null?`command:${event.id}${actionPart}:${type}`:`command:${event.id}${actionPart}:${type}:${itemIndex}`
  const row:any={organization_id:event.organization_id,event_type:type,title,description:clean(description,1000),team_member_id:event.team_member_id,conversation_id:event.conversation_id,source:'whatsapp',metadata,idempotency_key:idempotencyKey}
  if(occurredAt)row.occurred_at=occurredAt
  const result=await admin.from('operational_events').upsert(row,{onConflict:'organization_id,idempotency_key',ignoreDuplicates:true}).select('id,occurred_at').maybeSingle()
  if(result.error)throw result.error
  if(result.data)return result.data
  const existing=await admin.from('operational_events').select('id,occurred_at').eq('organization_id',event.organization_id).eq('idempotency_key',idempotencyKey).maybeSingle()
  if(existing.error)throw existing.error
  if(!existing.data)throw Object.assign(new Error('A atividade não foi persistida.'),{code:'OPERATIONAL_EVENT_NOT_PERSISTED'})
  return existing.data
}

async function getAssistantSession(admin:any,event:any){
  const result=await admin.from('internal_assistant_sessions').select('*').eq('organization_id',event.organization_id).eq('team_member_id',event.team_member_id).eq('phone',event.wa_id).gt('expires_at',new Date().toISOString()).maybeSingle()
  if(result.error&&result.error.code!=='42P01')throw result.error
  return result.data||null
}
async function saveAssistantSession(admin:any,event:any,values:any){
  const result=await admin.from('internal_assistant_sessions').upsert({organization_id:event.organization_id,team_member_id:event.team_member_id,phone:event.wa_id,last_message_id:event.message_id||null,expires_at:new Date(Date.now()+30*60*1000).toISOString(),...values},{onConflict:'organization_id,team_member_id,phone'}).select().single()
  if(result.error)throw result.error
  event.session=result.data
  return result.data
}
async function clearAssistantSession(admin:any,event:any){
  const result=await admin.from('internal_assistant_sessions').update({state:'idle',active_intent:null,context:{},pending_action:null,pending_entity_type:null,pending_entity_id:null,expires_at:new Date().toISOString(),last_message_id:event.message_id||null}).eq('organization_id',event.organization_id).eq('team_member_id',event.team_member_id).eq('phone',event.wa_id)
  if(result.error&&result.error.code!=='42P01')throw result.error
  event.session=null
}
async function sendCollectionViaMugozap(event:any,installment:any){
  const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),workerKey=Deno.env.get('TASK_COMMAND_WORKER_KEY')
  if(!url||!serviceKey||!workerKey)throw Object.assign(new Error('Motor de cobrança não configurado.'),{code:'COLLECTION_ENGINE_MISSING'})
  const phone=clean(installment.clients?.billing_contact_phone||installment.clients?.phone,40)
  if(!phone)throw Object.assign(new Error('Cliente sem telefone financeiro válido.'),{code:'COLLECTION_PHONE_MISSING'})
  const response=await fetch(`${url}/functions/v1/mugozap-api`,{method:'POST',headers:{Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json','X-Task-Command-Worker-Key':workerKey},body:JSON.stringify({operation:'start_template_conversation',payload:{team_member_id:event.team_member_id,client_id:installment.client_id,installment_id:installment.id,phone,template_name:'mugo_alerta_pagamento_pendente',language:'pt_BR',idempotency_key:`internal-collection-${event.id}`}}),signal:AbortSignal.timeout(30_000)})
  const body=await response.json().catch(()=>({}))
  if(!response.ok||!body?.ok)throw Object.assign(new Error(body?.error?.message||body?.message||'Não foi possível enviar a cobrança.'),{code:body?.error?.code||body?.code||'COLLECTION_SEND_FAILED'})
  return body.data
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

// Resolve cliente citado DENTRO de um texto maior (ex.: "ajustar banner CAFIFA") só quando um único
// cliente aparece claramente mencionado; nunca associa por adivinhação quando ambíguo.
async function resolveClientMentionedIn(admin: any, organizationId: string, text: string) {
  const compact = foldText(text).replace(/[^a-z0-9]/g, '')
  if (compact.length < 4) return null
  const result = await admin.from('clients').select('id,company_name,trade_name').eq('organization_id', organizationId).neq('status', 'archived').limit(1000)
  if (result.error) throw result.error
  const matches = (result.data || []).filter((item: any) => [item.company_name, item.trade_name].some((value) => { const candidate = foldText(value).replace(/[^a-z0-9]/g, ''); return candidate.length >= 4 && compact.includes(candidate) }))
  return matches.length === 1 ? matches[0] : null
}

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
  if (command.intent === 'GREETING') {
    const firstName = clean(event.team_member?.name).split(' ')[0]
    const model=await getMemberTaskReadModel(admin,org,event.team_member_id,today())
    await saveAssistantSession(admin,event,{state:'awaiting_confirmation',active_intent:'PLAN_MY_DAY',context:{candidate_items:model.candidateItems},pending_action:'offer_plan_day',pending_entity_type:null,pending_entity_id:null})
    const taskCount=model.today.length,overdueCount=model.overdue.length
    return `${firstName?`Bom dia, ${firstName}.`:'Bom dia.'} Você tem ${taskCount} tarefa${taskCount===1?'':'s'} hoje e ${overdueCount} atrasada${overdueCount===1?'':'s'}. Quer que eu organize seu dia?`
  }
  if (FINANCIAL_ADMIN_INTENTS.has(command.intent) && !(await isAdminActor(admin, event))) {
    return 'Esse comando exige permissão financeira/comercial. Peça para um administrador confirmar.'
  }
  if(['CONFIRM_FINANCIAL','CANCEL_FINANCIAL'].includes(command.intent)&&event.session?.active_intent==='COLLECTION_SEND'){
    if(command.intent==='CANCEL_FINANCIAL'){await clearAssistantSession(admin,event);return 'Cobrança cancelada. Nenhuma mensagem foi enviada.'}
    if(!(await isAdminActor(admin,event)))return 'O envio de cobrança exige perfil admin ou manager.'
    const installment=await admin.from('invoice_installments').select('id,client_id,contract_id,reference_month,due_date,amount,received_amount,status,paid_at,clients(company_name,trade_name,phone,billing_contact_phone)').eq('organization_id',org).eq('id',event.session.pending_entity_id).in('status',['pending','overdue']).eq('received_amount',0).is('paid_at',null).single()
    if(installment.error)throw installment.error
    const sent=await sendCollectionViaMugozap(event,installment.data)
    await recordEvent(admin,event,'collection_sent','Cobrança enviada pelo WhatsApp',installment.data.clients?.trade_name||installment.data.clients?.company_name||'Cliente',{installment_id:installment.data.id,provider_message_id:sent?.provider_message_id||sent?.message_id||null})
    await clearAssistantSession(admin,event)
    event.entity_type='invoice_installments';event.entity_id=installment.data.id
    return `Enviado ✓\n${installment.data.clients?.trade_name||installment.data.clients?.company_name||'Cliente'} — ${brl(Number(installment.data.amount))}.`
  }
  // Cancelamento tem prioridade sobre qualquer contexto pendente na sessão (expense/activity/task
  // aguardando dados) — sem isso o usuário ficava preso a um fluxo incompleto sem saída explícita.
  if(command.intent==='CANCEL_FINANCIAL'&&event.session?.active_intent&&event.session.active_intent!=='COLLECTION_SEND'){
    await clearAssistantSession(admin,event)
    return 'Combinado, cancelei isso. Nada foi registrado.'
  }
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
  if(command.intent==='ACTIVITY_CAPTURE'){
    // Intenção neutra: não presume início nem fim. A próxima mensagem (com verbo/particípio, ou
    // livre) resolve para ACTIVITY_START/ACTIVITY_COMPLETE em processEvent.
    await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'ACTIVITY_CAPTURE',context:{},pending_action:'describe_activity',pending_entity_type:null,pending_entity_id:null})
    return 'Claro. Me conta o que você fez.'
  }
  if(['ACTIVITY_START','ACTIVITY_COMPLETE'].includes(command.intent)&&!clean(command.summary)&&!(Array.isArray(command.items)&&command.items.length)){
    return command.intent==='ACTIVITY_START'?'O que você começou?':'O que você terminou?'
  }
  // Mensagem com várias atividades (linhas ou referência tipo "os dois") gera um operational_event
  // POR item, com idempotency_key individual — nunca uma descrição genérica tipo "os dois trabalhos".
  if(['ACTIVITY_START','ACTIVITY_COMPLETE'].includes(command.intent)){
    const items:{summary:string}[]=Array.isArray(command.items)&&command.items.length?command.items:[{summary:command.summary}]
    const type=command.intent==='ACTIVITY_START'?'activity_started':'activity_completed'
    const title=command.intent==='ACTIVITY_START'?'Atividade iniciada':'Atividade concluída'
    const eventIds:string[]=[],effectiveDate=command.due_date||null,occurredAt=effectiveDate?`${effectiveDate}T12:00:00-03:00`:null
    for(let index=0;index<items.length;index+=1){
      const saved=await recordEvent(admin,event,type,title,clean(items[index].summary),{hours:command.hours||null,effective_date:effectiveDate,effective_date_pending:command.intent==='ACTIVITY_COMPLETE'&&!effectiveDate},items.length>1?index:null,occurredAt)
      if(saved?.id)eventIds.push(saved.id)
    }
    event.entity_type=type
    if(command.intent==='ACTIVITY_START'){
      const candidateItems=items.map((item,index)=>({index:index+1,type:'activity',summary:clean(item.summary,240)}))
      await saveAssistantSession(admin,event,{state:'idle',active_intent:'ACTIVITY_START',context:{activity_summary:clean(items[0].summary,240),candidate_items:candidateItems},pending_action:null,pending_entity_type:'operational_events',pending_entity_id:null})
      return items.length>1
        ? `Boa, registrei isso ✓\n\n${items.map((item,index)=>`${index+1}. ${clean(item.summary,180)}`).join('\n')} — atividades iniciadas.`
        : `Boa, registrei isso ✓\n${clean(items[0].summary,180)} — atividade iniciada.`
    }
    if(!effectiveDate){
      await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'ACTIVITY_DATE_CONFIRMATION',context:{operational_event_ids:eventIds,candidate_items:items.map((item,index)=>({index:index+1,type:'activity',event_id:eventIds[index]||null,label:clean(item.summary,240)}))},pending_action:'confirm_activity_date',pending_entity_type:'operational_events',pending_entity_id:eventIds[0]||null})
      return 'Fechado. Foi concluído hoje ou em outra data?'
    }
    await clearAssistantSession(admin,event)
    return items.length>1
      ? `Fechado. Registrei ${items.length} atividades concluídas ✓\n\n${items.map((item,index)=>`${index+1}. ${clean(item.summary,180)}`).join('\n')}`
      : `Fechado, registrei ✓\n${clean(items[0].summary,180)} — atividade concluída.`
  }
  if(command.intent==='ACTIVITY_DATE_RESOLUTION'){
    const ids=event.session?.context?.operational_event_ids||[]
    if(!ids.length||!command.due_date)return 'Qual foi a data? Pode responder “hoje”, “ontem”, “sexta” ou “dia 24”.'
    const rows=await admin.from('operational_events').select('id,metadata').eq('organization_id',org).in('id',ids)
    if(rows.error)throw rows.error
    for(const row of rows.data||[]){
      const changed=await admin.from('operational_events').update({occurred_at:`${command.due_date}T12:00:00-03:00`,metadata:{...(row.metadata||{}),effective_date:command.due_date,effective_date_pending:false}}).eq('organization_id',org).eq('id',row.id).select('id').maybeSingle()
      if(changed.error)throw changed.error
      if(!changed.data)throw Object.assign(new Error('A atividade não foi atualizada.'),{code:'OPERATIONAL_EVENT_NOT_UPDATED'})
    }
    await clearAssistantSession(admin,event)
    return `${ids.length===1?'Atividade atualizada':'Atividades atualizadas'} para ${command.due_date} ✓`
  }
  if(['RECORD_DECISION','RECORD_OBSERVATION','RECORD_TIME'].includes(command.intent)){
    const types:any={RECORD_DECISION:'client_decision',RECORD_OBSERVATION:'observation_added',RECORD_TIME:'time_recorded'}
    const titles:any={RECORD_DECISION:'Decisão registrada',RECORD_OBSERVATION:'Observação registrada',RECORD_TIME:'Horas registradas'}
    await recordEvent(admin,event,types[command.intent],titles[command.intent],command.summary||event.raw_text,{hours:command.hours||null,due_date:command.due_date||null})
    event.entity_type=types[command.intent]
    if(command.intent==='RECORD_TIME')return `Boa, ${command.hours} hora${command.hours===1?'':'s'} registrada${command.hours===1?'':'s'} ✓`
    if(command.intent==='RECORD_OBSERVATION')return `Anotado ✓\n${clean(command.summary||event.raw_text,180)}`
    return `${titles[command.intent]} ✓`
  }
  if(command.intent==='CLIENT_UPDATE'){
    const client=await findClient(admin,org,command.subject_query)
    if(client.kind==='ambiguous')return ambiguity(clean(command.subject_query),client.items)
    if(client.kind!=='one')return `Não encontrei o cliente “${clean(command.subject_query)}”. Registrei sem vínculo de cliente.`
    await recordEvent(admin,event,'client_update',`Atualização — ${client.item.trade_name||client.item.company_name}`,command.summary||event.raw_text,{client_id:client.item.id})
    event.entity_type='client_update';event.entity_id=client.item.id
    return `Anotado ✓\n${client.item.trade_name||client.item.company_name} — ${clean(command.summary,180)}\nQuer que eu crie uma tarefa para isso?`
  }
  if(command.intent==='COLLECTION_SEND'){
    if(!clean(command.subject_query))return 'Qual cliente você deseja cobrar?'
    const client=await findClient(admin,org,command.subject_query)
    if(client.kind==='ambiguous')return ambiguity(clean(command.subject_query),client.items)
    if(client.kind!=='one')return `Não encontrei o cliente “${clean(command.subject_query)}”. Nenhuma cobrança foi enviada.`
    const rows=await admin.from('invoice_installments').select('id,client_id,contract_id,reference_month,due_date,amount,received_amount,status,paid_at,clients(company_name,trade_name,phone,billing_contact_phone)').eq('organization_id',org).eq('client_id',client.item.id).in('status',['pending','overdue']).eq('received_amount',0).is('paid_at',null).order('due_date')
    if(rows.error)throw rows.error
    if(!rows.data?.length)return `${client.item.trade_name||client.item.company_name} não possui parcela elegível para cobrança.`
    if(rows.data.length>1){
      await saveAssistantSession(admin,event,{state:'awaiting_selection',active_intent:'COLLECTION_SEND',context:{installment_ids:rows.data.map((row:any)=>row.id)},pending_action:'select_collection_installment',pending_entity_type:'invoice_installments',pending_entity_id:null})
      return `Encontrei ${rows.data.length} parcelas:\n\n${rows.data.map((row:any,index:number)=>`${index+1}. ${brl(Number(row.amount))} — ${row.status==='overdue'?'vencida':`vence ${row.due_date}`}`).join('\n')}\n\nQual você quer cobrar?`
    }
    const installment=rows.data[0]
    await saveAssistantSession(admin,event,{state:'awaiting_confirmation',active_intent:'COLLECTION_SEND',context:{},pending_action:'send_collection_template',pending_entity_type:'invoice_installments',pending_entity_id:installment.id})
    return{status:'confirmation_required',reply:`Enviar cobrança de ${installment.clients?.trade_name||installment.clients?.company_name||clean(command.subject_query)} de ${brl(Number(installment.amount))}?`}
  }
  if(command.intent==='SESSION_SELECTION'&&event.session?.active_intent==='COLLECTION_SEND'){
    const ids=event.session.context?.installment_ids||[],index=Number(command.selection)-1
    if(!Number.isInteger(index)||index<0||index>=ids.length)return `Escolha um número entre 1 e ${ids.length}.`
    const row=await admin.from('invoice_installments').select('id,amount,clients(company_name,trade_name)').eq('organization_id',org).eq('id',ids[index]).in('status',['pending','overdue']).eq('received_amount',0).is('paid_at',null).single()
    if(row.error)throw row.error
    await saveAssistantSession(admin,event,{state:'awaiting_confirmation',active_intent:'COLLECTION_SEND',context:{},pending_action:'send_collection_template',pending_entity_type:'invoice_installments',pending_entity_id:row.data.id})
    return{status:'confirmation_required',reply:`Enviar cobrança de ${row.data.clients?.trade_name||row.data.clients?.company_name||'cliente'} de ${brl(Number(row.data.amount))}?`}
  }
  if(command.intent==='SESSION_SELECTION'&&event.session?.active_intent==='TASK_SELECTION'){
    const items=event.session.context?.candidate_items||[]
    const match=items.find((item:any)=>item.index===Number(command.selection))
    if(!match)return `Escolha um número entre 1 e ${items.length}.`
    const task=await admin.from('crm_tasks').select('id,title,status,metadata').eq('organization_id',org).eq('id',match.task_id).maybeSingle()
    if(task.error)throw task.error
    if(!task.data)return 'Essa tarefa não existe mais.'
    const taskIntent=event.session.context?.pending_task_intent,fields=event.session.context?.pending_task_fields||{}
    const outcome=await applyTaskAction(admin,event,task.data,taskIntent,fields)
    await clearAssistantSession(admin,event)
    return outcome.reply
  }
  if(command.intent==='SESSION_SELECTION'&&event.session?.active_intent==='TASK_BROWSE'){
    const items=event.session.context?.candidate_items||[],match=items.find((item:any)=>item.index===Number(command.selection))
    if(!match)return `Escolha um número entre 1 e ${items.length}.`
    await saveAssistantSession(admin,event,{state:'idle',active_intent:'TASK_BROWSE',context:{candidate_items:items,selected_task:match},pending_action:null,pending_entity_type:'crm_tasks',pending_entity_id:match.task_id})
    return `${match.index}. ${match.label}${match.due_date?` — ${match.due_date}`:''}\n\nVocê pode dizer “comecei ela” ou “finalizei”.`
  }
  if(command.intent==='TASK_CONTEXT_LIST'){
    const items=event.session?.context?.candidate_items||[]
    return items.length?items.map((item:any)=>`${item.index}. ${item.label}${item.due_date<today()?' — atrasada':''}`).join('\n'):'Você não tem tarefas para hoje nem atrasadas.'
  }
  if(command.intent==='CONVERSATION_CONTEXT'){
    const conversationId=clean(command.conversation_id,80)
    const context=await admin.from('whatsapp_conversations').select('id,opportunity_id,whatsapp_contacts(display_name,profile_name),commercial_opportunities(name,conversation_summary,next_action,service_interests)').eq('organization_id',org).eq('id',conversationId).maybeSingle()
    if(context.error)throw context.error
    if(!context.data)return 'Essa conversa não está mais disponível.'
    const opportunity=context.data.commercial_opportunities,lead=context.data.whatsapp_contacts?.display_name||context.data.whatsapp_contacts?.profile_name||opportunity?.name||'Lead'
    return [`Contexto de ${lead}:`,opportunity?.conversation_summary||'Resumo ainda não disponível.',opportunity?.service_interests?.length?`Interesses: ${opportunity.service_interests.join(' + ')}`:null,opportunity?.next_action?`Próximo passo: ${opportunity.next_action}`:null].filter(Boolean).join('\n')
  }
  if(command.intent==='TAKE_CONVERSATION_BY_ID'){
    const conversationId=clean(command.conversation_id,80),conversation=await admin.from('whatsapp_conversations').select('id,connection_id').eq('organization_id',org).eq('id',conversationId).neq('status','closed').maybeSingle()
    if(conversation.error)throw conversation.error
    if(!conversation.data)return 'Essa conversa não está mais disponível.'
    const changed=await admin.from('whatsapp_conversations').update({assigned_to:event.team_member?.auth_profile_id||null,assigned_team_member_id:event.team_member_id,assigned_at:new Date().toISOString(),attendance_mode:'human',status:'open',automation_paused:true}).eq('id',conversationId).eq('organization_id',org)
    if(changed.error)throw changed.error
    await admin.from('whatsapp_conversation_events').insert({organization_id:org,connection_id:conversation.data.connection_id,conversation_id:conversationId,event_type:'take_conversation',actor_id:event.team_member?.auth_profile_id||null,details:{source:'whatsapp_notification',command_event_id:event.id}})
    await clearAssistantSession(admin,event)
    return 'Conversa assumida ✓'
  }
  if(command.intent==='COLLECTION_ACTIVITY'){
    const client=await findClient(admin,org,command.subject_query)
    if(client.kind==='ambiguous')return ambiguity(clean(command.subject_query),client.items)
    if(client.kind!=='one')return `Não encontrei o cliente “${clean(command.subject_query)}”. Nenhuma cobrança foi registrada.`
    const overdue=await admin.from('invoice_installments').select('id').eq('organization_id',org).eq('client_id',client.item.id).in('status',['pending','partial','overdue']).lt('due_date',today()).limit(1);if(overdue.error)throw overdue.error
    const titles:any={contacted:'Cobrança registrada',unpaid_status:'Pendência de pagamento registrada',promised:'Promessa de pagamento registrada'}
    await recordEvent(admin,event,'collection_activity',titles[command.collection_kind]||'Cobrança registrada',event.raw_text,{client_id:client.item.id,collection_kind:command.collection_kind,overdue_installment_id:overdue.data?.[0]?.id||null,promised_for:command.due_date||null})
    if(command.collection_kind==='promised'&&command.due_date){const promise=await admin.from('collection_payment_promises').upsert({organization_id:org,client_id:client.item.id,installment_id:overdue.data?.[0]?.id||null,team_member_id:event.team_member_id,promised_for:command.due_date,follow_up_at:`${command.due_date}T12:00:00-03:00`,observation:event.raw_text,source:'whatsapp',source_ref:event.id,created_by:event.team_member?.auth_profile_id||null},{onConflict:'organization_id,source,source_ref'});if(promise.error)throw promise.error}
    event.entity_type='collection_activity';event.entity_id=client.item.id
    const label=client.item.trade_name||client.item.company_name
    if(command.collection_kind==='promised')return `Registrado ✓\n${label} — promessa de pagamento anotada.\nO recebível original permanece em aberto até confirmação.`
    if(command.collection_kind==='unpaid_status')return `Registrado ✓\n${label} — ainda não pago. Nada foi marcado como recebido.`
    return `Cobrança registrada ✓\n${label}${overdue.data?.length?' — recebível vencido localizado.':''}`
  }
  if(command.intent==='FOLLOW_UP'){
    const client=await findClient(admin,org,command.subject_query)
    const title=`Cobrar ${client.kind==='one'?(client.item.trade_name||client.item.company_name):clean(command.subject_query)}`
    const existing=await admin.from('crm_tasks').select('id,due_date').eq('organization_id',org).eq('source_ref',event.id).maybeSingle();if(existing.error)throw existing.error
    const inserted=existing.data?{data:existing.data,error:null}:await admin.from('crm_tasks').insert({organization_id:org,title:clean(title,240),category:'Trabalho',assigned_to:event.team_member_id,due_date:command.due_date||today(),client_id:client.kind==='one'?client.item.id:null,priority:'medium',source:'whatsapp',source_ref:event.id,metadata:{origin:'whatsapp',command_event_id:event.id,follow_up:true}}).select('id,due_date').single()
    if(inserted.error)throw inserted.error
    event.entity_type='crm_tasks';event.entity_id=inserted.data.id
    return `Lembrete criado ✓\n${title}\nPrazo: ${inserted.data.due_date}`
  }
  if(command.intent==='DOCUMENT'){
    const client=await findClient(admin,org,command.subject_query)
    const label=client.kind==='one'?(client.item.trade_name||client.item.company_name):clean(command.subject_query)||'sem cliente identificado'
    await recordEvent(admin,event,'document_mentioned','Documento mencionado',event.raw_text,{client_id:client.kind==='one'?client.item.id:null})
    return `Entendido — aguardando o arquivo${label!=='sem cliente identificado'?` de ${label}`:''}. Envie a imagem/PDF que eu vinculo. Nada financeiro é registrado só pelo comprovante chegar.`
  }
  if(['FINANCIAL_RECEIPT_REQUEST','FREELANCE_INCOME_REQUEST'].includes(command.intent)){
    if(!Number.isFinite(command.amount)||command.amount<=0)return 'Não identifiquei um valor válido para confirmar.'
    if(command.intent==='FINANCIAL_RECEIPT_REQUEST'&&!clean(command.subject_query))return `De quem recebemos ${brl(command.amount)}?`
    const prior=await admin.from('financial_command_confirmations').select('*').eq('organization_id',org).eq('team_member_id',event.team_member_id).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle();if(prior.error)throw prior.error
    if(prior.data)return{status:'confirmation_required',reply:`Já existe uma confirmação financeira pendente de ${brl(Number(prior.data.amount))}. Responda “sim” ou “não”.`}
    if(command.intent==='FREELANCE_INCOME_REQUEST'){
      const description=clean(command.project_source||'Freela')
      const inserted=await admin.from('financial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,amount:command.amount,description,action_type:'freelance_income',payload:{project_source:description,date:command.due_date||today()}}).select('id').single();if(inserted.error)throw inserted.error
      return{status:'confirmation_required',reply:`Registrar ${brl(command.amount)} do freela ${description} no Caixa Freela? Responda “sim” ou “não”.`}
    }
    const rows=await admin.from('invoice_installments').select('id,amount,received_amount,status,due_date,reference_month,clients(company_name)').eq('organization_id',org).in('status',['pending','partial','overdue']).limit(200);if(rows.error)throw rows.error
    const needle=foldText(command.subject_query),matches=(rows.data||[]).filter((item:any)=>foldText(item.clients?.company_name).includes(needle)&&Math.abs((Number(item.amount)-Number(item.received_amount||0))-Number(command.amount))<0.01)
    if(matches.length!==1)return 'Não encontrei uma única cobrança em aberto com esse cliente e valor. Confira os dados antes de confirmar.'
    const installment=matches[0],description=installment.clients?.company_name||clean(command.subject_query)
    const competence=installment.reference_month?new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${installment.reference_month}T12:00:00Z`)):null
    const inserted=await admin.from('financial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,amount:command.amount,description,action_type:'receipt',payload:{installment_id:installment.id,competence}}).select('id').single();if(inserted.error)throw inserted.error
    return{status:'confirmation_required',reply:`Encontrei ${description}${competence?` — ${competence.replace(/^./,(c)=>c.toUpperCase())}`:''} — ${brl(command.amount)}.\nConfirmar recebimento?`}
  }
  if(command.intent==='FINANCIAL_EXPENSE_REQUEST'){
    if(!Number.isFinite(command.amount)||command.amount<=0)return 'Qual foi o valor do gasto?'
    if(!clean(command.category_name)&&!clean(command.description)){await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'FINANCIAL_EXPENSE_REQUEST',context:{amount:command.amount},pending_action:'describe_expense',pending_entity_type:null,pending_entity_id:null});return `Com o que foram os ${brl(command.amount)}?`}
    const prior=await admin.from('financial_command_confirmations').select('id,amount,description,status').eq('organization_id',org).eq('team_member_id',event.team_member_id).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle()
    if(prior.error)throw prior.error
    if(prior.data)return{status:'confirmation_required',reply:`Já existe uma confirmação pendente: registrar ${brl(Number(prior.data.amount))} em ${prior.data.description}? Responda “sim” ou “não”.`}
    const inserted=await admin.from('financial_command_confirmations').insert({organization_id:org,command_event_id:event.id,team_member_id:event.team_member_id,amount:command.amount,description:clean(command.description||command.category_name||'Despesa'),category_name:clean(command.category_name||'')||null,action_type:'expense'}).select('id').single()
    if(inserted.error)throw inserted.error
    await recordEvent(admin,event,'financial_confirmation_requested','Confirmação financeira solicitada',event.raw_text,{confirmation_id:inserted.data.id,amount:command.amount})
    return{status:'confirmation_required',reply:`Registrar ${brl(command.amount)} em ${clean(command.category_name||command.description||'Despesa')}?`}
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
      event.entity_type='invoice_installments';event.entity_id=installmentId
      return `Recebimento registrado ✓\n${pending.data.description} — ${brl(Number(pending.data.amount))}.`
    }
    if(pending.data.action_type==='freelance_income'){
      const movementDate=pending.data.payload?.date||today(),movement=await admin.from('freelance_cash_movements').upsert({organization_id:org,project_source:pending.data.payload?.project_source||pending.data.description,type:'income',status:'received',amount:pending.data.amount,movement_date:movementDate,competence:`${movementDate.slice(0,7)}-01`,planned_destination:'undecided',applied:false,scope:'business',idempotency_key:`whatsapp-freelance-${pending.data.id}`,notes:'Confirmado por comando interno.'},{onConflict:'organization_id,idempotency_key'}).select('id').single();if(movement.error)throw movement.error
      const confirmed=await admin.from('financial_command_confirmations').update({status:'confirmed',confirmed_at:new Date().toISOString(),resolution_command_event_id:event.id}).eq('id',pending.data.id).eq('status','pending');if(confirmed.error)throw confirmed.error
      await recordEvent(admin,event,'freelance_income_confirmed','Entrada registrada no Caixa Freela',pending.data.description,{movement_id:movement.data.id,amount:pending.data.amount})
      event.entity_type='freelance_cash_movements';event.entity_id=movement.data.id
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
    event.entity_type='expenses';event.entity_id=expense.data.id
    return `Registrado ✓\n${pending.data.description} — ${brl(Number(pending.data.amount))}.`
  }
  if(command.intent==='LIST_MINE'){
    // "Quais minhas tarefas amanhã?" já chega com due_date resolvido pelo parser — sem isso, a consulta
    // sempre respondia com o dia de hoje mesmo quando a pergunta era sobre outra data.
    const queryDay=command.due_date||today(),isToday=queryDay===today()
    const {start,end}=dayWindow(queryDay)
    const [taskModel,events,promises]=await Promise.all([
      getMemberTaskReadModel(admin,org,event.team_member_id,queryDay),
      admin.from('operational_events').select('event_type,metadata').eq('organization_id',org).eq('team_member_id',event.team_member_id).gte('occurred_at',start).lte('occurred_at',end),
      admin.from('collection_payment_promises').select('id').eq('organization_id',org).eq('team_member_id',event.team_member_id).eq('status','pending').gte('follow_up_at',start).lte('follow_up_at',end),
    ])
    if(events.error||promises.error)throw events.error||promises.error
    const rows=events.data||[],started=rows.filter((row:any)=>row.event_type==='activity_started').length,completed=rows.filter((row:any)=>row.event_type==='activity_completed').length,hours=rows.filter((row:any)=>row.event_type==='time_recorded').reduce((sum:number,row:any)=>sum+Number(row.metadata?.hours||0),0),ongoing=Math.max(started-completed,0),followUps=promises.data?.length||0
    await saveAssistantSession(admin,event,{state:'awaiting_selection',active_intent:'TASK_BROWSE',context:{candidate_items:taskModel.candidateItems},pending_action:'select_task',pending_entity_type:'crm_tasks',pending_entity_id:null})
    const taskList=taskModel.candidateItems.length?`\n\n${taskModel.candidateItems.map((item:any)=>`${item.index}. ${item.label}${item.due_date<queryDay?' — atrasada':''}`).join('\n')}`:`\n\nVocê não tem tarefas para ${isToday?'hoje':'essa data'} nem atrasadas.`
    // Atividades/horas/cobranças são leitura do que já aconteceu — só fazem sentido para o dia de hoje.
    const activitySuffix=isToday?`\n\n${ongoing} atividade${ongoing===1?'':'s'} em andamento · ${completed} concluída${completed===1?'':'s'} · ${hours}h registradas · ${followUps} cobrança${followUps===1?'':'s'} para acompanhar.`:''
    const heading=isToday?'Hoje você tem:':`Em ${queryDay} você tem:`
    return `${heading}\n\n${taskModel.today.length} tarefa${taskModel.today.length===1?'':'s'} e ${taskModel.overdue.length} atrasada${taskModel.overdue.length===1?'':'s'}.${taskList}${activitySuffix}`
  }
  if(command.intent==='PLAN_MY_DAY'){
    const queryDay=command.due_date||today()
    const model=await getMemberTaskReadModel(admin,org,event.team_member_id,queryDay)
    const rank:any={critical:0,high:1,medium:2,low:3}
    const ordered=[...model.tasks].sort((left:any,right:any)=>{
      const overdueDifference=Number(right.due_date<queryDay)-Number(left.due_date<queryDay)
      if(overdueDifference)return overdueDifference
      const priorityDifference=(rank[left.priority]??2)-(rank[right.priority]??2)
      if(priorityDifference)return priorityDifference
      return String(left.due_time||'99:99').localeCompare(String(right.due_time||'99:99'))
    })
    await saveAssistantSession(admin,event,{state:'awaiting_selection',active_intent:'TASK_BROWSE',context:{candidate_items:model.candidateItems},pending_action:'select_task',pending_entity_type:'crm_tasks',pending_entity_id:null})
    if(!ordered.length)return 'Seu dia está livre de tarefas marcadas e atrasadas.'
    const rows=ordered.slice(0,12).map((item:any,index:number)=>{
      const timing=item.due_date<queryDay?'atrasada':item.due_time?String(item.due_time).slice(0,5):null
      const client=item.clients?.trade_name||item.clients?.company_name
      return {priority:item.due_date<queryDay||['critical','high'].includes(item.priority),line:`${index+1}. ${item.title}${client?` — ${client}`:''}${timing?` — ${timing}`:''}`}
    })
    const priorityRows=rows.filter((item:any)=>item.priority),laterRows=rows.filter((item:any)=>!item.priority),sections=[]
    if(priorityRows.length)sections.push(`Prioridade:\n${priorityRows.map((item:any)=>item.line).join('\n')}`)
    if(laterRows.length)sections.push(`${priorityRows.length?'Depois':'Pendências'}:\n${laterRows.map((item:any)=>item.line).join('\n')}`)
    return `Seu dia está assim:\n\n${sections.join('\n\n')}\n\nVocê tem ${model.overdue.length} item${model.overdue.length===1?'':'s'} atrasado${model.overdue.length===1?'':'s'}.`
  }
  if (['LIST_TODAY','LIST_OVERDUE'].includes(command.intent)) {
    let query = admin.from('crm_tasks').select('id,title,status,priority,due_date,planned_hours').eq('organization_id', org).not('status', 'in', '(completed,cancelled)').order('due_date')
    if (command.intent === 'LIST_TODAY') query = query.eq('due_date', today())
    if (command.intent === 'LIST_OVERDUE') query = query.lt('due_date', today())
    const result = await query
    if (result.error) throw result.error
    return `${command.intent === 'LIST_OVERDUE' ? 'Tarefas atrasadas' : 'Hoje na Mugô'} — ${today()}\n\n${taskLines(result.data || [])}`
  }
  if (command.intent === 'DAY_SUMMARY') {
    const { start, end } = dayWindow()
    const [events, tasks] = await Promise.all([
      admin.from('operational_events').select('event_type,metadata').eq('organization_id', org).eq('team_member_id', event.team_member_id).gte('occurred_at', start).lte('occurred_at', end),
      admin.from('crm_tasks').select('id').eq('organization_id', org).eq('assigned_to', event.team_member_id).eq('status', 'completed').gte('completed_at', start).lte('completed_at', end),
    ])
    if (events.error) throw events.error
    if (tasks.error) throw tasks.error
    const rows = events.data || []
    const count = (type: string) => rows.filter((row: any) => row.event_type === type).length
    const hours = rows.filter((row: any) => row.event_type === 'time_recorded').reduce((sum: number, row: any) => sum + Number(row.metadata?.hours || 0), 0)
    const started = count('activity_started'), completed = count('activity_completed'), decisions = count('client_decision'), observations = count('observation_added'), tasksCompleted = tasks.data?.length || 0
    if (!rows.length && !tasksCompleted) return 'Você ainda não registrou nada hoje.'
    const lines: string[] = []
    if (started) lines.push(`${started} atividade${started === 1 ? '' : 's'} iniciada${started === 1 ? '' : 's'}`)
    if (completed) lines.push(`${completed} atividade${completed === 1 ? '' : 's'} concluída${completed === 1 ? '' : 's'}`)
    if (tasksCompleted) lines.push(`${tasksCompleted} tarefa${tasksCompleted === 1 ? '' : 's'} concluída${tasksCompleted === 1 ? '' : 's'}`)
    if (hours) lines.push(`${hours}h registradas`)
    if (decisions) lines.push(`${decisions} decisão${decisions === 1 ? '' : 'ões'} registrada${decisions === 1 ? '' : 's'}`)
    if (observations) lines.push(`${observations} observação${observations === 1 ? '' : 'ões'} registrada${observations === 1 ? '' : 's'}`)
    return `O que você fez hoje (${today()}):\n${lines.map((line) => `• ${line}`).join('\n')}`
  }
  if(command.intent==='WEEK_SUMMARY'){
    const anchor=command.due_date||today(),date=new Date(`${anchor}T12:00:00Z`),weekday=date.getUTCDay()||7
    date.setUTCDate(date.getUTCDate()-weekday+1)
    const startDay=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);const endDay=date.toISOString().slice(0,10)
    const [tasks,events]=await Promise.all([
      admin.from('crm_tasks').select('id,status,due_date').eq('organization_id',org).eq('assigned_to',event.team_member_id).gte('due_date',startDay).lte('due_date',endDay),
      admin.from('operational_events').select('event_type,metadata').eq('organization_id',org).eq('team_member_id',event.team_member_id).gte('occurred_at',`${startDay}T00:00:00-03:00`).lte('occurred_at',`${endDay}T23:59:59.999-03:00`),
    ])
    if(tasks.error||events.error)throw tasks.error||events.error
    const taskRows=tasks.data||[],eventRows=events.data||[],completed=eventRows.filter((item:any)=>item.event_type==='activity_completed').length
    const hours=eventRows.filter((item:any)=>item.event_type==='time_recorded').reduce((sum:number,item:any)=>sum+Number(item.metadata?.hours||0),0)
    return `Sua semana (${startDay} a ${endDay}):\n• ${taskRows.filter((item:any)=>item.status==='completed').length} tarefas concluídas\n• ${taskRows.filter((item:any)=>!['completed','cancelled'].includes(item.status)).length} tarefas em aberto\n• ${completed} atividades concluídas\n• ${hours}h registradas`
  }
  if (command.intent === 'QUERY_OVERDUE_RECEIVABLES') {
    const rows = await admin.from('invoice_installments').select('id,due_date,amount,received_amount,clients(company_name)').eq('organization_id', org).in('status', ['pending', 'partial', 'overdue']).lt('due_date', today()).order('due_date').limit(30)
    if (rows.error) throw rows.error
    if (!rows.data?.length) return 'Ninguém está devendo no momento.'
    return `Hoje temos ${rows.data.length} cliente${rows.data.length===1?'':'s'} com valores em aberto.\n\n${rows.data.map((item: any) => `${item.clients?.company_name || 'Cliente'} — ${brl(Number(item.amount) - Number(item.received_amount || 0))} vencido`).join('\n')}\n\nQuer que eu abra as vencidas primeiro?`
  }
  if (command.intent === 'QUERY_RECEIVED_TOTAL') {
    const from = command.period === 'today' ? today() : `${today().slice(0, 7)}-01`
    const rows = await admin.from('invoice_installments').select('received_amount').eq('organization_id', org).eq('status', 'paid').gte('paid_at', `${from}T00:00:00-03:00`)
    if (rows.error) throw rows.error
    const total = (rows.data || []).reduce((sum: number, row: any) => sum + Number(row.received_amount || 0), 0)
    return `${command.period === 'today' ? 'Recebido hoje' : 'Recebido este mês'}: ${brl(total)}`
  }
  if (command.intent === 'QUERY_EXPENSES') {
    const monthIndex: any = { janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5, julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 }
    const now = new Date()
    const month = command.month_name && command.month_name in monthIndex ? monthIndex[command.month_name] : now.getUTCMonth()
    const reference = `${now.getUTCFullYear()}-${String(month + 1).padStart(2, '0')}-01`
    const rows = await admin.from('expense_installments').select('amount,expenses(name,source)').eq('organization_id', org).eq('reference_month', reference).limit(50)
    if (rows.error) throw rows.error
    if (!rows.data?.length) return `Nenhuma despesa registrada em ${reference.slice(0, 7)}.`
    const total = rows.data.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
    return `Despesas em ${reference.slice(0, 7)} (${rows.data.length}) — total ${brl(total)}:\n\n${rows.data.slice(0, 15).map((row: any) => `• ${row.expenses?.name || 'Despesa'} — ${brl(Number(row.amount))}`).join('\n')}`
  }
  if (command.intent === 'QUERY_PENDING_CONFIRMATIONS') {
    const [financial, commercial] = await Promise.all([
      admin.from('financial_command_confirmations').select('id,amount,description').eq('organization_id', org).eq('team_member_id', event.team_member_id).eq('status', 'pending').gt('expires_at', new Date().toISOString()),
      admin.from('commercial_command_confirmations').select('id').eq('organization_id', org).eq('team_member_id', event.team_member_id).in('status', ['pending', 'awaiting_context']).gt('expires_at', new Date().toISOString()),
    ])
    if (financial.error) throw financial.error
    if (commercial.error) throw commercial.error
    const total = (financial.data?.length || 0) + (commercial.data?.length || 0)
    if (!total) return 'Nenhuma confirmação pendente.'
    return `Você tem ${total} confirmação${total === 1 ? '' : 'ões'} pendente${total === 1 ? '' : 's'}:\n${(financial.data || []).map((item: any) => `• ${item.description} — ${brl(Number(item.amount))}`).join('\n')}`
  }
  if (command.intent === 'QUERY_WEEKLY_HOURS') {
    const now = new Date(); const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(now)
    const offset = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(weekday)
    const monday = new Date(`${today()}T12:00:00Z`); monday.setUTCDate(monday.getUTCDate() - (offset < 0 ? 0 : offset))
    const start = `${monday.toISOString().slice(0, 10)}T00:00:00-03:00`, end = `${today()}T23:59:59.999-03:00`
    const rows = await admin.from('operational_events').select('metadata').eq('organization_id', org).eq('team_member_id', event.team_member_id).eq('event_type', 'time_recorded').gte('created_at', start).lte('created_at', end)
    if (rows.error) throw rows.error
    const total = (rows.data || []).reduce((sum: number, row: any) => sum + Number(row.metadata?.hours || 0), 0)
    return `Você trabalhou ${total}h essa semana.`
  }
  if (command.intent === 'LIST_TEAM') {
    const queryDay=command.due_date||today()
    const [members, tasks] = await Promise.all([admin.from('team_members').select('id,name').eq('organization_id', org).eq('active', true), admin.from('crm_tasks').select('assigned_to,status,due_date').eq('organization_id', org).eq('due_date', queryDay)])
    if (members.error || tasks.error) throw members.error || tasks.error
    const needle=foldText(command.assignee_name);const selected=(members.data||[]).filter((member:any)=>!needle||foldText(member.name).includes(needle))
    if(command.assignee_name&&selected.length!==1)return `Não encontrei um único membro ativo chamado “${clean(command.assignee_name)}”.`
    return `Equipe em ${queryDay}\n\n${selected.map((member: any) => { const mine = (tasks.data || []).filter((task: any) => task.assigned_to === member.id); return `${member.name}: ${mine.filter((task: any) => !['completed','cancelled'].includes(task.status)).length} pendentes · ${mine.filter((task: any) => task.status === 'completed').length} concluídas` }).join('\n')}`
  }
  if(command.intent==='CREATE_TASK_DATE_UNRESOLVED'){
    // Resposta durante resolve_task_date sem data reconhecível: preserva a sessão (nada é limpo, nada é
    // criado, nenhuma decisão/observação é gravada) e pergunta de novo — nunca passa pelo fallback de IA.
    const pendingItems=Array.isArray(event.session?.context?.pending_items)?event.session.context.pending_items:[]
    return pendingItems.length>1?'Qual dia? Pode responder hoje, amanhã, sexta ou dia 5 de outubro.':`Qual dia fica "${clean(pendingItems[0]?.title)}"? Pode responder hoje, amanhã, sexta ou dia 5 de outubro.`
  }
  if (command.intent === 'CREATE_TASK') {
    // Fluxo obrigatório: intenção → título → data → confirmação explícita → persistência. Sem título,
    // a resposta natural pede a lista (aceita várias por linha); título e data nunca viram crm_task
    // sem uma confirmação explícita do usuário (ver checagens de due_date/date_confirmed abaixo).
    if (!clean(command.title) && !(Array.isArray(command.items) && command.items.length)) {
      await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'CREATE_TASK',context:{},pending_action:'describe_tasks',pending_entity_type:null,pending_entity_id:null})
      return 'Claro. Qual é a tarefa?'
    }
    if (command.schedule_ambiguous) {
      await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'CREATE_TASK',context:{pending_task_title:command.title,pending_task_type:command.task_type||'meeting',participant_name:command.participant_name||null},pending_action:'resolve_task_schedule',pending_entity_type:null,pending_entity_id:null})
      return `Qual dia e horário devo colocar para “${clean(command.title)}”?`
    }
    const assignee = await findMember(admin, event, command.assignee_name)
    if (command.assignee_name && !assignee) return `Não encontrei um único membro ativo chamado “${clean(command.assignee_name)}”. Confira o nome e tente novamente.`
    const items = Array.isArray(command.items) && command.items.length ? command.items : [{ title: command.title, due_date: command.due_date, due_time: command.due_time, task_type: command.task_type, participant_name: command.participant_name }]
    if (items.some((item:any)=>!clean(item.title)||isTaskCreationCommandOnly(item.title))) {
      await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'CREATE_TASK',context:{},pending_action:'describe_tasks',pending_entity_type:null,pending_entity_id:null})
      return 'Claro. Qual é a tarefa?'
    }
    // Regra obrigatória: nenhuma crm_task criada pelo assistente pode ficar sem due_date. Sem data,
    // pergunta antes de qualquer outra coisa; com data (mesmo vinda da mesma mensagem), sempre confirma
    // explicitamente antes de gravar — nenhum fallback (nem IA) pode pular esta checagem.
    if (items.some((item:any)=>!item.due_date)) {
      await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'CREATE_TASK',context:{pending_items:items,assignee_name:command.assignee_name||null,task_type:command.task_type||null,priority:command.priority||null},pending_action:'resolve_task_date',pending_entity_type:null,pending_entity_id:null})
      return items.length>1?'Para quando ficam essas tarefas?':`Para quando fica "${clean(items[0].title)}"?`
    }
    if (!command.date_confirmed) {
      await saveAssistantSession(admin,event,{state:'awaiting_confirmation',active_intent:'CREATE_TASK',context:{pending_items:items,assignee_name:command.assignee_name||null,task_type:command.task_type||null,priority:command.priority||null},pending_action:'confirm_task_date',pending_entity_type:null,pending_entity_id:null})
      return items.length>1
        ? `Confirmo estas tarefas?\n${items.map((item:any)=>`"${clean(item.title)}" — ${describeDatePt(item.due_date)}`).join('\n')}`
        : `Confirmo "${clean(items[0].title)}" para ${describeDatePt(items[0].due_date)}?`
    }
    const created: any[] = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const actionPart=Number.isInteger(event.action_index)?`:action:${event.action_index}`:''
      const sourceRef = items.length > 1 ? `${event.id}${actionPart}:${index}` : `${event.id}${actionPart}`
      const existing = await admin.from('crm_tasks').select('id,title,due_date,due_time,created_at').eq('organization_id', org).eq('source_ref', sourceRef).maybeSingle()
      if (existing.error) throw existing.error
      const client = existing.data ? null : await resolveClientMentionedIn(admin, org, item.title)
      const inserted = existing.data ? { data: existing.data, error: null } : await admin.from('crm_tasks').insert({ organization_id: org, title: clean(item.title, 240), category: 'Trabalho', client_id: client?.id || null, assigned_to: assignee?.id || event.team_member_id, due_date: item.due_date || null, due_time: item.due_time || null, task_type: item.task_type || command.task_type || 'general', priority: command.priority || 'medium', source: 'whatsapp', source_ref: sourceRef, metadata: { origin: 'whatsapp', command_event_id: event.id, ...(item.participant_name ? { participant_name: item.participant_name } : {}) } }).select('id,title,due_date,due_time,created_at').single()
      if (inserted.error) throw inserted.error
      created.push({ ...inserted.data, client })
    }
    await clearAssistantSession(admin, event)
    event.entity_type='crm_tasks';event.entity_id=created[0].id
    if (created.length > 1) {
      return `Prontinho. Criei ${created.length} tarefas ✓\n\n${created.map((t: any, i: number) => `${i + 1}. ${taskShortId(t.id)} ${t.title}${t.due_date ? ` — ${ddmmyyyy(t.due_date)}` : ''}`).join('\n')}\n\nRegistradas: ${formatRegisteredAt(created[0].created_at)}`
    }
    const task = created[0]
    return `Tarefa criada ✓\n${taskShortId(task.id)} ${task.title}${task.client ? ` — ${task.client.trade_name||task.client.company_name}` : ''}${task.due_date ? `\nPrazo: ${ddmmyyyy(task.due_date)}${task.due_time ? ` às ${String(task.due_time).slice(0,5)}` : ''}` : ''}\nRegistrada: ${formatRegisteredAt(task.created_at)}`
  }
  if (['COMPLETE_TASK','START_TASK','CANCEL_TASK','UPDATE_TASK_STATUS','MOVE_TASK','SET_PRIORITY','ASSIGN_TASK'].includes(command.intent)) {
    const found = await findTask(admin, event, command)
    if (found.kind === 'ambiguous') {
      const candidateItems = found.items.slice(0, 8).map((item: any, index: number) => ({ index: index + 1, type: 'task', task_id: item.id, label: item.title }))
      await saveAssistantSession(admin, event, { state: 'awaiting_selection', active_intent: 'TASK_SELECTION', context: { candidate_items: candidateItems, pending_task_intent: command.intent, pending_task_fields: { due_date: command.due_date, priority: command.priority, assignee_name: command.assignee_name, task_status: command.task_status } }, pending_action: 'select_task', pending_entity_type: 'crm_tasks', pending_entity_id: null })
      return `Encontrei mais de uma:\n\n${candidateItems.map((c: any) => `${c.index}. ${c.label}`).join('\n')}\n\nQual delas?`
    }
    if (found.kind !== 'one') return 'Não encontrei essa tarefa. Pode me dizer o nome como está no CRM, ou usar o código curto se tiver (ex.: #A1B2C3).'
    const outcome = await applyTaskAction(admin, event, found.item, command.intent, { due_date: command.due_date, priority: command.priority, assignee_name: command.assignee_name, task_status: command.task_status })
    await saveAssistantSession(admin,event,{state:'idle',active_intent:'TASK_BROWSE',context:{candidate_items:[{index:1,type:'task',task_id:found.item.id,label:found.item.title}],selected_task:{index:1,type:'task',task_id:found.item.id,label:found.item.title}},pending_action:null,pending_entity_type:'crm_tasks',pending_entity_id:found.item.id})
    return outcome.reply
  }
  if (command.intent === 'LIST_WAITING_ATTENDANCE') {
    if(command.subject_query){const result=await admin.from('whatsapp_conversations').select('assigned_team_member_id,whatsapp_contacts!inner(display_name,profile_name)').eq('organization_id',org).neq('status','closed').limit(200);if(result.error)throw result.error;const needle=foldText(command.subject_query),matches=(result.data||[]).filter((item:any)=>foldText(item.whatsapp_contacts?.display_name||item.whatsapp_contacts?.profile_name).includes(needle));if(matches.length!==1)return 'Não encontrei uma única conversa com esse nome.';if(!matches[0].assigned_team_member_id)return `${clean(command.subject_query)} ainda não tem responsável.`;const owner=await admin.from('team_members').select('name').eq('id',matches[0].assigned_team_member_id).eq('organization_id',org).maybeSingle();if(owner.error)throw owner.error;return owner.data?.name?`${clean(command.subject_query)} está com ${owner.data.name}.`:`${clean(command.subject_query)} ainda não tem responsável.`}
    const result = await admin.from('whatsapp_conversations').select('id,wa_id,handoff_reason,whatsapp_contacts(display_name,profile_name)').eq('organization_id', org).eq('status', 'pending').eq('automation_paused', true)
    if (result.error) throw result.error
    const lines = (result.data || []).map((item: any) => `• ${item.whatsapp_contacts?.display_name || item.whatsapp_contacts?.profile_name || `final ${item.wa_id.slice(-4)}`}`)
    return lines.length ? `Aguardando atendimento: ${lines.length}\n\n${lines.join('\n')}` : 'Ninguém está aguardando atendimento humano.'
  }
  if (command.intent === 'LIST_PENDING_CHARGES') {
    // Mesmo critério de elegibilidade do COLLECTION_SEND (nada quitado, nada sem data) — a lista só
    // mostra parcelas que realmente podem ser cobradas, e a sessão guarda os itens para seleção
    // posterior por número ("1"), ordinal ("primeiro") ou nome do cliente ("roove").
    const result = await admin.from('invoice_installments').select('id,client_id,due_date,amount,clients(company_name,trade_name)').eq('organization_id', org).in('status', ['pending','overdue']).eq('received_amount', 0).is('paid_at', null).order('due_date').limit(20)
    if (result.error) throw result.error
    if (!result.data?.length) return 'Não há cobranças pendentes no CRM.'
    const candidateItems = result.data.map((item: any, index: number) => ({ index: index + 1, type: 'collection', client_id: item.client_id, installment_id: item.id, label: item.clients?.trade_name || item.clients?.company_name || 'Cliente' }))
    await saveAssistantSession(admin, event, { state: 'awaiting_selection', active_intent: 'COLLECTION_SEND', context: { installment_ids: result.data.map((item: any) => item.id), candidate_items: candidateItems }, pending_action: 'select_collection_installment', pending_entity_type: 'invoice_installments', pending_entity_id: null })
    return `Cobranças pendentes: ${result.data.length}\n\n${result.data.map((item: any, index: number) => `${index + 1}. ${candidateItems[index].label} — ${brl(Number(item.amount))} — vencimento ${item.due_date}`).join('\n')}\n\nQuer que eu envie a cobrança de algum deles?`
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
    let secretaryPlan:any=null,secretaryCommands:any[]=[],processingPath='deterministic_gate'
    let command: any = ['document','image'].includes(event.message_type)&&event.media?.id
      ? {intent:'ATTACH_PROPOSAL_FILE',confidence:1}
      : parseInternalCommand(event.raw_text)
    event.session=await getAssistantSession(admin,event)
    // Carregado cedo para (a) responder GREETING pelo nome e (b) enriquecer o fallback de IA — nunca
    // presume auth_profile_id, só usa id/name daqui em diante.
    const member = await admin.from('team_members').select('id,name,auth_profile_id').eq('id', event.team_member_id).eq('organization_id', event.organization_id).eq('active', true).single()
    if (member.error) throw Object.assign(new Error('Membro interno não está mais ativo.'), { code: 'TEAM_MEMBER_INACTIVE' })
    event.team_member = member.data
    const cleanedRaw=clean(event.raw_text),foldedRaw=foldText(cleanedRaw)
    const candidateItems:any[]=Array.isArray(event.session?.context?.candidate_items)?event.session.context.candidate_items:[]
    const selectableItems=candidateItems.length?candidateItems:(Array.isArray(event.session?.context?.installment_ids)?event.session.context.installment_ids.map((id:any,index:number)=>({index:index+1,id})):[])
    const sessionDate=resolveRelativeDate(cleanedRaw)
    if(event.session?.active_intent==='ACTIVITY_DATE_CONFIRMATION'&&sessionDate){
      command={intent:'ACTIVITY_DATE_RESOLUTION',due_date:sessionDate,confidence:1}
    }else if(command.intent==='UNKNOWN'&&event.session?.active_intent==='ACTIVITY_DATE_CONFIRMATION'){
      // Resposta sem uma data reconhecível (ex.: "to finalizando agora") NUNCA pode cair no fallback de
      // IA aqui — isso já causou duplicidade real: a IA reclassificava como uma atividade nova, abria
      // outra sessão de confirmação e órfanizava o evento original (effective_date_pending preso em
      // true para sempre). ACTIVITY_DATE_RESOLUTION com due_date nulo já tem handler seguro (só
      // re-pergunta, nenhuma escrita) — reaproveita em vez de deixar a IA inventar um evento novo.
      command={intent:'ACTIVITY_DATE_RESOLUTION',due_date:null,confidence:1}
    }else if(command.intent==='CONFIRM_FINANCIAL'&&event.session?.active_intent==='PLAN_MY_DAY'&&event.session?.pending_action==='offer_plan_day'){
      command={intent:'PLAN_MY_DAY',due_date:today(),confidence:1}
    }else if(event.session?.active_intent==='MAIN_MENU'&&/^\d+$/.test(cleanedRaw)){
      const menu=(event.session.context?.menu_items||[]).find((item:any)=>item.index===Number(cleanedRaw))
      if(menu?.intent==='LIST_MINE')command={intent:'LIST_MINE',confidence:1}
      else if(menu?.intent==='ACTIVITY_CAPTURE')command={intent:'ACTIVITY_CAPTURE',confidence:1}
      else if(menu?.intent==='CREATE_TASK')command={intent:'CREATE_TASK',title:null,confidence:1}
      else if(menu?.intent==='RECORD_TIME')command={intent:'HELP',confidence:1}
      else if(menu?.intent==='LIST_PENDING_CHARGES')command={intent:'LIST_PENDING_CHARGES',confidence:1}
      else if(menu?.intent==='LIST_WAITING_ATTENDANCE')command={intent:'LIST_WAITING_ATTENDANCE',confidence:1}
      else if(menu?.intent==='FINANCIAL_MENU')command={intent:'HELP',confidence:1}
    }
    const selectedTask=event.session?.context?.selected_task
    if(selectedTask&&['ACTIVITY_START','ACTIVITY_COMPLETE'].includes(command.intent)&&(!clean(command.summary)||['ela','ele','isso','essa','esse'].includes(foldText(command.summary)))){
      command={intent:command.intent==='ACTIVITY_START'?'START_TASK':'COMPLETE_TASK',task_query:selectedTask.label,confidence:1}
    }
    if(selectedTask&&['CANCEL_TASK','UPDATE_TASK_STATUS','MOVE_TASK','SET_PRIORITY','ASSIGN_TASK'].includes(command.intent)&&!clean(command.task_query)){
      command={...command,task_query:selectedTask.label,confidence:1}
    }
    // PIPELINE (ordem importa): 1) referência a itens já apresentados ("os dois"...) tem prioridade
    // sobre o parser isolado — nunca deixa a expressão literal virar descrição de um evento.
    const activityCandidates=candidateItems.filter((item:any)=>item.type==='activity')
    if(activityCandidates.length&&event.session?.active_intent==='ACTIVITY_START'){
      const referentialFromRaw=foldReferential(cleanedRaw)
      const referentialFromSummary=command.intent==='ACTIVITY_COMPLETE'?foldReferential(clean(command.summary||'')):null
      const target=REFERENTIAL_ALL_WORDS.has(referentialFromRaw)||REFERENTIAL_ALL_WORDS.has(referentialFromSummary||'')
        ? 'all'
        : (referentialFromRaw in REFERENTIAL_ORDINAL_MAP ? (REFERENTIAL_ORDINAL_MAP as any)[referentialFromRaw] : (referentialFromSummary&&referentialFromSummary in REFERENTIAL_ORDINAL_MAP ? (REFERENTIAL_ORDINAL_MAP as any)[referentialFromSummary] : null))
      if(target==='all')command={intent:'ACTIVITY_COMPLETE',items:activityCandidates.map((item:any)=>({summary:item.summary})),summary:activityCandidates[0].summary,contextual:true,confidence:1}
      else if(typeof target==='number'&&activityCandidates[target])command={intent:'ACTIVITY_COMPLETE',items:[{summary:activityCandidates[target].summary}],summary:activityCandidates[target].summary,contextual:true,confidence:1}
    }
    // A notificação de handoff oferece duas ações fixas sobre a conversa já persistida.
    if(event.session?.active_intent==='CONVERSATION_BROWSE'&&candidateItems[0]?.conversation_id){
      if(/^(1|assumir|assumo)[.!]?$/i.test(foldedRaw))command={intent:'TAKE_CONVERSATION_BY_ID',conversation_id:candidateItems[0].conversation_id,confidence:1}
      else if(/^(2|ver contexto|contexto)[.!]?$/i.test(foldedRaw))command={intent:'CONVERSATION_CONTEXT',conversation_id:candidateItems[0].conversation_id,confidence:1}
    }
    // 2) seleção numérica ("1"), ordinal ("primeiro") ou por nome/título ("roove", "home da roove")
    // sobre uma lista numerada apresentada antes (cobranças, tarefas ambíguas) — só quando o parser
    // isolado não achou nenhuma intenção própria mais forte na mensagem atual.
    if(command.intent==='UNKNOWN'&&event.session?.active_intent==='TASK_BROWSE'&&/^(qual|quais|qual tarefa|me mostra|mostrar)[?!.]*$/i.test(foldedRaw)){
      command={intent:'TASK_CONTEXT_LIST',confidence:1}
    }else if(command.intent==='UNKNOWN'&&event.session?.state==='awaiting_selection'&&selectableItems.length){
      let matchIndex:number|null=null
      if(/^\d+$/.test(cleanedRaw))matchIndex=Number(cleanedRaw)
      else{
        const ordinalWords=['primeiro','segundo','terceiro','quarto','quinto']
        const ordinalIndex=ordinalWords.indexOf(foldedRaw.replace(/^(o|a)\s+/,''))
        if(ordinalIndex>=0)matchIndex=ordinalIndex+1
        else if(candidateItems.length){
          const byName=candidateItems.filter((item:any)=>item.label&&(foldText(item.label)===foldedRaw||foldText(item.label).includes(foldedRaw)||foldedRaw.includes(foldText(item.label))))
          if(byName.length===1)matchIndex=byName[0].index
        }
      }
      if(matchIndex&&selectableItems.some((item:any)=>item.index===matchIndex))command={intent:'SESSION_SELECTION',selection:matchIndex,confidence:1}
    }
    // 3) continuação de um pending específico — só quando a mensagem atual não tem intenção própria
    // (UNKNOWN). Uma intenção forte nova (ex.: "finalizei site da Mila" já virou ACTIVITY_COMPLETE no
    // parser) NUNCA passa por aqui, e por isso nunca é sequestrada pelo contexto antigo.
    else if(command.intent==='UNKNOWN'&&event.session?.active_intent==='FINANCIAL_EXPENSE_REQUEST'&&event.session.state==='awaiting_context'&&cleanedRaw){command={intent:'FINANCIAL_EXPENSE_REQUEST',amount:Number(event.session.context?.amount),category_name:cleanedRaw,description:cleanedRaw,confidence:1};await clearAssistantSession(admin,event)}
    else if(command.intent==='UNKNOWN'&&event.session?.active_intent==='CREATE_TASK'&&event.session?.pending_action==='resolve_task_schedule'&&cleanedRaw){
      const schedule=parseTaskSchedule(cleanedRaw)
      command={intent:'CREATE_TASK',title:clean(event.session.context?.pending_task_title,240),task_type:event.session.context?.pending_task_type||'meeting',participant_name:event.session.context?.participant_name||null,...schedule,schedule_ambiguous:!schedule.due_date||!schedule.due_time,priority:'medium',assignee_name:null,confidence:1}
    }
    // Data obrigatória: título(s) já definidos, só falta o dia — qualquer resposta que resolva para uma
    // data (relativa, dia/mês, dia da semana, "até o final do dia") completa os itens pendentes e segue
    // para a confirmação. Sem data reconhecível, a resposta NUNCA pode cair no fallback de IA (já
    // reclassificou isso como RECORD_DECISION em produção) — preserva a sessão e pede a data de novo,
    // sem gravar nada.
    else if(command.intent==='UNKNOWN'&&event.session?.active_intent==='CREATE_TASK'&&event.session?.pending_action==='resolve_task_date'&&cleanedRaw){
      if(sessionDate){
        const pendingItems=Array.isArray(event.session.context?.pending_items)?event.session.context.pending_items:[]
        const items=pendingItems.map((item:any)=>({...item,due_date:item.due_date||sessionDate}))
        command={intent:'CREATE_TASK',items,title:items[0]?.title||null,due_date:items[0]?.due_date||null,assignee_name:event.session.context?.assignee_name||null,task_type:event.session.context?.task_type||null,priority:event.session.context?.priority||null,confidence:1}
      }else{
        command={intent:'CREATE_TASK_DATE_UNRESOLVED',confidence:1}
      }
    }
    // Confirmação obrigatória antes de qualquer insert: "sim"/"confirmo" já é CONFIRM_FINANCIAL no
    // parser (não UNKNOWN) — reconstrói o CREATE_TASK com date_confirmed para liberar a gravação.
    // "não"/"cancela" (CANCEL_FINANCIAL) já limpa a sessão pelo bloco genérico de cancelamento.
    else if(command.intent==='CONFIRM_FINANCIAL'&&event.session?.active_intent==='CREATE_TASK'&&event.session?.pending_action==='confirm_task_date'){
      const items=Array.isArray(event.session.context?.pending_items)?event.session.context.pending_items:[]
      command={intent:'CREATE_TASK',items,title:items[0]?.title||null,due_date:items[0]?.due_date||null,assignee_name:event.session.context?.assignee_name||null,task_type:event.session.context?.task_type||null,priority:event.session.context?.priority||null,date_confirmed:true,confidence:1}
    }
    else if(command.intent==='UNKNOWN'&&event.session?.active_intent==='CREATE_TASK'&&event.session.state==='awaiting_context'&&event.session?.pending_action==='describe_tasks'&&cleanedRaw&&!isTaskCreationCommandOnly(cleanedRaw)){
      const lines=cleanedRaw.split(/\r?\n/).flatMap((line:string)=>line.split(/\s*[•;]\s*/)).map((line:string)=>clean(line.replace(/^[-*]\s+/,''))).filter(Boolean)
      const items=lines.map((line:string)=>({title:taskTitleFromText(clean(line,240)),...parseTaskSchedule(line)}))
      command={intent:'CREATE_TASK',items,title:items[0]?.title||null,due_date:items[0]?.due_date||null,priority:'medium',assignee_name:null,confidence:1}
    }
    else if(event.session?.active_intent==='ACTIVITY_CAPTURE'&&event.session.state==='awaiting_context'&&cleanedRaw){
      // "quero registrar atividade" é neutro; a resposta livre sem verbo próprio é tratada como
      // conclusão — é o padrão mais comum de "me conta o que você fez". Uma lista numerada inline
      // ("1. x 2. y 3. z") vira uma atividade POR item — nunca uma única descrição genérica com os
      // números dentro do texto.
      const inlineActivities=splitInlineNumberedList(cleanedRaw)
      if(inlineActivities)command={intent:'ACTIVITY_COMPLETE',items:inlineActivities.items.map((summary:string)=>({summary:clean(summary,240)})),summary:clean(inlineActivities.items[0],240),contextual:true,confidence:1}
      else if(command.intent==='UNKNOWN')command={intent:'ACTIVITY_COMPLETE',summary:clean(cleanedRaw,240),contextual:true,confidence:1}
    }
    else if(command.intent==='ACTIVITY_COMPLETE'&&!clean(command.summary)&&event.session?.active_intent==='ACTIVITY_START'&&clean(event.session.context?.activity_summary)){command={...command,summary:clean(event.session.context.activity_summary,240),contextual:true,confidence:1}}
    // 4) linguagem natural primeiro: a secretária planeja somente tools allowlisted. Ela recebe um
    // read model resumido e nunca toca o banco; execute() continua sendo a única camada de efeito.
    const protectedPendingActions=new Set(['confirm_task_date','resolve_task_date','resolve_task_schedule','confirm_activity_date','select_task','select_collection_installment','send_collection_template','offer_plan_day'])
    const deterministicShortcut=['document','image'].includes(event.message_type)
      || ['CONFIRM_FINANCIAL','CANCEL_FINANCIAL','GREETING','HELP','ACTIVITY_DATE_RESOLUTION','SESSION_SELECTION','TASK_CONTEXT_LIST','CREATE_TASK_DATE_UNRESOLVED','TAKE_CONVERSATION_BY_ID','CONVERSATION_CONTEXT'].includes(command.intent)
      || Boolean(command.task_short_id)
      || protectedPendingActions.has(event.session?.pending_action)
    const secretaryKey=Deno.env.get('OPENAI_API_KEY')||'',secretaryModel=Deno.env.get('TASK_COMMAND_MODEL')||Deno.env.get('OPENAI_MODEL')||''
    const savedSecretaryPlan=event.parsed_command?.orchestrator==='internal_secretary'?event.parsed_command:null
    if(savedSecretaryPlan?.plan?.reply_mode==='execute'&&Array.isArray(savedSecretaryPlan.commands)&&savedSecretaryPlan.commands.length&&!deterministicShortcut){
      secretaryPlan=savedSecretaryPlan.plan
      secretaryCommands=compactSecretaryCommands(savedSecretaryPlan.commands)
      command=secretaryCommands[0]
      processingPath='secretary_agent'
    }else if(secretaryKey&&secretaryModel&&!deterministicShortcut){
      const [memberModel,team]=await Promise.all([
        getMemberTaskReadModel(admin,event.organization_id,event.team_member_id,today()),
        admin.from('team_members').select('id,name').eq('organization_id',event.organization_id).eq('active',true),
      ])
      if(team.error)throw team.error
      secretaryPlan=await planInternalSecretaryMessage({
        apiKey:secretaryKey,model:secretaryModel,message:event.raw_text,
        member:event.team_member,now:{iso:new Date().toISOString(),local_date:today(),timezone:'America/Sao_Paulo'},
        session:event.session?{state:event.session.state,active_intent:event.session.active_intent,pending_action:event.session.pending_action,context:event.session.context}:null,
        operationalContext:{my_tasks:memberModel.candidateItems,team_members:(team.data||[]).map((item:any)=>({id:item.id,name:item.name}))},
      })
      if(secretaryPlan)processingPath='secretary_agent'
      if(secretaryPlan?.reply_mode==='execute'){
        secretaryCommands=compactSecretaryCommands(secretaryPlan.actions.map(secretaryActionToCommand).filter(Boolean))
        if(secretaryCommands.length)command=secretaryCommands[0]
        else secretaryPlan={reply_mode:'clarify',message:'Ainda não consigo executar essa ação. Pode me dizer o que você precisa de outro jeito?',actions:[]}
      }
    }
    // 5) parser/IA legado permanece apenas como fallback transitório quando a secretária não planejou.
    if(!secretaryPlan&&command.intent==='UNKNOWN'){
      const awaiting=await pendingCommercial(admin,event)
      if(awaiting?.action_type==='proposal_attachment'&&awaiting.status==='awaiting_context'){
        command={intent:'ATTACH_PROPOSAL_FILE',context_query:event.raw_text,confidence:1}
      }else{
        const aiContext={active_intent:event.session?.active_intent||null,state:event.session?.state||null,session_context:event.session?.context||null,candidate_items:candidateItems.length?candidateItems:null,team_member_name:event.team_member?.name||null}
        processingPath='legacy_fallback'
        command=await aiFallback(event.raw_text,aiContext)||command
      }
    }
    const contextualActivity=command.intent==='ACTIVITY_COMPLETE'&&['ACTIVITY_START','ACTIVITY_CAPTURE'].includes(event.session?.active_intent)&&command.contextual
    // Uma saudação solta ("oi") não deve derrubar um fluxo pendente (lista aguardando escolha, tarefa
    // aguardando título...) — só um novo comando de verdade cancela o contexto anterior.
    if(event.session&&!contextualActivity&& !['CONFIRM_FINANCIAL','CANCEL_FINANCIAL','UNKNOWN','SESSION_SELECTION','GREETING','TASK_CONTEXT_LIST','ACTIVITY_DATE_RESOLUTION','CREATE_TASK_DATE_UNRESOLVED'].includes(command.intent) && command.intent!==event.session.active_intent)await clearAssistantSession(admin,event)
    await recordEvent(admin,event,'whatsapp_command','Comando interno recebido','Comando processado via WhatsApp',{intent:command.intent,message_type:event.message_type,secretary:Boolean(secretaryPlan),action_count:secretaryCommands.length||null,processing_path:processingPath})
    let outcome:any
    if(secretaryPlan&&secretaryPlan.reply_mode!=='execute'){
      if(secretaryPlan.reply_mode==='clarify'){
        await saveAssistantSession(admin,event,{state:'awaiting_context',active_intent:'SECRETARY_CLARIFICATION',context:{request:cleanedRaw,previous_context:event.session?.context||null},pending_action:'secretary_clarification',pending_entity_type:null,pending_entity_id:null})
      }else if(event.session?.active_intent==='SECRETARY_CLARIFICATION'){
        await clearAssistantSession(admin,event)
      }
      outcome=secretaryPlan.message||CLARIFY_TEXT
    }else if(secretaryCommands.length){
      const planned=await admin.from('task_command_events').update({parsed_command:{orchestrator:'internal_secretary',plan:secretaryPlan,commands:secretaryCommands},result:{...(event.result||{}),processing_path:processingPath}}).eq('id',event.id)
      if(planned.error)throw planned.error
      outcome=await runSecretaryActions({
        messageKey:event.id,
        commands:secretaryCommands,
        completedToolCalls:event.result?.completed_tool_calls||[],
        toolCallResults:event.result?.tool_call_results||{},
        executeTool:async(toolCommand:any,{index}:any)=>{
          event.action_index=index
          const beforeSession=event.session
          const result:any=await execute(admin,event,toolCommand)
          const pending=Boolean(
            result?.status==='confirmation_required'
            || (event.session&&event.session!==beforeSession&&['awaiting_context','awaiting_selection','awaiting_confirmation'].includes(event.session.state))
          )
          return typeof result==='string'?{reply:result,pending,status:pending?'awaiting_context':undefined}:{...result,pending}
        },
        onProgress:async(progress:any)=>{
          const checkpoint=await admin.from('task_command_events').update({result:{...(event.result||{}),...progress,processing_path:processingPath}}).eq('id',event.id)
          if(checkpoint.error)throw checkpoint.error
          event.result={...(event.result||{}),...progress,processing_path:processingPath}
        },
      })
      delete event.action_index
    }else{
      outcome=command.intent === 'UNKNOWN' ? CLARIFY_TEXT : await execute(admin, event, command)
    }
    const reply=typeof outcome==='string'?outcome:outcome.reply
    const providerMessageId = await sendReply(admin, event, reply)
    await admin.from('task_command_events').update({ status: outcome?.status||'completed', parsed_command: secretaryPlan?{orchestrator:'internal_secretary',plan:secretaryPlan,commands:secretaryCommands}:command, entity_type: event.entity_type||null, entity_id: event.entity_id||null, result: { ...(event.result||{}),completed_tool_calls:outcome?.completed_tool_calls||event.result?.completed_tool_calls||[],pending_tool_calls:outcome?.pending_tool_calls||event.result?.pending_tool_calls||[],tool_call_results:outcome?.tool_call_results||event.result?.tool_call_results||{},processing_path:processingPath,reply,provider_message_id:providerMessageId }, processed_at: new Date().toISOString(), error_code: null, error_message: null }).eq('id', event.id)
    return true
  } catch (error: any) {
    const safeReply=friendlyFailure(error)
    if(safeReply){
      try{
        const providerMessageId=await sendReply(admin,event,safeReply)
        await admin.from('task_command_events').update({status:'completed',result:{reply:safeReply,provider_message_id:providerMessageId},processed_at:new Date().toISOString(),error_code:clean(error?.code||error?.name,100),error_message:null}).eq('id',event.id)
        return true
      }catch{/* O transporte principal também está indisponível; a fila segue para fallback. */}
    }
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
  const payload=await request.json().catch(()=>({}))
  let dueQuery=admin.from('task_command_events').select('*').in('status',['pending','failed']).lte('next_attempt_at',new Date().toISOString()).order('created_at').limit(payload?.event_id?1:20)
  if(payload?.event_id)dueQuery=dueQuery.eq('id',clean(payload.event_id,80))
  const due=await dueQuery
  if (due.error) return json({ ok: false, code: 'QUEUE_READ_FAILED' }, 500)
  let processed = 0
  for (const event of due.data || []) if (await processEvent(admin, event)) processed += 1
  return json({ ok: true, claimed: due.data?.length || 0, processed })
})
