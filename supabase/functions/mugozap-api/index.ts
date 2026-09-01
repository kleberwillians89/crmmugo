import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-workspace-id','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
const providerMessageFrom = (details: Record<string,unknown>) => {
  const candidate = (details?.provider_message ?? details?.message ?? details?.detail) as unknown
  const value = typeof candidate === 'string' ? candidate.trim() : ''
  return value ? value.slice(0, 500) : null
}
// Contrato de erro entregue ao frontend: nunca um "Internal Server Error" opaco.
// { code, message, provider_message, retryable, status, upstream_status, details, context }
const fail = (code: string, message: string, status = 400, upstreamStatus = 0, retryable = false, details: Record<string,unknown> = {}) => json({
  ok: false,
  code,
  message,
  provider_message: providerMessageFrom(details),
  retryable,
  status,
  upstream_status: upstreamStatus,
  details,
  context: { code, upstream_status: upstreamStatus },
}, status)
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)
const identifier = (value: unknown) => {
  const normalized = text(value, 40).replace(/\D/g, '')
  return /^\d{10,15}$/.test(normalized) ? normalized : ''
}
const brazilianPhone = (value: unknown) => {
  let normalized=text(value,40).replace(/\D/g,'')
  if(normalized.startsWith('00'))normalized=normalized.slice(2)
  if(!normalized.startsWith('55')&&(normalized.length===10||normalized.length===11))normalized=`55${normalized}`
  return /^55[1-9]{2}\d{8,9}$/.test(normalized)?normalized:''
}
const metaStatus = (value: unknown) => text(value, 30).toUpperCase()
const availableTemplate = (value: unknown) => metaStatus(value) === 'APPROVED'
const auditedOperations = new Set(['list_conversations','list_messages','list_templates','sync_templates','start_template_conversation','get_template_test_access','send_template_message','list_whatsapp_connections','get_whatsapp_connection','get_whatsapp_connection_health','validate_whatsapp_connection','resolve_whatsapp_connection_shadow'])
const publicOperation = (operation: string) => operation === 'list_messages' ? 'get_conversation_messages' : operation
let upstreamFailureCount=0
let upstreamCircuitOpenUntil=0
const maskAuditPhone = (value: unknown) => {
  const digits=String(value??'').replace(/\D/g,'')
  return digits.length>=4?`•••••••••${digits.slice(-4)}`:'[masked]'
}
const auditValue = (value: any, depth = 0): any => {
  if(depth>5)return '[depth-limited]'
  if(typeof value==='string')return value.slice(0,4000)
  if(Array.isArray(value))return value.slice(0,200).map(item=>auditValue(item,depth+1))
  if(!value||typeof value!=='object')return value
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[
    key,
    /authorization|token|jwt|secret|apikey|api_key|panel_key/i.test(key)
      ?'[redacted]'
      :/^(recipient|phone|phone_number|wa_id)$/i.test(key)
        ?maskAuditPhone(item)
        :auditValue(item,depth+1),
  ]))
}
const auditOperation = (stage: string, operation: string, detail: Record<string,unknown>) => {
  if(!auditedOperations.has(operation))return
  console.log(JSON.stringify(auditValue({event:'whatsapp_operation_trace',stage,operation:publicOperation(operation),internal_operation:operation,...detail})))
}
const templateVariables = (component: any) => {
  const content = text(component?.text, 8000)
  const positional = [...content.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1]))
  return positional.length ? Math.max(...positional) : 0
}
const nonEmptyTemplateParameter = (parameter: any) => {
  const parameterType=metaStatus(parameter?.type)
  if(parameterType==='TEXT')return Boolean(text(parameter?.text,2000))
  if(parameterType==='COUPON_CODE')return Boolean(text(parameter?.coupon_code,120))
  if(['IMAGE','VIDEO','DOCUMENT'].includes(parameterType))return /^https:\/\//.test(text(parameter?.[parameterType.toLowerCase()]?.link,2000))
  return false
}
const validateTemplateComponents = (components: any) => Array.isArray(components)&&components.length<=20&&components.every((component:any)=>{
  const componentType=metaStatus(component?.type),parameters=component?.parameters
  if(!['HEADER','BODY','BUTTON'].includes(componentType)||!Array.isArray(parameters)||!parameters.length||parameters.length>20)return false
  if(componentType==='BUTTON'&&(!/^\d{1,2}$/.test(text(component?.index,2))||!['URL','COPY_CODE'].includes(metaStatus(component?.sub_type))))return false
  return parameters.every(nonEmptyTemplateParameter)
})
const requiredTemplateInputs = (template: any) => {
  let body=0,headerText=0,headerMedia='',copyButtons:number[]=[],urlButtons:number[]=[]
  for(const component of Array.isArray(template?.components)?template.components:[]){
    const componentType=metaStatus(component?.type)
    if(componentType==='BODY')body=Math.max(body,templateVariables(component))
    if(componentType==='HEADER'){
      headerText=Math.max(headerText,templateVariables(component))
      const format=metaStatus(component?.format)
      if(['IMAGE','VIDEO','DOCUMENT'].includes(format))headerMedia=format
    }
    if(componentType==='BUTTONS'&&Array.isArray(component.buttons))component.buttons.forEach((button:any,index:number)=>{
      const buttonType=metaStatus(button?.type)
      if(buttonType==='COPY_CODE')copyButtons.push(index)
      if(buttonType==='URL'&&/\{\{[^{}]+\}\}/.test(text(button?.url,2000)))urlButtons.push(index)
    })
  }
  return{body,headerText,headerMedia,copyButtons,urlButtons}
}
const templateInputsComplete = (template:any,components:any[]) => {
  const required=requiredTemplateInputs(template)
  const body=components.find((item:any)=>metaStatus(item.type)==='BODY')?.parameters||[]
  const header=components.find((item:any)=>metaStatus(item.type)==='HEADER')?.parameters||[]
  if(body.length<required.body||header.filter((item:any)=>metaStatus(item.type)==='TEXT').length<required.headerText)return false
  if(required.headerMedia&&!header.some((item:any)=>metaStatus(item.type)===required.headerMedia))return false
  for(const index of required.copyButtons)if(!components.some((item:any)=>metaStatus(item.type)==='BUTTON'&&Number(item.index)===index&&metaStatus(item.sub_type)==='COPY_CODE'&&metaStatus(item.parameters?.[0]?.type)==='COUPON_CODE'))return false
  for(const index of required.urlButtons)if(!components.some((item:any)=>metaStatus(item.type)==='BUTTON'&&Number(item.index)===index&&metaStatus(item.sub_type)==='URL'&&metaStatus(item.parameters?.[0]?.type)==='TEXT'))return false
  return true
}
const maskPhone = (value: unknown) => {
  const phone=brazilianPhone(value)
  return phone.length>=8?`${phone.slice(0,4)}…${phone.slice(-4)}`:'***'
}
const componentSummary = (components: any) => Array.isArray(components)?components.map((component:any)=>({
  type:metaStatus(component?.type),
  sub_type:metaStatus(component?.sub_type)||null,
  index:text(component?.index,2)||null,
  parameter_count:Array.isArray(component?.parameters)?component.parameters.length:0,
  parameter_types:Array.isArray(component?.parameters)?component.parameters.map((parameter:any)=>metaStatus(parameter?.type)):[],
})):[]
const sanitizedMetaError = (body: any) => ({
  code: Number(body?.error?.code || 0),
  error_subcode: Number(body?.error?.error_subcode || 0),
  message: text(body?.error?.message, 500),
  details: text(body?.error?.error_data?.details, 500),
  fbtrace_id: text(body?.error?.fbtrace_id, 120),
})
const persistOutboundMessage = async ({
  supabaseUrl, serviceKey, organizationId, recipient, providerMessageId, idempotencyKey,
  messageType, textContent, templateName, templateLanguage, templateComponents, clientId, connectionId, sentAt, status = 'accepted',
}: any) => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY_MISSING')
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const phoneNumberId = text(Deno.env.get('PHONE_NUMBER_ID'), 80)
  let connectionQuery = admin.from('whatsapp_connections')
    .select('id,organization_id').eq('organization_id', organizationId).in('status', ['active','degraded'])
  if (connectionId) connectionQuery = connectionQuery.eq('id', connectionId)
  if (phoneNumberId) connectionQuery = connectionQuery.eq('phone_number_id', phoneNumberId)
  const connectionResult = await connectionQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (connectionResult.error || !connectionResult.data) throw connectionResult.error || new Error('WHATSAPP_CONNECTION_NOT_FOUND')
  const connection = connectionResult.data
  let displayName = ''
  if (clientId) {
    const client = await admin.from('clients').select('contact_name,trade_name,company_name').eq('id', clientId).eq('organization_id', organizationId).maybeSingle()
    displayName = text(client.data?.contact_name || client.data?.trade_name || client.data?.company_name, 240)
  }
  const contactResult = await admin.from('whatsapp_contacts').upsert({
    organization_id: organizationId, connection_id: connection.id, wa_id: recipient,
    ...(clientId ? { client_id: clientId } : {}), ...(displayName ? { display_name: displayName } : {}), last_seen_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,wa_id' }).select('id,client_id,display_name,profile_name').single()
  if (contactResult.error) throw contactResult.error
  const now = sentAt || new Date().toISOString()
  const conversationResult = await admin.from('whatsapp_conversations').upsert({
    organization_id: organizationId, connection_id: connection.id, contact_id: contactResult.data.id,
    wa_id: recipient, status: 'open', last_message_at: now, last_outbound_at: now,
  }, { onConflict: 'connection_id,wa_id' }).select('id,connection_id,contact_id,wa_id,status,attendance_mode,automation_paused,assigned_to,service_window_expires_at,last_message_at,last_outbound_at,unread_count,created_at,updated_at').single()
  if (conversationResult.error) throw conversationResult.error
  const messageResult = await admin.from('whatsapp_messages').upsert({
    organization_id: organizationId, connection_id: connection.id, conversation_id: conversationResult.data.id,
    provider_message_id: providerMessageId, idempotency_key: idempotencyKey || null,
    direction: 'out', message_type: messageType, status, text_content: textContent || null,
    template_name: templateName || null, template_language: templateLanguage || null,
    template_components: Array.isArray(templateComponents) ? templateComponents : [], sent_at: status === 'queued' ? null : now,
  }, { onConflict: idempotencyKey ? 'connection_id,idempotency_key' : 'connection_id,provider_message_id' }).select('id,provider_message_id,status,sent_at').single()
  if (messageResult.error) throw messageResult.error
  return {
    connection_id: connection.id,
    conversation_id: conversationResult.data.id,
    conversation: { ...conversationResult.data, whatsapp_contacts: contactResult.data },
    message: messageResult.data,
  }
}
const metaFailure = (status: number, body: any, requestId = '') => {
  const error = sanitizedMetaError(body)
  console.log(JSON.stringify({event:'meta_whatsapp_error',request_id:requestId,status,...error}))
  if (status === 401 || error.code === 190) return fail('META_TOKEN_EXPIRED', 'A credencial da Meta expirou. Solicite a renovação ao administrador.', 401, status, false, error)
  if (status === 403 || [10,200,299].includes(error.code)) return fail('META_PERMISSION_MISSING', 'A credencial da Meta não possui permissão para consultar o WhatsApp.', 403, status, false, error)
  if (status === 404 || error.code === 100) return fail('META_RESOURCE_INVALID', 'A conta ou o número do WhatsApp configurado não foi encontrado.', 404, status, false, error)
  return fail('META_API_ERROR', error.details || 'A Meta não conseguiu concluir a consulta.', status || 502, status, status >= 500, error)
}
const metaConfig = (requirePhoneNumber = false) => {
  const wabaId = text(Deno.env.get('WABA_ID'), 80)
  const phoneNumberId = text(Deno.env.get('PHONE_NUMBER_ID'), 80)
  const accessToken = Deno.env.get('META_ACCESS_TOKEN') || ''
  const version = text(Deno.env.get('GRAPH_API_VERSION'), 20)
  if (!wabaId) return { error: fail('WABA_ID_MISSING', 'O WABA ID não foi configurado no backend.', 503) }
  if (requirePhoneNumber && !phoneNumberId) return { error: fail('PHONE_NUMBER_ID_MISSING', 'O Phone Number ID não foi configurado no backend.', 503) }
  if (!accessToken) return { error: fail('META_ACCESS_TOKEN_MISSING', 'A credencial da Meta não foi configurada no backend.', 503) }
  if (!/^v\d+\.\d+$/.test(version)) return { error: fail('GRAPH_API_VERSION_INVALID', 'A versão da Graph API não foi configurada corretamente.', 503) }
  if (!/^\d+$/.test(wabaId)) return { error: fail('WABA_ID_INVALID', 'O WABA ID configurado é inválido.', 503) }
  if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) return { error: fail('PHONE_NUMBER_ID_INVALID', 'O Phone Number ID configurado é inválido.', 503) }
  return { wabaId, phoneNumberId, accessToken, version }
}
const fetchMeta = async (url: string, accessToken: string, diagnostic: any = null) => {
  if(diagnostic)console.log(JSON.stringify({
    event:'meta_sync_fetch_before',
    request_id:diagnostic.requestId,
    operation:'sync_templates',
    final_url:url,
    graph_api_version:diagnostic.version,
    waba_id_masked:diagnostic.wabaId.length>8?`${diagnostic.wabaId.slice(0,4)}…${diagnostic.wabaId.slice(-4)}`:'***',
    meta_access_token_length:accessToken.length,
    method:'GET',
    headers_without_authorization:{},
  }))
  try{
    const response = await fetch(url, {method:'GET',headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(8_000)})
    const responseText=await response.text()
    if(diagnostic)console.log(JSON.stringify({
      event:'meta_sync_fetch_after',
      request_id:diagnostic.requestId,
      operation:'sync_templates',
      status_http:response.status,
      response_text:responseText,
      response_headers:Object.fromEntries(response.headers.entries()),
    }))
    const body=JSON.parse(responseText)
    return {response,body,responseText}
  }catch(error){
    if(diagnostic)console.log(JSON.stringify({
      event:'meta_sync_fetch_error',
      request_id:diagnostic.requestId,
      operation:'sync_templates',
      error_name:text((error as any)?.name,200),
      error_message:text((error as any)?.message,2000),
      error_stack:String((error as any)?.stack||'').slice(0,8000),
      error_cause:auditValue((error as any)?.cause),
    }))
    throw error
  }
}

