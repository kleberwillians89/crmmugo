import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-workspace-id','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
const fail = (code: string, message: string, status = 400, upstreamStatus = 0, retryable = false, details: Record<string,unknown> = {}) => json({ ok: false, code, message, status, upstream_status: upstreamStatus, retryable, details }, status)
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
const templateVariables = (component: any) => {
  const content = text(component?.text, 8000)
  const positional = [...content.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1]))
  return positional.length ? Math.max(...positional) : 0
}
const sanitizedMetaError = (body: any) => ({
  code: Number(body?.error?.code || 0),
  error_subcode: Number(body?.error?.error_subcode || 0),
  message: text(body?.error?.message, 500),
  details: text(body?.error?.error_data?.details, 500),
  fbtrace_id: text(body?.error?.fbtrace_id, 120),
})
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
const fetchMeta = async (url: string, accessToken: string) => {
  const response = await fetch(url, {headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(8_000)})
  const body = await response.json().catch(() => null)
  return {response,body}
}
const fetchTemplates = async (config: any) => {
  const fields = 'id,name,language,status,category,components,quality_score,rejected_reason,previous_category,parameter_format'
  let url = `https://graph.facebook.com/${config.version}/${config.wabaId}/message_templates?fields=${encodeURIComponent(fields)}&limit=100`
  const templates:any[] = []
  let page=0
  for (; url && page<100; page++) {
    let meta:any
    try{meta=await fetchMeta(url,config.accessToken)}
    catch(error){
      const timedOut=error instanceof DOMException&&error.name==='TimeoutError'
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
  list_conversations: { method: 'GET', path: () => '/api/conversations' },
  find_conversation_by_phone: { method: 'GET', path: p => `/api/conversations/by-phone/${encodeURIComponent(text(p.phone, 40))}` },
  list_messages: { method: 'GET', path: p => `/api/messages?wa_id=${encodeURIComponent(text(p.waId, 40))}&limit=${Math.min(Math.max(Number(p.limit) || 80, 1), 200)}` },
  send_manual_message: { method: 'POST', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}/send`, body: p => ({ text: text(p.text, 4000) }), write: true },
  assign_conversation: { method: 'PATCH', path: p => `/api/attendance/conversations/${encodeURIComponent(text(p.waId, 40))}/assign`, body: p => ({ assigned_to: text(p.assignedTo, 120) }), write: true },
  pause_automation: { method: 'PATCH', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}`, body: () => ({ attendance_mode:'human', automation_paused:true, bot_enabled:false }), write: true },
  resume_automation: { method: 'POST', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}/handoff/close`, write: true },
  close_conversation: { method: 'PATCH', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}`, body: () => ({ status:'closed' }), write: true },
  get_attendance_meta: { method: 'GET', path: () => '/api/attendance/meta' },
  list_users: { method: 'GET', path: () => '/api/users', admin: true },
  get_dashboard_summary: { method: 'GET', path: () => '/api/dashboard/summary' },
  start_template_conversation: { method: 'POST', path: () => '/api/conversations/start-template', write: true },
  list_templates: { method: 'GET', path: () => '/meta/templates/local' },
  sync_templates: { method: 'GET', path: () => '/meta/templates', write: true },
  get_template_status: { method: 'GET', path: p => {
    const allowed=['mugo_alerta_pagamento_pendente','mugo_pagamento_confirmado','mugo_solicitar_comprovante','mugo_aviso_renovacao_contrato','mugo_agendamento_confirmado','mugo_boas_vindas_diagnostico_v1','hello_world']
    const name=text(p.template_name,100)
    if(!allowed.includes(name))throw new Error('TEMPLATE_NOT_ALLOWED')
    return `/api/templates/${encodeURIComponent(name)}?language=pt_BR`
  } },
  get_usage: { method: 'GET', path: p => `/api/whatsapp/usage?days=${Math.min(Math.max(Number(p.days)||30,1),366)}` },
}

