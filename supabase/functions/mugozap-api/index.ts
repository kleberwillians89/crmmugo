import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-workspace-id','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
const fail = (code: string, message: string, status = 400, upstreamStatus = 0, retryable = false) => json({ ok: false, code, message, status, upstream_status: upstreamStatus, retryable }, status)
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)
const identifier = (value: unknown) => {
  const normalized = text(value, 40).replace(/\D/g, '')
  return /^\d{10,15}$/.test(normalized) ? normalized : ''
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
  get_template_status: { method: 'GET', path: p => {
    const allowed=['mugo_alerta_pagamento_pendente','mugo_pagamento_confirmado','mugo_solicitar_comprovante','mugo_aviso_renovacao_contrato','mugo_agendamento_confirmado','mugo_boas_vindas_diagnostico_v1','hello_world']
    const name=text(p.template_name,100)
    if(!allowed.includes(name))throw new Error('TEMPLATE_NOT_ALLOWED')
    return `/api/templates/${encodeURIComponent(name)}?language=pt_BR`
  } },
  get_usage: { method: 'GET', path: p => `/api/whatsapp/usage?days=${Math.min(Math.max(Number(p.days)||30,1),366)}` },
}

const timeoutFor = (operation: string) => {
  if (['health','get_template_status','find_conversation_by_phone','get_usage','get_attendance_meta','get_dashboard_summary'].includes(operation)) return 8_000
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

Deno.serve(async request => {
  const requestStartedAt = Date.now()
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Método não permitido.', 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) {
      console.log(JSON.stringify({event:'mugozap_auth',operation:null,authenticated:false,hasProfile:false,hasOrganization:false,status:403,duration_ms:Date.now()-requestStartedAt}))
      return fail('AUTH_SESSION_MISSING', 'Sua sessão expirou. Entre novamente no CRM.', 403)
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const apiUrl = text(Deno.env.get('MUGOZAP_API_URL'), 500).replace(/\/$/, '')
    const panelKey = Deno.env.get('PANEL_API_KEY')
    const workspaceId = text(request.headers.get('X-Workspace-Id'), 120)
    if (!supabaseUrl || !anonKey || !apiUrl || !panelKey) return fail('INTERNAL_ERROR', 'A integração com o MugoZap ainda não foi configurada.', 503)
    if (!/^https?:\/\//.test(apiUrl)) return fail('INTERNAL_ERROR', 'A URL interna do MugoZap é inválida.', 503)

    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) {
      console.log(JSON.stringify({event:'mugozap_auth',operation:null,authenticated:false,hasProfile:false,hasOrganization:false,status:403,duration_ms:Date.now()-requestStartedAt}))
      return fail('AUTH_INVALID_TOKEN', 'Sua sessão expirou. Entre novamente no CRM.', 403)
    }
    const authorizedWorkspace = text(user.app_metadata?.workspace_id || (user as any).workspace_id, 120)
    if (workspaceId && (!authorizedWorkspace || workspaceId !== authorizedWorkspace)) return fail('FORBIDDEN', 'Seu usuário não possui acesso a este workspace.', 403)
    const { data: profile } = await client.from('profiles').select('organization_id,role,active').eq('id', user.id).single()
    if (!profile) {
      console.log(JSON.stringify({event:'mugozap_auth',operation:null,authenticated:true,hasProfile:false,hasOrganization:false,status:403,duration_ms:Date.now()-requestStartedAt}))
      return fail('PROFILE_NOT_FOUND', 'Perfil do usuário não encontrado.', 403)
    }
    if (!profile.organization_id) return fail('ORGANIZATION_NOT_FOUND', 'Organização do usuário não encontrada.', 403)
    if (!profile.active) return fail('FORBIDDEN', 'Seu usuário não possui acesso ativo.', 403)

    const incoming = await request.json().catch(() => null)
    if (!incoming || JSON.stringify(incoming).length > 12000) return fail('INVALID_PAYLOAD', 'Payload inválido ou acima do limite.', 413)
    const operation = text(incoming.operation, 60), route = routes[operation]
    console.log(JSON.stringify({event:'mugozap_auth',operation,authenticated:true,hasProfile:true,hasOrganization:true,status:200,duration_ms:Date.now()-requestStartedAt}))
    if (!route) return fail('INVALID_OPERATION', 'Operação não autorizada.', 400)
    if (route.write && !['admin','manager'].includes(profile.role)) return fail('FORBIDDEN', 'Seu perfil não pode alterar conversas.', 403)
    if (route.admin && profile.role !== 'admin') return fail('FORBIDDEN', 'Somente administradores podem consultar usuários do WhatsApp.', 403)
    const payload = incoming.payload || {}
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
      const normalizedPhone = text(payload.phone, 40).replace(/\D/g,'')
      const storedPhones = [clientRow.phone,clientRow.billing_contact_phone].map((value:string)=>String(value||'').replace(/\D/g,'')).filter(Boolean)
      if (!/^55[1-9]{2}9?\d{8}$/.test(normalizedPhone) || !storedPhones.includes(normalizedPhone)) return fail('PHONE_MISMATCH', 'O telefone não pertence ao cliente informado.', 403)
      const safeName = text(clientRow.contact_name || clientRow.trade_name || clientRow.company_name, 120).split(/\s+/)[0] || 'Cliente'
      verifiedPayload = {wa_id:normalizedPhone,template_name:templateName,language,parameters:[safeName],source:'collection',client_id:clientRow.id,installment_id:installment.id}
      const reservation = await client.from('whatsapp_collection_alerts').insert({organization_id:profile.organization_id,client_id:clientRow.id,installment_id:installment.id,contract_id:installment.contract_id,wa_id:normalizedPhone,template_name:templateName,template_status:'CHECKING',collection_stage:'sending',action:'template_send_requested',status:'sending',sent_by:user.id}).select('id').single()
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
      console.log(JSON.stringify({event:'mugozap_upstream',operation,method:route.method,upstream_path:path,duration_ms:durationMs,upstream_status:0,timeout_ms:timeoutMs,success:false}))
      if (timedOut) return fail(operation === 'health' ? 'UPSTREAM_COLD_START' : 'UPSTREAM_TIMEOUT', operation === 'health' ? 'O serviço está inicializando. Tente novamente em alguns segundos.' : 'O MugoZap demorou para responder.', 504, 0, true)
      return fail('UPSTREAM_UNAVAILABLE', 'O MugoZap está temporariamente indisponível.', 503, 0, true)
    } finally {
      clearTimeout(timeout)
    }
    const responseBody = await response.json().catch(() => null)
    console.log(JSON.stringify({event:'mugozap_upstream',operation,method:route.method,upstream_path:path,duration_ms:Date.now()-startedAt,upstream_status:response.status,timeout_ms:timeoutMs,success:response.ok}))
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
      const sent:any = responseBody || {}, conversation = sent.conversation || {}, normalizedPhone = text(payload.phone,40).replace(/\D/g,'')
      const linkResult = await client.from('whatsapp_conversation_links').upsert({organization_id:profile.organization_id,client_id:payload.client_id,wa_id:String(conversation.wa_id||normalizedPhone),phone:normalizedPhone,conversation_id:String(conversation.id||conversation.wa_id||normalizedPhone)},{onConflict:'organization_id,client_id'})
      const alertResult = await client.from('whatsapp_collection_alerts').update({wa_id:String(conversation.wa_id||normalizedPhone),provider_message_id:sent.provider_message_id||null,template_status:'APPROVED',collection_stage:'waiting_customer',action:'template_sent',status:'sent',sent_at:new Date().toISOString(),error_code:null,error_message:null}).eq('id',alertReservationId)
      await client.from('commercial_events').insert({organization_id:profile.organization_id,client_id:payload.client_id,installment_id:payload.installment_id,event_type:'whatsapp_collection_alert_sent',title:'Alerta de cobrança enviado pelo WhatsApp',new_value:{wa_id:String(conversation.wa_id||normalizedPhone),template_name:'mugo_alerta_pagamento_pendente',provider_message_id:sent.provider_message_id||null},created_by:user.id})
      if (linkResult.error || alertResult.error) return fail('CRM_AUDIT_FAILED', 'O alerta foi enviado, mas o vínculo não pôde ser registrado. Não repita o envio.', 502)
    }
    return json({ ok: true, data: responseBody })
  } catch (error) {
    return fail('INTERNAL_ERROR', 'A integração com o WhatsApp está temporariamente indisponível.', 500)
  }
})