const sendMetaMessage = async (config: any, payload: unknown) => {
  const response = await fetch(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => ({}))
  return { response, body }
}
// Índice do botão "copiar código" (coupon) nos componentes oficiais do template.
const couponButtonIndex = (template: any) => {
  for (const component of Array.isArray(template?.components) ? template.components : []) {
    if (metaStatus(component?.type) !== 'BUTTONS' || !Array.isArray(component.buttons)) continue
    const found = component.buttons.findIndex((button: any) => ['COPY_CODE', 'COPY_CODE_BUTTON'].includes(metaStatus(button?.type)))
    if (found >= 0) return found
  }
  return 0
}
// Normaliza os componentes de template para o formato exato da Meta Cloud API
// (tudo lowercase). O frontend já monta assim (buildTemplateComponents); para a
// cobrança montamos a partir dos componentes oficiais do template. Puro/testável.
const metaTemplateComponents = (components: any) => (Array.isArray(components) ? components : []).map((component: any) => {
  const componentType = metaStatus(component?.type).toLowerCase()
  const parameters = (Array.isArray(component?.parameters) ? component.parameters : []).map((parameter: any) => {
    const parameterType = metaStatus(parameter?.type).toLowerCase()
    if (parameterType === 'text') return { type: 'text', text: text(parameter?.text, 2000) }
    if (parameterType === 'coupon_code') return { type: 'coupon_code', coupon_code: text(parameter?.coupon_code, 120) }
    if (['image', 'video', 'document'].includes(parameterType)) return { type: parameterType, [parameterType]: { link: text(parameter?.[parameterType]?.link, 2000) } }
    return null
  }).filter(Boolean)
  if (componentType === 'button') return { type: 'button', sub_type: metaStatus(component?.sub_type).toLowerCase(), index: String(text(component?.index, 2) || '0'), parameters }
  return { type: componentType, parameters }
}).filter((component: any) => component.parameters.length)
// Payload de mensagem de template da Meta Cloud API. `components` já normalizados.
const buildTemplateMetaPayload = (recipient: string, templateName: string, language: string, components: any[]) => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: recipient,
  type: 'template',
  template: {
    name: templateName,
    language: { code: language },
    ...(Array.isArray(components) && components.length ? { components } : {}),
  },
})
// Resposta da Meta sanitizada para log (nunca token, nunca telefone completo).
const metaSendSummary = (body: any) => ({
  message_id: text(body?.messages?.[0]?.id, 200) || null,
  contacts: Array.isArray(body?.contacts) ? body.contacts.length : 0,
  error_code: Number(body?.error?.code || 0) || null,
})
const fetchTemplates = async (config: any) => {
  const fields = 'id,name,language,status,category,components,quality_score,rejected_reason,previous_category,parameter_format'
  let url = `https://graph.facebook.com/${config.version}/${config.wabaId}/message_templates?fields=${encodeURIComponent(fields)}&limit=100`
  const templates:any[] = []
  let page=0
  for (; url && page<100; page++) {
    let meta:any
    try{meta=await fetchMeta(url,config.accessToken,config.operation==='sync_templates'?config:null)}
    catch(error){
      const timedOut=error instanceof DOMException&&error.name==='TimeoutError'
      if(config.operation==='sync_templates')return{error:fail(
        timedOut?'META_TIMEOUT':'META_FETCH_EXCEPTION',
        text((error as any)?.message,500)||'A chamada à Meta lançou uma exceção.',
        timedOut?504:502,
        0,
        timedOut,
        {name:text((error as any)?.name,200),message:text((error as any)?.message,500),cause:auditValue((error as any)?.cause)},
      )}
      return{error:fail(timedOut?'META_TIMEOUT':'META_UNAVAILABLE',timedOut?'A Meta demorou para responder.':'Não foi possível acessar a Meta.',timedOut?504:503,0,true)}
    }
    const {response,body}=meta
    if(!response.ok)return {error:metaFailure(response.status,body,config.requestId)}
    if(!Array.isArray(body?.data))return{error:fail('META_INVALID_RESPONSE','A Meta retornou uma resposta incompleta durante a sincronização.',502)}
    templates.push(...body.data)
    url=text(body?.paging?.next,2000)
  }
  if(url)return {error:fail('META_PAGINATION_LIMIT','A sincronização excedeu o limite seguro de páginas da Meta.',502)}
  return {templates:templates.map(item=>({
    id:text(item.id,80),name:text(item.name,100),language:text(item.language,20),
    status:metaStatus(item.status),category:text(item.category,40),
    components:Array.isArray(item.components)?item.components:[],
    quality:text(item.quality_score?.score || item.quality_score,30).toUpperCase() || 'UNKNOWN',
    rejected_reason:text(item.rejected_reason,500),previous_category:text(item.previous_category,40),
    parameter_format:text(item.parameter_format,40),created_time:item.created_time||null,
    last_updated_time:item.last_updated_time||null,raw_payload:item,
  })),pages:page}
}