const timeoutFor = (operation: string) => {
  if (['health','list_templates','sync_templates','get_template_status','find_conversation_by_phone','get_usage','get_attendance_meta','get_dashboard_summary'].includes(operation)) return 8_000
  if (['list_conversations','list_messages','list_users'].includes(operation)) return 15_000
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
    const operation = text(incoming.operation, 60), route = routes[operation]
    console.log(JSON.stringify({event:'mugozap_request',request_id:requestId,operation,user_id:user.id,organization_id:profile.organization_id,role:profile.role,authenticated:true,status:200,duration_ms:Date.now()-requestStartedAt}))
    if (!route) return fail('INVALID_OPERATION', 'Operação não autorizada.', 400)
    if (route.write && !['admin','manager'].includes(profile.role)) return fail('FORBIDDEN', operation==='sync_templates'?'Seu perfil não pode sincronizar templates.':'Seu perfil não pode alterar conversas.', 403)
    if (route.admin && profile.role !== 'admin') return fail('FORBIDDEN', 'Somente administradores podem consultar usuários do WhatsApp.', 403)
    const payload = incoming.payload || {}
    if (operation === 'list_templates') {
      const wabaId=text(Deno.env.get('WABA_ID'),80)
      if(!wabaId||!/^\d+$/.test(wabaId))return fail('WABA_ID_INVALID','O WABA ID não foi configurado corretamente no backend.',503)
      const local=await client.from('whatsapp_message_templates').select('*').eq('organization_id',profile.organization_id).eq('waba_id',wabaId).order('name')
      if(local.error)return fail('TEMPLATE_STORAGE_READ_FAILED','Não foi possível ler os templates salvos.',500)
      const templates=(local.data||[]).map((item:any)=>({...item,id:item.meta_template_id||item.id,quality:item.quality_score,lastSyncedAt:item.last_synced_at}))
      return json({ok:true,data:{templates,last_sync:templates.reduce((latest:any,item:any)=>!latest||String(item.last_synced_at)>latest?item.last_synced_at:latest,null),source:'supabase'}})
    }
    if (operation === 'sync_templates' || operation === 'get_template_status') {
      const config:any=metaConfig(false)
      if(config.error)return config.error
      config.requestId=requestId
      const result:any=await fetchTemplates(config)
      if(result.error)return result.error
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
      return json({ok:true,data:{templates:result.templates.map((item:any)=>({...item,waba_id:config.wabaId,is_active:true,last_synced_at:now})),last_sync:now,pages:result.pages,deactivated:absentIds.length,source:'meta'}})
    }
    if (!apiUrl || !panelKey) return fail('MUGOZAP_CONFIGURATION_MISSING', 'A integração com o MugoZap ainda não foi configurada.', 503)
    if (!/^https?:\/\//.test(apiUrl)) return fail('MUGOZAP_CONFIGURATION_INVALID', 'A URL interna do MugoZap é inválida.', 503)
    let alertReservationId = ''
    let verifiedPayload: unknown = undefined
    if (operation === 'start_template_conversation') {
      const clientId = text(payload.client_id, 80), installmentId = text(payload.installment_id, 80)
      const templateName = text(payload.template_name, 100), language = text(payload.language, 20)
      if (!clientId || !installmentId || templateName !== 'mugo_alerta_pagamento_pendente' || language !== 'pt_BR') return fail('INVALID_TEMPLATE_REQUEST', 'Os dados para iniciar a conversa são inválidos.', 400)
      const [clientResult, installmentResult, duplicateResult] = await Promise.all([
        client.from('clients').select('id,organization_id,company_name,trade_name,contact_name,phone,billing_contact_phone').eq('id',clientId).eq('organization_id',profile.organization_id).single(),
        client.from('invoice_installments').select('id,organization_id,client_id,contract_id,status,due_date,amount').eq('id',installmentId).eq('organization_id',profile.organization_id).single(),
        client.from('whatsapp_collection_alerts').select('id,status').eq('organization_id',profile.organization_id).eq('installment_id',installmentId).eq('template_name',templateName).maybeSingle(),
      ])
      if (clientResult.error || !clientResult.data || installmentResult.error || !installmentResult.data) return fail('COLLECTION_NOT_FOUND', 'Cliente ou parcela não encontrado.', 404)
      const clientRow:any = clientResult.data, installment:any = installmentResult.data
      if (installment.client_id !== clientRow.id) return fail('CLIENT_MISMATCH', 'A parcela não pertence ao cliente informado.', 403)
      if (installment.status === 'paid') return fail('INSTALLMENT_PAID', 'Esta parcela já foi paga e não pode ser cobrada.', 409)
      if (duplicateResult.data && duplicateResult.data.status !== 'failed') return fail('COLLECTION_DUPLICATE', 'Um alerta desta cobrança já foi enviado.', 409)
      if (duplicateResult.data?.status === 'failed') await client.from('whatsapp_collection_alerts').delete().eq('id',duplicateResult.data.id)
      const normalizedPhone = brazilianPhone(payload.phone)
      const storedPhones = [clientRow.phone,clientRow.billing_contact_phone].map(brazilianPhone).filter(Boolean)
      if (!normalizedPhone) return fail('INVALID_PHONE', 'Informe um número de WhatsApp válido com DDD.', 422)
      if (!storedPhones.includes(normalizedPhone)) return fail('PHONE_MISMATCH', 'O telefone não pertence ao cliente informado.', 403)
      const safeName = text(clientRow.contact_name || clientRow.trade_name || clientRow.company_name, 120).split(/\s+/)[0] || 'Cliente'
      const config:any=metaConfig(true)
      if(config.error)return config.error
      config.requestId=requestId
      const phoneCheck=await fetchMeta(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}?fields=id,account_mode`,config.accessToken)
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
      const reservation = await client.from('whatsapp_collection_alerts').insert({organization_id:profile.organization_id,client_id:clientRow.id,installment_id:installment.id,contract_id:installment.contract_id,wa_id:normalizedPhone,recipient:normalizedPhone,company_name:text(clientRow.company_name,200),meta_template_id:officialTemplate.id,template_name:templateName,template_language:language,template_status:'CHECKING',collection_stage:'sending',action:'template_send_requested',status:'sending',sent_by:user.id,origin:'collection',currency:'BRL',sanitized_payload:{to:normalizedPhone,template:{name:templateName,language,parameter_count:requiredBodyParameters,has_coupon:Boolean(couponCode)},source:'collection'}}).select('id').single()
      if (reservation.error) return fail('COLLECTION_DUPLICATE', 'Um alerta desta cobrança já foi enviado.', 409)
      alertReservationId = reservation.data.id
    }
    const identifierOperations = ['list_messages','send_manual_message','assign_conversation','pause_automation','resume_automation','close_conversation']
    if (identifierOperations.includes(operation) && !identifier(payload.waId)) return fail('INVALID_CONVERSATION_ID', 'Identificador da conversa ausente.', 400)
    const path = route.path(payload)
    if (!path.startsWith('/api/') && path !== '/health') return fail('INVALID_OPERATION', 'Rota não autorizada.', 403)

    const timeoutMs = timeoutFor(operation)
    const startedAt = Date.now()
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs)
    const body = verifiedPayload || (route.body ? route.body(payload) : undefined)
    if (body && JSON.stringify(body).length > 8000) return fail('PAYLOAD_TOO_LARGE', 'Conteúdo acima do limite permitido.', 413)
    const mugoZapHeaders: Record<string,string> = { 'X-Panel-Key': panelKey, ...(body ? {'Content-Type':'application/json'} : {}) }
    if (workspaceId) mugoZapHeaders['X-Workspace-Id'] = workspaceId
    let response: Response
    try {
      response = await fetch(`${apiUrl}${path}`, { method: route.method, signal: controller.signal, headers: mugoZapHeaders, body: body ? JSON.stringify(body) : undefined })
    } catch (error) {
      if (alertReservationId) await client.from('whatsapp_collection_alerts').update({status:'failed',collection_stage:'failed',action:'template_send_failed',error_code:'MUGOZAP_REQUEST_FAILED',error_message:'Serviço do WhatsApp indisponível.'}).eq('id',alertReservationId)
      const durationMs = Date.now() - startedAt
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      console.log(JSON.stringify({event:'mugozap_upstream',request_id:requestId,operation,user_id:user.id,organization_id:profile.organization_id,method:route.method,upstream_path:path,duration_ms:durationMs,upstream_status:0,timeout_ms:timeoutMs,success:false}))
      if (timedOut) return fail(operation === 'health' ? 'UPSTREAM_COLD_START' : 'UPSTREAM_TIMEOUT', operation === 'health' ? 'O serviço está inicializando. Tente novamente em alguns segundos.' : 'O MugoZap demorou para responder.', 504, 0, true)
      return fail('UPSTREAM_UNAVAILABLE', 'O MugoZap está temporariamente indisponível.', 503, 0, true)
    } finally {
      clearTimeout(timeout)
    }
    const responseBody = await response.json().catch(() => null)
    console.log(JSON.stringify({event:'mugozap_upstream',request_id:requestId,operation,user_id:user.id,organization_id:profile.organization_id,method:route.method,upstream_path:path,duration_ms:Date.now()-startedAt,upstream_status:response.status,timeout_ms:timeoutMs,success:response.ok}))
    if (!response.ok) {
      if (alertReservationId) await client.from('whatsapp_collection_alerts').update({status:'failed',collection_stage:'failed',action:'template_send_failed',error_code:`MUGOZAP_${response.status}`,error_message:'O MugoZap não conseguiu concluir o envio.'}).eq('id',alertReservationId)
      const detail = String(responseBody?.detail || '')
      if (detail === 'Template pending approval') return fail('TEMPLATE_PENDING', 'O template ainda está em aprovação na Meta.', 409, response.status)
      if (detail === 'Template unavailable') return fail('TEMPLATE_NOT_CONFIGURED', 'O template ainda não está disponível na Meta.', 404, response.status)
      if (/template rejected/i.test(detail)) return fail('TEMPLATE_REJECTED', 'O template foi rejeitado pela Meta.', 409, response.status)
      if (/template paused/i.test(detail)) return fail('TEMPLATE_PAUSED', 'O template está pausado na Meta.', 409, response.status)
      if (operation === 'send_manual_message') return fail('MESSAGE_SEND_FAILED', 'Não foi possível enviar a mensagem.', response.status, response.status, response.status >= 500)
      const [code,message,retryable] = upstreamFailure(response.status)
      return fail(code, message, response.status, response.status, retryable)
    }
    if (operation === 'start_template_conversation') {
      const sent:any = responseBody || {}, conversation = sent.conversation || {}, normalizedPhone = brazilianPhone(payload.phone)
      const providerMessageId=text(sent.provider_message_id || sent.messages?.[0]?.id,200)
      if(!providerMessageId){
        await client.from('whatsapp_collection_alerts').update({status:'failed',collection_stage:'failed',action:'template_send_unconfirmed',error_code:'META_MESSAGE_ID_MISSING',error_message:'A resposta do provedor não confirmou o envio.'}).eq('id',alertReservationId)
        return fail('MESSAGE_SEND_UNCONFIRMED','A Meta não confirmou o envio. Verifique o histórico antes de tentar novamente.',502)
      }
      const linkResult = await client.from('whatsapp_conversation_links').upsert({organization_id:profile.organization_id,client_id:payload.client_id,wa_id:String(conversation.wa_id||normalizedPhone),phone:normalizedPhone,conversation_id:String(conversation.id||conversation.wa_id||normalizedPhone)},{onConflict:'organization_id,client_id'})
      const alertResult = await client.from('whatsapp_collection_alerts').update({wa_id:String(conversation.wa_id||normalizedPhone),provider_message_id:providerMessageId,template_status:'APPROVED',collection_stage:'waiting_customer',action:'template_sent',status:'sent',sent_at:new Date().toISOString(),raw_response:{provider_message_id:providerMessageId,conversation_id:text(conversation.id||conversation.wa_id,200)},error_code:null,error_message:null}).eq('id',alertReservationId)
      await client.from('commercial_events').insert({organization_id:profile.organization_id,client_id:payload.client_id,installment_id:payload.installment_id,event_type:'whatsapp_collection_alert_sent',title:'Alerta de cobrança enviado pelo WhatsApp',new_value:{wa_id:String(conversation.wa_id||normalizedPhone),template_name:'mugo_alerta_pagamento_pendente',provider_message_id:providerMessageId,language:'pt_BR',source:'collection'},created_by:user.id})
      if (linkResult.error || alertResult.error) return fail('CRM_AUDIT_FAILED', 'O alerta foi enviado, mas o vínculo não pôde ser registrado. Não repita o envio.', 502)
    }
    return json({ ok: true, data: responseBody })
  } catch (error) {
    console.log(JSON.stringify({event:'mugozap_unhandled_error',request_id:requestId,duration_ms:Date.now()-requestStartedAt,error_name:text((error as any)?.name,80)}))
    return fail('INTERNAL_ERROR', 'A integração com o WhatsApp está temporariamente indisponível.', 500)
  }
}

Deno.serve(async request => {
  const requestId=crypto.randomUUID()
  const startedAt=Date.now()
  const response=await handleRequest(request,requestId)
  const responseText=await response.text()
  let responseBody:any=responseText
  try{responseBody=JSON.parse(responseText);if(responseBody?.ok===false)responseBody={...responseBody,request_id:requestId,details:responseBody.details||{}}}catch{/* resposta não JSON, como preflight */}
  const headers=new Headers(response.headers)
  headers.set('X-Request-Id',requestId)
  console.log(JSON.stringify({event:'mugozap_complete',request_id:requestId,status:response.status,duration_ms:Date.now()-startedAt,result:response.ok?'success':'error',error_code:responseBody?.code||null}))
  return new Response(typeof responseBody==='string'?responseBody:JSON.stringify(responseBody),{status:response.status,headers})
})