const routes: Record<string, { method: string, path: (payload: any) => string, body?: (payload: any) => unknown, write?: boolean, admin?: boolean }> = {
  health: { method: 'GET', path: () => '/health' },
  health_check: { method: 'GET', path: () => '/health' },
  list_conversations: { method: 'GET', path: () => '/api/conversations' },
  find_conversation_by_phone: { method: 'GET', path: p => `/api/conversations/by-phone/${encodeURIComponent(text(p.phone, 40))}` },
  list_messages: { method: 'GET', path: p => `/api/messages?wa_id=${encodeURIComponent(text(p.waId, 40))}&limit=${Math.min(Math.max(Number(p.limit) || 80, 1), 200)}` },
  send_manual_message: { method: 'POST', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}/send`, body: p => ({ text: text(p.text, 4000), idempotency_key:text(p.idempotencyKey,120) }), write: true },
  assign_conversation: { method: 'PATCH', path: p => `/api/attendance/conversations/${encodeURIComponent(text(p.waId, 40))}/assign`, body: p => ({ assigned_to: text(p.assignedTo, 120) }), write: true },
  pause_automation: { method: 'PATCH', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}`, body: () => ({ attendance_mode:'human', automation_paused:true, bot_enabled:false }), write: true },
  update_conversation: { method: 'PATCH', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}`, body: p => ({
    ...(p.changes?.status ? { status: text(p.changes.status, 30) } : {}),
    ...(p.changes?.attendance_mode ? { attendance_mode: text(p.changes.attendance_mode, 30) } : {}),
    ...(typeof p.changes?.automation_paused === 'boolean' ? { automation_paused: p.changes.automation_paused } : {}),
  }), write: true },
  resume_automation: { method: 'POST', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}/handoff/close`, write: true },
  close_conversation: { method: 'PATCH', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}`, body: () => ({ status:'closed' }), write: true },
  get_attendance_meta: { method: 'GET', path: () => '/api/attendance/meta' },
  list_users: { method: 'GET', path: () => '/api/users', admin: true },
  get_dashboard_summary: { method: 'GET', path: () => '/api/dashboard/summary' },
  reconcile_whatsapp_history: { method: 'POST', path: () => '/internal/crm/reconcile', write: true },
  list_crm_contacts: { method: 'GET', path: () => '/internal/crm/contacts' },
  list_crm_message_history: { method: 'GET', path: () => '/internal/crm/messages' },
  start_template_conversation: { method: 'POST', path: () => '/api/conversations/start-template', write: true },
  send_template_message: { method: 'POST', path: () => '/api/conversations/start-template', write: true },
  get_template_test_access: { method: 'GET', path: () => '/internal/template-test-access', admin: true },
  list_templates: { method: 'GET', path: () => '/meta/templates/local' },
  sync_templates: { method: 'GET', path: () => '/meta/templates', write: true },
  get_template_status: { method: 'GET', path: p => {
    const allowed=['mugo_alerta_pagamento_pendente','mugo_pagamento_confirmado','mugo_solicitar_comprovante','mugo_aviso_renovacao_contrato','mugo_agendamento_confirmado','mugo_boas_vindas_diagnostico_v1','hello_world']
    const name=text(p.template_name,100)
    if(!allowed.includes(name))throw new Error('TEMPLATE_NOT_ALLOWED')
    return `/api/templates/${encodeURIComponent(name)}?language=pt_BR`
  } },
  get_usage: { method: 'GET', path: p => `/api/whatsapp/usage?days=${Math.min(Math.max(Number(p.days)||30,1),366)}` },
  list_whatsapp_connections: { method: 'GET', path: () => '/internal/v2/connections' },
  get_whatsapp_connection: { method: 'GET', path: () => '/internal/v2/connections' },
  get_whatsapp_connection_health: { method: 'GET', path: () => '/internal/v2/connections' },
  validate_whatsapp_connection: { method: 'GET', path: () => '/internal/v2/connections' },
  resolve_whatsapp_connection_shadow: { method: 'GET', path: () => '/internal/v2/connections' },
}

const timeoutFor = (operation: string) => {
  if (['health','list_templates','sync_templates','get_template_status','find_conversation_by_phone','get_usage','get_attendance_meta','get_dashboard_summary'].includes(operation)) return 8_000
  if (['list_conversations','list_messages','list_users'].includes(operation)) return 15_000
  if (operation === 'send_template_message') return 12_000
  return 20_000
}

const upstreamFailure = (status: number) => {
  if (status === 401) return ['UPSTREAM_UNAUTHORIZED','A autenticação com o MugoZap falhou.',false] as const
  if (status === 403) return ['UPSTREAM_FORBIDDEN','O MugoZap recusou esta operação.',false] as const
  if (status === 404) return ['UPSTREAM_NOT_FOUND','O recurso solicitado não foi encontrado no MugoZap.',false] as const
  if ([502,503,504].includes(status)) return ['UPSTREAM_UNAVAILABLE','O MugoZap está temporariamente indisponível.',true] as const
  if (status === 409) return ['DUPLICATE_ALERT','Esta operação já foi registrada.',false] as const
  if (status === 422 || status === 400) return ['INVALID_PAYLOAD','O MugoZap recusou os dados enviados.',false] as const
  return ['INTERNAL_ERROR','O MugoZap não conseguiu concluir a operação.',status >= 500] as const
}

const handleRequest = async (request: Request, requestId: string) => {
  const requestStartedAt = Date.now()
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Método não permitido.', 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) {
      console.log(JSON.stringify({event:'mugozap_auth',request_id:requestId,operation:null,authenticated:false,hasProfile:false,hasOrganization:false,status:403,duration_ms:Date.now()-requestStartedAt}))
      return fail('AUTH_SESSION_MISSING', 'Sua sessão expirou. Entre novamente no CRM.', 403)
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const apiUrl = text(Deno.env.get('MUGOZAP_API_URL'), 500).replace(/\/$/, '')
    const panelKey = Deno.env.get('PANEL_API_KEY')
    const workspaceId = text(request.headers.get('X-Workspace-Id'), 120)
    if (!supabaseUrl || !anonKey) return fail('SUPABASE_CONFIGURATION_MISSING', 'A configuração interna do Supabase está incompleta.', 503)

    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) {
      console.log(JSON.stringify({event:'mugozap_auth',request_id:requestId,operation:null,authenticated:false,hasProfile:false,hasOrganization:false,status:403,duration_ms:Date.now()-requestStartedAt}))
      return fail('AUTH_INVALID_TOKEN', 'Sua sessão expirou. Entre novamente no CRM.', 403)
    }
    const authorizedWorkspace = text(user.app_metadata?.workspace_id || (user as any).workspace_id, 120)
    if (workspaceId && (!authorizedWorkspace || workspaceId !== authorizedWorkspace)) return fail('FORBIDDEN', 'Seu usuário não possui acesso a este workspace.', 403)
    const { data: profile } = await client.from('profiles').select('organization_id,role,active').eq('id', user.id).single()
    if (!profile) {
      console.log(JSON.stringify({event:'mugozap_auth',request_id:requestId,operation:null,authenticated:true,hasProfile:false,hasOrganization:false,status:403,duration_ms:Date.now()-requestStartedAt}))
      return fail('PROFILE_NOT_FOUND', 'Perfil do usuário não encontrado.', 403)
    }
    if (!profile.organization_id) return fail('ORGANIZATION_NOT_FOUND', 'Organização do usuário não encontrada.', 403)
    if (!profile.active) return fail('FORBIDDEN', 'Seu usuário não possui acesso ativo.', 403)

    const incoming = await request.json().catch(() => null)
    if (!incoming || JSON.stringify(incoming).length > 12000) return fail('INVALID_PAYLOAD', 'Payload inválido ou acima do limite.', 413)
    const requestedOperation=text(incoming.operation,60)
    const operationAliases:Record<string,string>={get_conversation_messages:'list_messages',send_template:'send_template_message'}
    const operation = operationAliases[requestedOperation]||requestedOperation, route = routes[operation]
    auditOperation('edge_received',operation,{request_id:requestId,organization_id:profile.organization_id,payload_received:incoming.payload||{}})
    console.log(JSON.stringify({event:'mugozap_request',request_id:requestId,operation,user_id:user.id,organization_id:profile.organization_id,role:profile.role,authenticated:true,status:200,duration_ms:Date.now()-requestStartedAt}))
    if (!route) return fail('INVALID_OPERATION', 'Operação não autorizada.', 400)
    if (route.write && !['admin','manager'].includes(profile.role)) return fail('FORBIDDEN', operation==='sync_templates'?'Seu perfil não pode sincronizar templates.':'Seu perfil não pode alterar conversas.', 403)
    if (route.admin && profile.role !== 'admin') return fail('FORBIDDEN', 'Somente administradores podem consultar usuários do WhatsApp.', 403)
    const payload = incoming.payload || {}

    // Health operacional do CRM: Meta + conexão canônica + Supabase.
    // MugoZap permanece legado/opcional e não decide o estado da Inbox.
    if(operation==='health_check'){
      const [lastTemplateSync,connectionResult]=await Promise.all([
        client.from('whatsapp_message_templates')
          .select('last_synced_at')
          .eq('organization_id',profile.organization_id)
          .order('last_synced_at',{ascending:false})
          .limit(1)
          .maybeSingle(),
        client.from('whatsapp_connections_public')
          .select('id,status')
          .limit(1)
          .maybeSingle(),
      ])

      if(connectionResult.error){
        return fail(
          'CONNECTION_REGISTRY_UNAVAILABLE',
          'O registro de conexões está indisponível.',
          503
        )
      }

      return json({ok:true,data:{
        edge_function:'online',
        supabase:'online',
        health_source:'canonical',
        meta_configured:Boolean(
          Deno.env.get('WABA_ID') &&
          Deno.env.get('PHONE_NUMBER_ID') &&
          Deno.env.get('META_ACCESS_TOKEN') &&
          Deno.env.get('GRAPH_API_VERSION')
        ),
        whatsapp_connections_v2_enabled:true,
        whatsapp_connection_found:Boolean(connectionResult.data),
        whatsapp_connection_status:connectionResult.data?.status||null,
        last_template_sync:lastTemplateSync.error
          ? null
          : lastTemplateSync.data?.last_synced_at||null,
        timestamp:new Date().toISOString(),
      }})
    }
    if(operation==='list_crm_contacts'){
      const limit=Math.min(Math.max(Number(payload.limit)||100,1),200)
      const result=await client.from('whatsapp_contacts')
        .select('id,connection_id,client_id,wa_id,display_name,profile_name,first_seen_at,last_seen_at,updated_at')
        .eq('organization_id',profile.organization_id).order('last_seen_at',{ascending:false}).limit(limit)
      if(result.error)return fail('WHATSAPP_HISTORY_UNAVAILABLE','Não foi possível ler os contatos do WhatsApp.',503)
      return json({ok:true,data:{items:result.data||[],source:'crm'}})
    }
    if(operation==='list_crm_message_history'){
      const waId=identifier(payload.waId),limit=Math.min(Math.max(Number(payload.limit)||100,1),200)
      if(!waId)return fail('INVALID_CONVERSATION_ID','Identificador da conversa ausente.',400)
      const conversations=await client.from('whatsapp_conversations').select('id').eq('organization_id',profile.organization_id).eq('wa_id',waId)
      if(conversations.error)return fail('WHATSAPP_HISTORY_UNAVAILABLE','Não foi possível localizar a conversa.',503)
      if(!conversations.data?.length)return json({ok:true,data:{items:[],source:'crm'}})
      const result=await client.from('whatsapp_messages')
        .select('id,conversation_id,provider_message_id,direction,message_type,status,text_content,media,template_name,template_language,error_code,error_message,provider_timestamp,sent_at,delivered_at,read_at,failed_at,created_at')
        .in('conversation_id',conversations.data.map((item:any)=>item.id)).order('created_at',{ascending:true}).limit(limit)
      if(result.error)return fail('WHATSAPP_HISTORY_UNAVAILABLE','Não foi possível ler o histórico do WhatsApp.',503)
      return json({ok:true,data:{items:result.data||[],source:'crm'}})
    }
    if(operation==='reconcile_whatsapp_history'){
      if(!serviceKey)return fail('SUPABASE_SERVICE_ROLE_KEY_MISSING','A reconciliação canônica não está configurada.',503)
      const alerts=await client.from('whatsapp_collection_alerts')
        .select('id,client_id,wa_id,provider_message_id,template_name,template_language,status,sent_at')
        .eq('organization_id',profile.organization_id).not('provider_message_id','is',null)
        .order('sent_at',{ascending:false}).limit(Math.min(Math.max(Number(payload.limit)||200,1),500))
      if(alerts.error)return fail('CANONICAL_RECONCILIATION_FAILED','Não foi possível ler os envios confirmados.',503)
      const summary={checked:alerts.data?.length||0,reconciled:0,failed:0,items:[] as any[]}
      for(const alert of alerts.data||[]){
        try{
          const canonical=await persistOutboundMessage({supabaseUrl,serviceKey,organizationId:profile.organization_id,
            recipient:brazilianPhone(alert.wa_id),providerMessageId:text(alert.provider_message_id,200),
            idempotencyKey:`collection-alert-${alert.id}`,messageType:'template',templateName:alert.template_name,
            templateLanguage:alert.template_language||'pt_BR',clientId:alert.client_id,sentAt:alert.sent_at,status:'sent'})
          summary.reconciled+=1;summary.items.push({alert_id:alert.id,provider_message_id:alert.provider_message_id,conversation_id:canonical.conversation_id})
        }catch(error){summary.failed+=1;summary.items.push({alert_id:alert.id,error_code:text((error as any)?.code||(error as any)?.message,120)})}
      }
      return json({ok:true,data:summary})
    }
    const connectionOperations = new Set(['list_whatsapp_connections','get_whatsapp_connection','get_whatsapp_connection_health','validate_whatsapp_connection','resolve_whatsapp_connection_shadow'])
    if(connectionOperations.has(operation)){
      const enabled=text(Deno.env.get('WHATSAPP_CONNECTIONS_V2')||'false',10).toLowerCase()==='true'
      if(!enabled)return fail('WHATSAPP_CONNECTIONS_V2_DISABLED','O registro multicliente ainda não está habilitado.',404)
      const connectionId=text(payload.connection_id,80)
      if(operation!=='list_whatsapp_connections'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)){
        return fail('INVALID_CONNECTION_ID','Identificador de conexão inválido.',400)
      }
      if(operation==='list_whatsapp_connections'){
        const result=await client.from('whatsapp_connections_public').select('id,provider,display_phone_number,verified_name,status,connection_health,capabilities,last_sync_at,last_health_check_at,created_at,updated_at').order('created_at')
        if(result.error)return fail('CONNECTION_REGISTRY_UNAVAILABLE','O registro de conexões está indisponível.',503)
        return json({ok:true,data:{items:result.data||[]}})
      }
      if(operation==='resolve_whatsapp_connection_shadow'){
        const mode=text(Deno.env.get('WHATSAPP_CONNECTIONS_V2_READ_MODE')||'shadow',20).toLowerCase()
        if(mode!=='shadow')return fail('CONNECTION_SHADOW_MODE_REQUIRED','A resolução comparativa não está disponível neste modo.',409)
        const result=await client.rpc('resolve_whatsapp_connection_shadow',{p_connection_id:connectionId,p_legacy_workspace_id:authorizedWorkspace})
        if(result.error)return fail('CONNECTION_REGISTRY_UNAVAILABLE','O registro de conexões está indisponível.',503)
        const connection=result.data?.[0]
        if(!connection)return fail('CONNECTION_NOT_FOUND','Conexão não encontrada.',404)
        return json({ok:true,data:{connection:{...connection,workspace_match:Boolean(connection.workspace_match)},mode:'shadow'}})
      }
      const result=await client.rpc('get_whatsapp_connection_public',{p_connection_id:connectionId})
      if(result.error)return fail('CONNECTION_REGISTRY_UNAVAILABLE','O registro de conexões está indisponível.',503)
      const connection=result.data?.[0]
      if(!connection)return fail('CONNECTION_NOT_FOUND','Conexão não encontrada.',404)
      if(operation==='get_whatsapp_connection_health'){
        return json({ok:true,data:{id:connection.id,status:connection.status,connection_health:connection.connection_health||{},last_health_check_at:connection.last_health_check_at}})
      }
      if(operation==='validate_whatsapp_connection'){
        const valid=connection.status==='active'
        return json({ok:true,data:{id:connection.id,valid,status:connection.status,provider:connection.provider,capabilities:connection.capabilities||{},error_code:valid?null:`CONNECTION_${String(connection.status||'configuration_missing').toUpperCase()}`}})
      }
      return json({ok:true,data:{connection}})
    }
    if (operation === 'list_templates') {
      const wabaId=text(Deno.env.get('WABA_ID'),80)
      if(!wabaId||!/^\d+$/.test(wabaId))return fail('WABA_ID_INVALID','O WABA ID não foi configurado corretamente no backend.',503)
      const local=await client.from('whatsapp_message_templates').select('*').eq('organization_id',profile.organization_id).eq('waba_id',wabaId).order('name')
      if(local.error)return fail('TEMPLATE_STORAGE_READ_FAILED','Não foi possível ler os templates salvos.',500)
      const templates=(local.data||[]).map((item:any)=>({...item,id:item.meta_template_id||item.id,quality:item.quality_score,lastSyncedAt:item.last_synced_at}))
      const frontendBody={templates,last_sync:templates.reduce((latest:any,item:any)=>!latest||String(item.last_synced_at)>latest?item.last_synced_at:latest,null),source:'supabase'}
      auditOperation('edge_frontend_response',operation,{request_id:requestId,organization_id:profile.organization_id,status_http:200,body_returned_to_frontend:frontendBody})
      return json({ok:true,data:frontendBody})
    }
    if(operation==='get_template_test_access'){
      const recipient=brazilianPhone(payload.recipient),templateName=text(payload.template_name,100),language=text(payload.language||'pt_BR',20)
      const authorizedPhone=brazilianPhone(Deno.env.get('WHATSAPP_TEMPLATE_TEST_PHONE')),configuredTemplate=text(Deno.env.get('WHATSAPP_TEMPLATE_TEST_NAME'),100)
      const wabaId=text(Deno.env.get('WABA_ID'),80)
      const stored=await client.from('whatsapp_message_templates').select('name,language,status,parameter_format,components,is_active').eq('organization_id',profile.organization_id).eq('waba_id',wabaId).eq('name',templateName).eq('language',language).maybeSingle()
      const authorizedRecipient=Boolean(recipient&&authorizedPhone&&recipient===authorizedPhone)
      const authorizedTemplate=Boolean(templateName&&configuredTemplate&&templateName===configuredTemplate)
      const templateFound=Boolean(!stored.error&&stored.data)
      const templateApproved=templateFound&&metaStatus(stored.data.status)==='APPROVED'&&stored.data.is_active!==false
      const testModeAvailable=Boolean(authorizedPhone&&configuredTemplate&&authorizedRecipient&&authorizedTemplate&&templateApproved)
      const reason=!authorizedPhone||!configuredTemplate
        ?'A homologação ainda não foi configurada no servidor.'
        :!authorizedRecipient
          ?'Este destinatário não está autorizado para homologação.'
          :!authorizedTemplate
            ?'Este modelo ainda não está autorizado para teste.'
            :!templateApproved
              ?'Este modelo não está aprovado e ativo para esta organização.'
              :'Homologação autorizada pelo servidor.'
      return json({ok:true,data:{
        allowed:testModeAvailable,
        authenticated:true,
        authorized_user:true,
        authorized_recipient:authorizedRecipient,
        authorized_template:authorizedTemplate,
        template_found:templateFound,
        template_status:templateFound?metaStatus(stored.data.status):null,
        template_name:templateFound?text(stored.data.name,100):templateName,
        language:templateFound?text(stored.data.language,20):language,
        parameter_format:templateFound?text(stored.data.parameter_format,30)||null:null,
        components:templateFound&&Array.isArray(stored.data.components)?stored.data.components:[],
        components_supported:true,
        test_mode_available:testModeAvailable,
        reason,
      }})
    }
    if (operation === 'sync_templates' || operation === 'get_template_status') {
      const config:any=metaConfig(false)
      if(config.error)return config.error
      config.requestId=requestId
      config.operation=operation
      auditOperation('edge_upstream_request',operation,{request_id:requestId,organization_id:profile.organization_id,endpoint_called:`https://graph.facebook.com/${config.version}/${config.wabaId}/message_templates`,payload_sent:{fields:'template metadata',limit:100}})
      const result:any=await fetchTemplates(config)
      if(result.error)return result.error
      auditOperation('upstream_received',operation,{request_id:requestId,organization_id:profile.organization_id,status_http:200,body_received:{templates:result.templates,pages:result.pages}})
      const now=new Date().toISOString()
      console.log(JSON.stringify({event:'meta_template_sync',request_id:requestId,operation,user_id:user.id,organization_id:profile.organization_id,waba_id:config.wabaId,meta_status:200,result:'success',templates:result.templates.length,pages:result.pages,duration_ms:Date.now()-requestStartedAt}))
      if(operation==='get_template_status'){
        const name=text(payload.template_name,100),language=text(payload.language||'pt_BR',20)
        const template=result.templates.find((item:any)=>item.name===name&&item.language===language)
        if(!template)return fail('TEMPLATE_NOT_FOUND', `O template ${name} não foi encontrado na Meta para o idioma ${language}.`, 404)
        return json({ok:true,data:{template,last_sync:now}})
      }
      const templateRows=result.templates.map((item:any)=>({organization_id:profile.organization_id,waba_id:config.wabaId,meta_template_id:item.id,name:item.name,language:item.language,status:item.status,category:item.category,components:item.components,quality_score:item.quality,rejected_reason:item.rejected_reason||null,previous_category:item.previous_category||null,parameter_format:item.parameter_format||null,raw_payload:item.raw_payload||{},meta_created_at:item.created_time||null,meta_updated_at:item.last_updated_time||null,last_synced_at:now,is_active:true,sync_error:null}))
      const persisted=templateRows.length?await client.from('whatsapp_message_templates').upsert(templateRows,{onConflict:'organization_id,waba_id,name,language'}):{error:null}
      if(persisted.error)return fail('TEMPLATE_STORAGE_WRITE_FAILED','A Meta respondeu, mas os templates não puderam ser salvos.',500,0,false)
      const existing=await client.from('whatsapp_message_templates').select('id,meta_template_id').eq('organization_id',profile.organization_id).eq('waba_id',config.wabaId).eq('is_active',true)
      if(existing.error)return fail('TEMPLATE_STORAGE_READ_FAILED','Os templates foram salvos, mas a reconciliação não pôde ser concluída.',500)
      const receivedIds=new Set(result.templates.map((item:any)=>item.id).filter(Boolean))
      const absentIds=(existing.data||[]).filter((item:any)=>item.meta_template_id&&!receivedIds.has(item.meta_template_id)).map((item:any)=>item.id)
      if(absentIds.length){
        const deactivated=await client.from('whatsapp_message_templates').update({is_active:false,last_synced_at:now}).in('id',absentIds)
        if(deactivated.error)return fail('TEMPLATE_RECONCILIATION_FAILED','A sincronização foi salva, mas templates ausentes não puderam ser reconciliados.',500)
      }
      const frontendBody={templates:result.templates.map((item:any)=>({...item,waba_id:config.wabaId,is_active:true,last_synced_at:now})),last_sync:now,pages:result.pages,deactivated:absentIds.length,source:'meta'}
      auditOperation('edge_transformed',operation,{request_id:requestId,organization_id:profile.organization_id,body_transformed:frontendBody})
      auditOperation('edge_frontend_response',operation,{request_id:requestId,organization_id:profile.organization_id,status_http:200,body_returned_to_frontend:frontendBody})
      return json({ok:true,data:frontendBody})
    }
    // O contrato real do MugoZap responde apenas {ok:boolean} no envio manual e
    // descarta o wamid retornado pela Meta. Para não confirmar um envio sem ledger
    // nem induzir retry/duplicidade, o CRM usa a Meta diretamente nesta operação.
    if(operation==='send_manual_message'){
      const recipient=identifier(payload.waId),bodyText=text(payload.text,4000),idempotencyKey=text(payload.idempotencyKey,120)
      if(!recipient||!bodyText)return fail('INVALID_PAYLOAD','Digite uma mensagem e informe uma conversa válida.',422)
      if(!idempotencyKey)return fail('IDEMPOTENCY_KEY_MISSING','Não foi possível identificar esta tentativa de envio.',422)
      if(!serviceKey)return fail('SUPABASE_SERVICE_ROLE_KEY_MISSING','O histórico canônico não está configurado.',503)
      const existing=await client.from('whatsapp_messages').select('id,provider_message_id,status,conversation_id')
        .eq('organization_id',profile.organization_id).eq('idempotency_key',idempotencyKey).maybeSingle()
      if(existing.error)return fail('WHATSAPP_HISTORY_UNAVAILABLE','Não foi possível validar a idempotência do envio.',503)
      if(existing.data?.provider_message_id)return json({ok:true,data:{already_sent:true,provider_message_id:existing.data.provider_message_id,message_id:existing.data.provider_message_id,status:existing.data.status,conversation_id:existing.data.conversation_id}})
      if(existing.data)return fail('SEND_OUTCOME_UNKNOWN','Já existe uma tentativa sem confirmação para esta chave. A mensagem não será reenviada automaticamente.',409)
      let conversationQuery=client.from('whatsapp_conversations').select('id,connection_id,service_window_expires_at')
        .eq('organization_id',profile.organization_id).eq('wa_id',recipient)
      if(text(payload.conversationId,80))conversationQuery=conversationQuery.eq('id',text(payload.conversationId,80))
      const conversation=await conversationQuery.maybeSingle()
      if(conversation.error||!conversation.data)return fail('CONVERSATION_NOT_FOUND','A conversa canônica não foi encontrada.',404)
      if(!conversation.data.service_window_expires_at||new Date(conversation.data.service_window_expires_at).getTime()<=Date.now())return fail('SERVICE_WINDOW_CLOSED','A janela de atendimento está encerrada. Use um template aprovado.',409)
      const config:any=metaConfig(true)
      if(config.error)return config.error
      try{await persistOutboundMessage({supabaseUrl,serviceKey,organizationId:profile.organization_id,recipient,connectionId:conversation.data.connection_id,providerMessageId:null,idempotencyKey,messageType:'text',textContent:bodyText,status:'queued'})}
      catch(error){return fail('CRM_AUDIT_FAILED','Não foi possível reservar a mensagem no histórico canônico; nada foi enviado.',503,0,true,{code:text((error as any)?.code||(error as any)?.message,120)})}
      let sent:any
      try{sent=await sendMetaMessage(config,{messaging_product:'whatsapp',recipient_type:'individual',to:recipient,type:'text',text:{preview_url:false,body:bodyText}})}
      catch(error){const timedOut=error instanceof DOMException&&error.name==='TimeoutError';return fail(timedOut?'META_TIMEOUT':'META_UNAVAILABLE',timedOut?'A Meta demorou para responder.':'Não foi possível enviar pela Meta.',timedOut?504:503,0,true)}
      if(!sent.response.ok)return metaFailure(sent.response.status,sent.body,requestId)
      const providerMessageId=text(sent.body?.messages?.[0]?.id,200)
      if(!providerMessageId)return fail('MESSAGE_SEND_UNCONFIRMED','A Meta não confirmou o envio. Verifique o histórico antes de tentar novamente.',502)
      try{
        const canonical=await persistOutboundMessage({supabaseUrl,serviceKey,organizationId:profile.organization_id,recipient,connectionId:conversation.data.connection_id,providerMessageId,idempotencyKey,messageType:'text',textContent:bodyText})
        const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}})
        await admin.from('whatsapp_conversations').update({attendance_mode:'human',automation_paused:true,handoff_reason:'manual_message'}).eq('id',canonical.conversation_id)
        await admin.from('whatsapp_conversation_events').insert({organization_id:profile.organization_id,connection_id:canonical.connection_id,conversation_id:canonical.conversation_id,event_type:'manual_message_sent',actor_id:user.id,details:{provider_message_id:providerMessageId}})
        return json({ok:true,data:{provider_message_id:providerMessageId,message_id:providerMessageId,status:'accepted',conversation:canonical.conversation,message:canonical.message}})
      }catch(error){console.log(JSON.stringify({event:'whatsapp_history_write_failed',request_id:requestId,operation,provider_message_id:providerMessageId,error_code:text((error as any)?.code||(error as any)?.message,120)}));return fail('MESSAGE_PERSISTENCE_UNCONFIRMED','A mensagem foi ACEITA pela Meta, mas o histórico canônico não pôde ser concluído. NÃO reenvie — verifique o histórico da conversa.',502,0,false,{provider_message_id:providerMessageId})}
    }

    // Templates (cobrança e homologação) usam a Meta Cloud API diretamente e não
    // dependem do MugoZap. A exigência de MugoZap é verificada mais abaixo, só para
    // as operações que ainda o utilizam como transporte.
    let alertReservationId = ''
    let verifiedPayload: unknown = undefined
    let genericTemplateClientId = ''
    if (operation === 'start_template_conversation') {
      const clientId = text(payload.client_id, 80), installmentId = text(payload.installment_id, 80)
      const startIdempotencyKey = text(payload.idempotency_key, 120).replace(/[^A-Za-z0-9_-]/g, '')
      const templateName = text(payload.template_name, 100), language = text(payload.language, 20)
      if (!clientId || !installmentId || templateName !== 'mugo_alerta_pagamento_pendente' || language !== 'pt_BR') return fail('INVALID_TEMPLATE_REQUEST', 'Os dados para iniciar a conversa são inválidos.', 400)
      const [clientResult, installmentResult, duplicateResult] = await Promise.all([
        client.from('clients').select('id,organization_id,company_name,trade_name,contact_name,phone,billing_contact_phone').eq('id',clientId).eq('organization_id',profile.organization_id).single(),
        client.from('invoice_installments').select('id,organization_id,client_id,contract_id,status,due_date,amount').eq('id',installmentId).eq('organization_id',profile.organization_id).single(),
        client.from('whatsapp_collection_alerts').select('id,status,client_id,wa_id,provider_message_id,template_name,template_language,sent_at').eq('organization_id',profile.organization_id).eq('installment_id',installmentId).eq('template_name',templateName).maybeSingle(),
      ])
      if (clientResult.error || !clientResult.data || installmentResult.error || !installmentResult.data) return fail('COLLECTION_NOT_FOUND', 'Cliente ou parcela não encontrado.', 404)
      const clientRow:any = clientResult.data, installment:any = installmentResult.data
      if (installment.client_id !== clientRow.id) return fail('CLIENT_MISMATCH', 'A parcela não pertence ao cliente informado.', 403)
      if (installment.status === 'paid') return fail('INSTALLMENT_PAID', 'Esta parcela já foi paga e não pode ser cobrada.', 409)
      if (duplicateResult.data && duplicateResult.data.status !== 'failed') {
        const previous:any=duplicateResult.data
        if(!previous.provider_message_id)return fail('COLLECTION_DUPLICATE','Um alerta desta cobrança já foi enviado, mas ainda não possui confirmação canônica.',409)
        try{
          const canonical=await persistOutboundMessage({supabaseUrl,serviceKey,organizationId:profile.organization_id,
            recipient:brazilianPhone(previous.wa_id),providerMessageId:text(previous.provider_message_id,200),
            idempotencyKey:`collection-alert-${previous.id}`,messageType:'template',templateName:previous.template_name,
            templateLanguage:previous.template_language||'pt_BR',clientId:previous.client_id,sentAt:previous.sent_at,status:'sent'})
          return json({ok:true,data:{already_sent:true,reconciled:true,provider_message_id:previous.provider_message_id,
            message_id:previous.provider_message_id,status:'sent',conversation:canonical.conversation,message:canonical.message}})
        }catch(error){
          console.log(JSON.stringify({event:'whatsapp_reconciliation_failed',request_id:requestId,alert_id:previous.id,error_code:text((error as any)?.code||(error as any)?.message,120)}))
          return fail('CANONICAL_RECONCILIATION_FAILED','O envio anterior foi confirmado, mas não pôde ser reconstruído no histórico. A mensagem não foi reenviada.',503)
        }
      }
      if (duplicateResult.data?.status === 'failed') await client.from('whatsapp_collection_alerts').delete().eq('id',duplicateResult.data.id)
      const normalizedPhone = brazilianPhone(payload.phone)
      const storedPhones = [clientRow.phone,clientRow.billing_contact_phone].map(brazilianPhone).filter(Boolean)
      if (!normalizedPhone) return fail('INVALID_PHONE', 'Informe um número de WhatsApp válido com DDD.', 422)
      if (!storedPhones.includes(normalizedPhone)) return fail('PHONE_MISMATCH', 'O telefone não pertence ao cliente informado.', 403)
      const safeName = text(clientRow.contact_name || clientRow.trade_name || clientRow.company_name, 120).split(/\s+/)[0] || 'Cliente'
      const config:any=metaConfig(true)
      if(config.error)return config.error
      config.requestId=requestId
      let phoneCheck:any
      try{
        phoneCheck=await fetchMeta(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}?fields=id,account_mode`,config.accessToken)
      }catch(error){
        const timedOut=error instanceof DOMException&&error.name==='TimeoutError'
        console.log(JSON.stringify({event:'meta_whatsapp_error',request_id:requestId,operation:'start_template_conversation',phase:'phone_check',error_name:text((error as any)?.name,120),error_message:text((error as any)?.message,500)}))
        return fail(
          timedOut?'META_TIMEOUT':'META_UNREACHABLE',
          timedOut?'A Meta demorou para responder ao validar o número.':'Não foi possível contatar a Meta para validar o número do WhatsApp.',
          timedOut?504:502,
          0,
          timedOut,
          {phase:'phone_check',name:text((error as any)?.name,120),message:text((error as any)?.message,500)},
        )
      }
      if(!phoneCheck.response.ok)return metaFailure(phoneCheck.response.status,phoneCheck.body,requestId)
      const templateResult:any=await fetchTemplates(config)
      if(templateResult.error)return templateResult.error
      const officialTemplate=templateResult.templates.find((item:any)=>item.name===templateName&&item.language===language)
      if(!officialTemplate)return fail('TEMPLATE_NOT_FOUND', `O template ${templateName} não foi encontrado na Meta para o idioma ${language}.`, 404)
      if(!availableTemplate(officialTemplate.status)){
        if(officialTemplate.status==='PENDING')return fail('TEMPLATE_PENDING','O template ainda está em análise na Meta.',409)
        if(officialTemplate.status==='REJECTED')return fail('TEMPLATE_REJECTED','O template foi rejeitado pela Meta.',409)
        if(officialTemplate.status==='PAUSED')return fail('TEMPLATE_PAUSED','O template está pausado na Meta.',409)
        return fail('TEMPLATE_DISABLED','O template está desativado na Meta.',409)
      }
      const requiredBodyParameters=officialTemplate.components.filter((item:any)=>metaStatus(item.type)==='BODY').reduce((total:number,item:any)=>total+templateVariables(item),0)
      const requiredHeaderParameters=officialTemplate.components.filter((item:any)=>metaStatus(item.type)==='HEADER').reduce((total:number,item:any)=>total+templateVariables(item),0)
      const requiresCoupon=officialTemplate.components.some((item:any)=>metaStatus(item.type)==='BUTTONS'&&Array.isArray(item.buttons)&&item.buttons.some((button:any)=>['COPY_CODE','COPY_CODE_BUTTON'].includes(metaStatus(button.type))))
      if(requiredHeaderParameters>0)return fail('TEMPLATE_PARAMETERS_MISSING','O template exige parâmetros no cabeçalho que não foram informados.',422)
      if(requiredBodyParameters>1)return fail('TEMPLATE_PARAMETERS_MISSING',`O template exige ${requiredBodyParameters} parâmetros no corpo, mas este fluxo fornece apenas o nome do cliente.`,422)
      const couponCode=text(payload.coupon_code,120)
      if(requiresCoupon&&!couponCode)return fail('TEMPLATE_COUPON_REQUIRED','Este template exige um código de cupom para o botão de copiar.',422)
      verifiedPayload = {wa_id:normalizedPhone,template_name:templateName,language,parameters:requiredBodyParameters?[safeName]:[],...(couponCode?{coupon_code:couponCode}:{}),source:'collection',client_id:clientRow.id,installment_id:installment.id}
      const reservation = await client.from('whatsapp_collection_alerts').insert({organization_id:profile.organization_id,client_id:clientRow.id,installment_id:installment.id,contract_id:installment.contract_id,wa_id:normalizedPhone,recipient:normalizedPhone,company_name:text(clientRow.company_name,200),meta_template_id:officialTemplate.id,template_name:templateName,template_language:language,template_status:'CHECKING',collection_stage:'sending',action:'template_send_requested',status:'sending',sent_by:user.id,origin:'collection',currency:'BRL',sanitized_payload:{to:normalizedPhone,template:{name:templateName,language,parameter_count:requiredBodyParameters,has_coupon:Boolean(couponCode)},source:'collection',idempotency_key:startIdempotencyKey||null}}).select('id').single()
      if (reservation.error) return fail('COLLECTION_DUPLICATE', 'Um alerta desta cobrança já foi enviado.', 409)
      alertReservationId = reservation.data.id
      if (!serviceKey) {
        await client.from('whatsapp_collection_alerts').update({ status: 'failed', collection_stage: 'failed', action: 'template_send_failed', error_code: 'SUPABASE_SERVICE_ROLE_KEY_MISSING', error_message: 'O histórico canônico não está configurado; nada foi enviado.' }).eq('id', alertReservationId)
        return fail('SUPABASE_SERVICE_ROLE_KEY_MISSING', 'O histórico canônico não está configurado; nada foi enviado.', 503)
      }

      // ===== Transporte direto Meta Cloud API — o MugoZap não participa do envio =====
      const collectionComponents = metaTemplateComponents([
        ...((verifiedPayload as any).parameters.length ? [{ type: 'body', parameters: (verifiedPayload as any).parameters.map((value: string) => ({ type: 'text', text: value })) }] : []),
        ...(couponCode ? [{ type: 'button', sub_type: 'copy_code', index: String(couponButtonIndex(officialTemplate)), parameters: [{ type: 'coupon_code', coupon_code: couponCode }] }] : []),
      ])
      const collectionMetaPayload = buildTemplateMetaPayload(normalizedPhone, templateName, language, collectionComponents)
      auditOperation('edge_upstream_request', operation, { request_id: requestId, organization_id: profile.organization_id, endpoint_called: `https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`, payload_sent: collectionMetaPayload })
      let collectionSend: any
      try {
        collectionSend = await sendMetaMessage(config, collectionMetaPayload)
      } catch (error) {
        // Timeout DEPOIS do disparo: a Meta pode ter aceitado. Nunca reenviar automaticamente.
        // A reserva fica reconciliável (sem provider_message_id) e o operador confere o histórico.
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
        await client.from('whatsapp_collection_alerts').update(timedOut
          ? { action: 'template_send_unconfirmed', error_code: 'META_TIMEOUT', error_message: 'A Meta demorou para responder após o disparo. Verifique o histórico antes de tentar novamente.' }
          : { status: 'failed', collection_stage: 'failed', action: 'template_send_failed', error_code: 'META_UNREACHABLE', error_message: 'Não foi possível contatar a Meta para enviar o template.' }
        ).eq('id', alertReservationId)
        return fail(
          timedOut ? 'META_TIMEOUT' : 'META_UNAVAILABLE',
          timedOut ? 'A Meta demorou para responder após o disparo. Verifique o histórico da conversa antes de tentar novamente; a mensagem não será reenviada automaticamente.' : 'Não foi possível enviar o template pela Meta.',
          timedOut ? 504 : 503, 0, timedOut,
        )
      }
      auditOperation('upstream_received', operation, { request_id: requestId, organization_id: profile.organization_id, status_http: collectionSend.response.status, body_received: collectionSend.body })
      console.log(JSON.stringify({ event: 'meta_template_send', request_id: requestId, operation, status_http: collectionSend.response.status, phone_masked: maskPhone(normalizedPhone), result: metaSendSummary(collectionSend.body) }))
      if (!collectionSend.response.ok) {
        const collectionMetaError = sanitizedMetaError(collectionSend.body)
        await client.from('whatsapp_collection_alerts').update({
          status: 'failed', collection_stage: 'failed', action: 'template_send_failed',
          error_code: collectionMetaError.code ? `META_${collectionMetaError.code}` : 'META_API_ERROR',
          error_message: text(collectionMetaError.message, 500) || 'A Meta recusou o envio do template.',
          raw_response: { provider: 'meta', error: collectionMetaError },
        }).eq('id', alertReservationId)
        return metaFailure(collectionSend.response.status, collectionSend.body, requestId)
      }
      const collectionMessageId = text(collectionSend.body?.messages?.[0]?.id, 200)
      if (!collectionMessageId) {
        await client.from('whatsapp_collection_alerts').update({
          action: 'template_send_unconfirmed',
          error_code: 'META_MESSAGE_ID_MISSING', error_message: 'A Meta respondeu sem o identificador da mensagem.',
        }).eq('id', alertReservationId)
        return fail('MESSAGE_SEND_UNCONFIRMED', 'A Meta não confirmou o envio (sem identificador de mensagem). Verifique o histórico antes de tentar novamente.', 502)
      }
      try {
        const canonical = await persistOutboundMessage({
          supabaseUrl, serviceKey, organizationId: profile.organization_id, recipient: normalizedPhone, providerMessageId: collectionMessageId,
          idempotencyKey: startIdempotencyKey || `collection-alert-${alertReservationId}`, messageType: 'template',
          templateName, templateLanguage: language, templateComponents: collectionComponents, clientId: clientRow.id, status: 'sent',
        })
        const alertUpdate = await client.from('whatsapp_collection_alerts').update({
          wa_id: normalizedPhone, provider_message_id: collectionMessageId, template_status: 'APPROVED',
          collection_stage: 'waiting_customer', action: 'template_sent', status: 'sent', sent_at: new Date().toISOString(),
          raw_response: { provider: 'meta', provider_message_id: collectionMessageId, contacts: auditValue(collectionSend.body?.contacts) },
          error_code: null, error_message: null,
        }).eq('id', alertReservationId)
        const linkResult = await client.from('whatsapp_conversation_links').upsert({
          organization_id: profile.organization_id, client_id: clientRow.id, wa_id: normalizedPhone, phone: normalizedPhone,
          conversation_id: String(canonical.conversation_id),
        }, { onConflict: 'organization_id,client_id' })
        await client.from('commercial_events').insert({
          organization_id: profile.organization_id, client_id: clientRow.id, installment_id: installment.id,
          event_type: 'whatsapp_collection_alert_sent', title: 'Alerta de cobrança enviado pelo WhatsApp',
          new_value: { wa_id: normalizedPhone, template_name: templateName, provider_message_id: collectionMessageId, language, source: 'collection' }, created_by: user.id,
        })
        if (alertUpdate.error || linkResult.error) return fail('MESSAGE_PERSISTENCE_UNCONFIRMED', 'O alerta foi ACEITO pela Meta, mas o estado final no CRM não pôde ser concluído. NÃO reenvie — verifique o histórico da conversa.', 502, 0, false, { provider_message_id: collectionMessageId })
        return json({ ok: true, data: { provider_message_id: collectionMessageId, message_id: collectionMessageId, status: 'accepted', conversation: canonical.conversation, message: canonical.message } })
      } catch (error) {
        console.log(JSON.stringify({ event: 'whatsapp_history_write_failed', request_id: requestId, operation, provider_message_id: collectionMessageId, error_code: text((error as any)?.code || (error as any)?.message, 120) }))
        return fail('MESSAGE_PERSISTENCE_UNCONFIRMED', 'O alerta foi ACEITO pela Meta, mas o histórico canônico não pôde ser concluído. NÃO reenvie — verifique o histórico da conversa.', 502, 0, false, { provider_message_id: collectionMessageId })
      }
    }
    if(operation==='send_template_message'){
      const recipient=brazilianPhone(payload.recipient),templateName=text(payload.template_name,100),language=text(payload.language,20),components=payload.components
      const idempotencyKey=text(payload.idempotency_key,120),contractMode=text(payload.contract_mode||'minimal',30)
      if(!recipient)return fail('INVALID_PHONE','Informe um telefone válido com DDI e DDD.',422)
      if(!/^[a-z0-9_]{1,100}$/.test(templateName)||!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language))return fail('INVALID_TEMPLATE_REQUEST','Nome ou idioma do template inválido.',422)
      if(!/^[A-Za-z0-9_-]{16,120}$/.test(idempotencyKey))return fail('IDEMPOTENCY_KEY_MISSING','A tentativa de envio precisa de uma chave de idempotência válida.',422)
      const allowedModes=['minimal','body_single','body_multiple','header_text','url','copy_code','media']
      if(!allowedModes.includes(contractMode))return fail('INVALID_CONTRACT_MODE','Modo de homologação inválido.',422)
      const authorizedPhone=brazilianPhone(Deno.env.get('WHATSAPP_TEMPLATE_TEST_PHONE'))
      const authorizedTemplate=text(Deno.env.get('WHATSAPP_TEMPLATE_TEST_NAME'),100)
      if(!authorizedPhone||!authorizedTemplate)return fail('TEMPLATE_SEND_HOMOLOGATION_NOT_CONFIGURED','A homologação de templates ainda não possui alvo autorizado.',503)
      if(recipient!==authorizedPhone)return fail('TEMPLATE_TEST_PHONE_FORBIDDEN','Este destinatário não está autorizado para homologação.',403)
      if(templateName!==authorizedTemplate)return fail('TEMPLATE_TEST_NAME_FORBIDDEN','Este modelo ainda não está autorizado para teste.',403)
      if(!validateTemplateComponents(components)&&Array.isArray(components)&&components.length)return fail('TEMPLATE_PARAMETERS_INVALID','Preencha todas as variáveis obrigatórias do template.',422)
      const wabaId=text(Deno.env.get('WABA_ID'),80)
      const stored=await client.from('whatsapp_message_templates').select('meta_template_id,name,language,status,components,is_active').eq('organization_id',profile.organization_id).eq('waba_id',wabaId).eq('name',templateName).eq('language',language).eq('status','APPROVED').eq('is_active',true).maybeSingle()
      if(stored.error||!stored.data)return fail('TEMPLATE_NOT_APPROVED','Este template não está aprovado e ativo para esta organização.',409)
      if(!templateInputsComplete(stored.data,Array.isArray(components)?components:[]))return fail('TEMPLATE_PARAMETERS_MISSING','Preencha todas as variáveis obrigatórias do template.',422)
      genericTemplateClientId=text(payload.client_id,80)
      if(genericTemplateClientId){
        const linkedClient=await client.from('clients').select('id,phone,billing_contact_phone').eq('id',genericTemplateClientId).eq('organization_id',profile.organization_id).maybeSingle()
        if(linkedClient.error||!linkedClient.data)return fail('CLIENT_NOT_FOUND','O contato selecionado não pertence à organização.',404)
        const phones=[linkedClient.data.phone,linkedClient.data.billing_contact_phone].map(brazilianPhone).filter(Boolean)
        if(!phones.includes(recipient))return fail('PHONE_MISMATCH','O telefone não pertence ao contato selecionado.',403)
      }
      // ===== Transporte direto Meta Cloud API — o MugoZap não participa do envio =====
      // `contract_mode` era negociação com o MugoZap; para a Meta enviamos sempre os
      // componentes que o frontend montou (já validados acima). Fica só para auditoria.
      if(!serviceKey)return fail('SUPABASE_SERVICE_ROLE_KEY_MISSING','O histórico canônico não está configurado; nada foi enviado.',503)

      // Idempotência (mesmo contrato de send_manual_message): uma tentativa lógica por
      // idempotency_key.
      //  - já confirmada (provider_message_id) -> devolve o resultado anterior, não reenvia;
      //  - reserva em estado incerto ('queued': timeout/unconfirmed) -> bloqueia retry cego;
      //  - reserva 'failed' (a Meta recusou sem aceitar nada) -> nova tentativa é segura.
      const priorSend=await client.from('whatsapp_messages').select('provider_message_id,status,conversation_id')
        .eq('organization_id',profile.organization_id).eq('idempotency_key',idempotencyKey).maybeSingle()
      if(priorSend.error)return fail('WHATSAPP_HISTORY_UNAVAILABLE','Não foi possível validar a idempotência do envio.',503)
      if(priorSend.data?.provider_message_id)return json({ok:true,data:{already_sent:true,message_id:priorSend.data.provider_message_id,provider_message_id:priorSend.data.provider_message_id,status:priorSend.data.status||'accepted',conversation_id:priorSend.data.conversation_id,template_name:templateName,language,recipient}})
      if(priorSend.data&&priorSend.data.status!=='failed')return fail('SEND_OUTCOME_UNKNOWN','O resultado de um envio anterior com esta chave ainda não foi confirmado. O template não será reenviado automaticamente; verifique o histórico.',409)
      if(priorSend.data?.status==='failed')
        await createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}}).from('whatsapp_messages')
          .update({status:'queued',error_code:null,error_message:null,failed_at:null})
          .eq('organization_id',profile.organization_id).eq('idempotency_key',idempotencyKey).is('provider_message_id',null)

      const homologationConfig:any=metaConfig(true)
      if(homologationConfig.error)return homologationConfig.error
      const homologationComponents=metaTemplateComponents(components)
      const homologationMetaPayload=buildTemplateMetaPayload(recipient,templateName,language,homologationComponents)

      // 1) RESERVA canônica ANTES do envio (provider_message_id:null, status:'queued').
      //    Só envia se a reserva funcionar.
      let canonicalReservation:any
      try{
        canonicalReservation=await persistOutboundMessage({supabaseUrl,serviceKey,organizationId:profile.organization_id,recipient,providerMessageId:null,
          idempotencyKey,messageType:'template',templateName,templateLanguage:language,templateComponents:components,clientId:genericTemplateClientId,status:'queued'})
      }catch(error){
        return fail('CRM_AUDIT_FAILED','Não foi possível reservar o template no histórico canônico; nada foi enviado.',503,0,true,{code:text((error as any)?.code||(error as any)?.message,120)})
      }

      console.log(JSON.stringify({event:'template_send_homologation_request',request_id:requestId,template_name:templateName,language,contract_mode:contractMode,components:componentSummary(components),phone_masked:maskPhone(recipient),transport:'meta_cloud_api'}))
      auditOperation('edge_upstream_request',operation,{request_id:requestId,organization_id:profile.organization_id,endpoint_called:`https://graph.facebook.com/${homologationConfig.version}/${homologationConfig.phoneNumberId}/messages`,payload_sent:homologationMetaPayload})

      // 2) ENVIO — uma única chamada, sem retry.
      let homologationSend:any
      try{
        homologationSend=await sendMetaMessage(homologationConfig,homologationMetaPayload)
      }catch(error){
        // 5) Timeout depois do disparo: NÃO reenviar. A reserva 'queued' permanece; uma
        // nova tentativa com a mesma idempotency_key cai em SEND_OUTCOME_UNKNOWN.
        const timedOut=error instanceof DOMException&&error.name==='TimeoutError'
        return fail(
          timedOut?'META_TIMEOUT':'META_UNAVAILABLE',
          timedOut?'A Meta demorou para responder após o disparo. Verifique o histórico antes de tentar novamente; a mensagem não será reenviada automaticamente.':'Não foi possível enviar o template pela Meta.',
          timedOut?504:503,0,timedOut,
        )
      }
      console.log(JSON.stringify({event:'template_send_homologation_response',request_id:requestId,template_name:templateName,language,contract_mode:contractMode,phone_masked:maskPhone(recipient),status_http:homologationSend.response.status,result:metaSendSummary(homologationSend.body)}))
      auditOperation('upstream_received',operation,{request_id:requestId,organization_id:profile.organization_id,status_http:homologationSend.response.status,body_received:homologationSend.body})

      // 6) Erro HTTP confirmado da Meta: marca a reserva como failed (não fica queued eternamente).
      if(!homologationSend.response.ok){
        const homologationMetaError=sanitizedMetaError(homologationSend.body)
        await createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}}).from('whatsapp_messages')
          .update({status:'failed',error_code:homologationMetaError.code?`META_${homologationMetaError.code}`:'META_API_ERROR',error_message:text(homologationMetaError.message,500)||'A Meta recusou o envio do template.',failed_at:new Date().toISOString()})
          .eq('organization_id',profile.organization_id).eq('idempotency_key',idempotencyKey).is('provider_message_id',null)
        return metaFailure(homologationSend.response.status,homologationSend.body,requestId)
      }

      // 8) Sucesso HTTP sem messages[0].id: mantém 'queued'/unconfirmed, não confirma, sem retry cego.
      const homologationMessageId=text(homologationSend.body?.messages?.[0]?.id,200)
      if(!homologationMessageId)return fail('MESSAGE_SEND_UNCONFIRMED','A Meta não confirmou o envio (sem identificador de mensagem). Verifique o histórico antes de tentar novamente.',502)

      // 7) Sucesso confirmado pela Meta. A partir daqui NUNCA se chama sendMetaMessage de
      //    novo. Atualiza diretamente a MESMA linha reservada por connection_id +
      //    idempotency_key. Só essa gravação no banco pode ter retry.
      let canonical:any=null,persistError:any=null
      const acceptedAt=new Date().toISOString()
      const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}})
      for(let attempt=0;attempt<3;attempt++){
        try{
          const finalized=await admin.from('whatsapp_messages').update({provider_message_id:homologationMessageId,status:'accepted',sent_at:acceptedAt,error_code:null,error_message:null,failed_at:null})
            .eq('organization_id',profile.organization_id).eq('connection_id',canonicalReservation.connection_id)
            .eq('idempotency_key',idempotencyKey).is('provider_message_id',null)
            .select('id,provider_message_id,status,sent_at').single()
          if(finalized.error||!finalized.data)throw finalized.error||new Error('RESERVED_MESSAGE_NOT_FOUND')
          canonical={...canonicalReservation,message:finalized.data}
          persistError=null
          break
        }catch(error){persistError=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)))}
      }
      if(persistError){
        // A Meta ACEITOU (temos messages[0].id) mas a gravação canônica não fechou.
        // Este não é um erro de reserva pré-envio. Preserva o provider_message_id nos
        // detalhes para reconciliação e devolve um erro
        // de estado de persistência — o frontend NÃO deve reenviar.
        console.log(JSON.stringify({event:'whatsapp_history_write_failed',request_id:requestId,operation,provider_message_id:homologationMessageId,error_code:text((persistError as any)?.code||(persistError as any)?.message,120)}))
        return fail('MESSAGE_PERSISTENCE_UNCONFIRMED','O template foi ACEITO pela Meta, mas o registro canônico não pôde ser concluído. NÃO reenvie — verifique o histórico da conversa.',502,0,false,{provider_message_id:homologationMessageId})
      }
      if(genericTemplateClientId){
        const linkResult=await client.from('whatsapp_conversation_links').upsert({organization_id:profile.organization_id,client_id:genericTemplateClientId,wa_id:recipient,phone:recipient,conversation_id:String(canonical.conversation_id)},{onConflict:'organization_id,wa_id'})
        // vínculo é conveniência do CRM: se falhar, a mensagem canônica já está gravada.
        if(linkResult.error)console.log(JSON.stringify({event:'whatsapp_client_link_failed',request_id:requestId,operation,provider_message_id:homologationMessageId,error_code:text(linkResult.error?.code||linkResult.error?.message,120)}))
      }
      return json({ok:true,data:{message_id:homologationMessageId,provider_message_id:homologationMessageId,status:'accepted',conversation:canonical.conversation,message:canonical.message,template_name:templateName,language,recipient}})
    }
    const identifierOperations = ['list_messages','send_manual_message','assign_conversation','pause_automation','resume_automation','close_conversation','update_conversation']
    if (identifierOperations.includes(operation) && !identifier(payload.waId)) return fail('INVALID_CONVERSATION_ID', 'Identificador da conversa ausente.', 400)
    if(operation==='send_manual_message'){
      if(!text(payload.text,4000))return fail('INVALID_PAYLOAD','Digite uma mensagem antes de enviar.',422)
      if(!text(payload.idempotencyKey,120))return fail('IDEMPOTENCY_KEY_MISSING','Não foi possível identificar esta tentativa de envio.',422)
    }
    // Daqui em diante o transporte é o MugoZap. Templates (start_template_conversation /
    // send_template_message) e send_manual_message já retornaram acima via Meta Cloud API.
    if (!apiUrl || !panelKey) return fail('MUGOZAP_CONFIGURATION_MISSING', 'A integração com o MugoZap ainda não foi configurada.', 503)
    if (!/^https?:\/\//.test(apiUrl)) return fail('MUGOZAP_CONFIGURATION_INVALID', 'A URL interna do MugoZap é inválida.', 503)
    const path = route.path(payload)
    if (!path.startsWith('/api/') && path !== '/health') return fail('INVALID_OPERATION', 'Rota não autorizada.', 403)

    const timeoutMs = timeoutFor(operation)
    const startedAt = Date.now()
    const body = verifiedPayload || (route.body ? route.body(payload) : undefined)
    if (body && JSON.stringify(body).length > 8000) return fail('PAYLOAD_TOO_LARGE', 'Conteúdo acima do limite permitido.', 413)
    const mugoZapHeaders: Record<string,string> = { 'X-Panel-Key': panelKey, ...(body ? {'Content-Type':'application/json'} : {}) }
    if (workspaceId) mugoZapHeaders['X-Workspace-Id'] = workspaceId
    let response: Response | undefined
    auditOperation('edge_upstream_request',operation,{request_id:requestId,organization_id:profile.organization_id,endpoint_called:path,payload_sent:body||null})
    try {
      if(Date.now()<upstreamCircuitOpenUntil)return fail('UPSTREAM_CIRCUIT_OPEN','O MugoZap está se recuperando. Tente novamente em instantes.',503,0,true)
      const maxRetries=route.method==='GET'?2:0
      let lastError:any
      for(let attempt=0;attempt<=maxRetries;attempt++){
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs)
        try{
          response=await fetch(`${apiUrl}${path}`, { method: route.method, signal: controller.signal, headers: mugoZapHeaders, body: body ? JSON.stringify(body) : undefined })
          if(response.ok||response.status<500||attempt===maxRetries)break
        }catch(error){lastError=error;if(attempt===maxRetries)throw error}
        finally{clearTimeout(timeout)}
        await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)))
      }
      if(!response)throw lastError||new Error('UPSTREAM_NO_RESPONSE')
      if(response.ok)upstreamFailureCount=0
      else if(response.status>=500)upstreamFailureCount+=1
      if(upstreamFailureCount>=5){upstreamCircuitOpenUntil=Date.now()+30_000;upstreamFailureCount=0}
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      console.log(JSON.stringify({event:'mugozap_upstream',request_id:requestId,operation,user_id:user.id,organization_id:profile.organization_id,method:route.method,upstream_path:path,duration_ms:durationMs,upstream_status:0,timeout_ms:timeoutMs,success:false}))
      if (timedOut) return fail(operation === 'health' ? 'UPSTREAM_COLD_START' : 'UPSTREAM_TIMEOUT', operation === 'health' ? 'O serviço está inicializando. Tente novamente em alguns segundos.' : 'O MugoZap demorou para responder.', 504, 0, true)
      return fail('UPSTREAM_UNAVAILABLE', 'O MugoZap está temporariamente indisponível.', 503, 0, true)
    }
    const responseBody = await response.json().catch(() => null)
    auditOperation('upstream_received',operation,{request_id:requestId,organization_id:profile.organization_id,endpoint_called:path,status_http:response.status,body_received:responseBody})
    console.log(JSON.stringify({event:'mugozap_upstream',request_id:requestId,operation,user_id:user.id,organization_id:profile.organization_id,method:route.method,upstream_path:path,duration_ms:Date.now()-startedAt,upstream_status:response.status,timeout_ms:timeoutMs,success:response.ok}))
    if (!response.ok) {
      const detail = String(responseBody?.detail || '')
      if (detail === 'Template pending approval') return fail('TEMPLATE_PENDING', 'O template ainda está em aprovação na Meta.', 409, response.status)
      if (detail === 'Template unavailable') return fail('TEMPLATE_NOT_CONFIGURED', 'O template ainda não está disponível na Meta.', 404, response.status)
      if (/template rejected/i.test(detail)) return fail('TEMPLATE_REJECTED', 'O template foi rejeitado pela Meta.', 409, response.status)
      if (/template paused/i.test(detail)) return fail('TEMPLATE_PAUSED', 'O template está pausado na Meta.', 409, response.status)
      if (operation === 'send_manual_message') return fail('MESSAGE_SEND_FAILED', 'Não foi possível enviar a mensagem.', response.status, response.status, response.status >= 500)
      const [code,message,retryable] = upstreamFailure(response.status)
      return fail(code, message, response.status, response.status, retryable)
    }
    // start_template_conversation e send_template_message não chegam aqui: retornam
    // acima após o envio direto pela Meta Cloud API. O transporte via MugoZap
    // (endpoint de start-template) foi removido dessas duas operações.
    if(['pause_automation','resume_automation','close_conversation','update_conversation'].includes(operation)&&serviceKey){
      const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}})
      const waId=identifier(payload.waId)
      const found=await admin.from('whatsapp_conversations').select('id,connection_id')
        .eq('organization_id',profile.organization_id).eq('wa_id',waId).maybeSingle()
      if(found.data){
        const requested=payload.changes||{}
        const patch=operation==='pause_automation'
          ?{attendance_mode:'human',automation_paused:true,handoff_reason:'manual_handoff'}
          :operation==='resume_automation'
            ?{attendance_mode:'bot',automation_paused:false,handoff_reason:null}
            :operation==='close_conversation'
              ?{status:'closed'}
              :{
                ...(['open','pending','resolved','closed'].includes(text(requested.status,30))?{status:text(requested.status,30)}:{}),
                ...(['bot','human','paused'].includes(text(requested.attendance_mode,30))?{attendance_mode:text(requested.attendance_mode,30)}:{}),
                ...(typeof requested.automation_paused==='boolean'?{automation_paused:requested.automation_paused}:{}),
              }
        const mirrored=await admin.from('whatsapp_conversations').update(patch).eq('id',found.data.id)
        const event=await admin.from('whatsapp_conversation_events').insert({organization_id:profile.organization_id,
          connection_id:found.data.connection_id,conversation_id:found.data.id,event_type:operation,actor_id:user.id,details:{source:'crm'}})
        if(mirrored.error||event.error)return fail('CRM_AUDIT_FAILED','O estado foi alterado no provedor, mas não pôde ser espelhado no CRM.',502)
      }
    }
    if(operation==='send_manual_message'){
      const providerMessageId=text(responseBody?.provider_message_id||responseBody?.message_id||responseBody?.messages?.[0]?.id,200)
      if(!providerMessageId)return fail('MESSAGE_SEND_UNCONFIRMED','O provedor não confirmou o envio. Verifique o histórico antes de tentar novamente.',502)
      try{
        const canonical=await persistOutboundMessage({supabaseUrl,serviceKey,organizationId:profile.organization_id,recipient:identifier(payload.waId),providerMessageId,
          idempotencyKey:text(payload.idempotencyKey,120),messageType:'text',textContent:text(payload.text,4000)})
        return json({ok:true,data:{provider_message_id:providerMessageId,message_id:providerMessageId,status:'accepted',conversation:canonical.conversation,message:canonical.message}})
      }catch(error){
        console.log(JSON.stringify({event:'whatsapp_history_write_failed',request_id:requestId,operation,error_code:text((error as any)?.code||(error as any)?.message,120)}))
        return fail('CRM_AUDIT_FAILED','A mensagem foi enviada, mas o histórico canônico não pôde ser registrado. Não repita o envio.',502)
      }
    }
    auditOperation('edge_transformed',operation,{request_id:requestId,organization_id:profile.organization_id,body_transformed:responseBody})
    auditOperation('edge_frontend_response',operation,{request_id:requestId,organization_id:profile.organization_id,status_http:200,body_returned_to_frontend:responseBody})
    return json({ ok: true, data: responseBody })
  } catch (error) {
    const name=text((error as any)?.name,80)
    const message=text((error as any)?.message,300)
    const isNetwork=/TypeError|Timeout|Abort|fetch/i.test(`${name} ${message}`)
    console.log(JSON.stringify({event:'mugozap_unhandled_error',request_id:requestId,duration_ms:Date.now()-requestStartedAt,error_name:name,error_message:message}))
    return fail(
      isNetwork?'UPSTREAM_UNAVAILABLE':'INTERNAL_ERROR',
      isNetwork?'Não foi possível concluir a operação: um serviço externo (Meta ou MugoZap) não respondeu.':'A integração com o WhatsApp encontrou um erro inesperado.',
      isNetwork?503:500,
      0,
      isNetwork,
      {name,message},
    )
  }
}

Deno.serve(async request => {
  const requestId=crypto.randomUUID()
  const startedAt=Date.now()
  const response=await handleRequest(request,requestId)
  const responseText=await response.text()
  let responseBody:any=responseText
  const durationMs=Date.now()-startedAt
  try{
    responseBody=JSON.parse(responseText)
    if(responseBody?.ok===false)responseBody={...responseBody,request_id:requestId,duration_ms:durationMs,details:responseBody.details||{},provider_message:responseBody.provider_message??null,context:{...(responseBody.context||{}),request_id:requestId}}
    else if(responseBody?.ok===true)responseBody={code:'OK',message:'Operação concluída.',...responseBody,request_id:requestId,duration_ms:durationMs}
  }catch{/* resposta não JSON, como preflight */}
  const headers=new Headers(response.headers)
  headers.set('X-Request-Id',requestId)
  console.log(JSON.stringify({event:'mugozap_complete',request_id:requestId,status:response.status,duration_ms:durationMs,result:response.ok?'success':'error',error_code:responseBody?.code||null}))
  return new Response(typeof responseBody==='string'?responseBody:JSON.stringify(responseBody),{status:response.status,headers})
})
