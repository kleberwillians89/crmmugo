import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-workspace-id','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
const fail = (code: string, message: string, status = 400) => json({ ok: false, code, message }, status)
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)

const routes: Record<string, { method: string, path: (payload: any) => string, body?: (payload: any) => unknown, write?: boolean, admin?: boolean }> = {
  list_conversations: { method: 'GET', path: () => '/api/conversations' },
  find_conversation_by_phone: { method: 'GET', path: p => `/api/conversations/by-phone/${encodeURIComponent(text(p.phone, 40))}` },
  list_messages: { method: 'GET', path: p => `/api/messages?wa_id=${encodeURIComponent(text(p.waId, 40))}&limit=${Math.min(Math.max(Number(p.limit) || 80, 1), 200)}` },
  send_manual_message: { method: 'POST', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}/send`, body: p => ({ text: text(p.text, 4000) }), write: true },
  update_conversation: { method: 'PATCH', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}`, body: p => {
    const allowed = ['name','status','stage','notes','tags','source','origem_lead','fila','attendance_mode','awaiting_human','automation_paused','bot_enabled']
    return Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(p.changes || {}, key)).map(key => [key, p.changes[key]]))
  }, write: true },
  assign_conversation: { method: 'PATCH', path: p => `/api/attendance/conversations/${encodeURIComponent(text(p.waId, 40))}/assign`, body: p => ({ assigned_to: text(p.assignedTo, 120) }), write: true },
  update_attendance_status: { method: 'PATCH', path: p => `/api/attendance/conversations/${encodeURIComponent(text(p.waId, 40))}/status`, body: p => ({ status: text(p.status, 80) }), write: true },
  close_handoff: { method: 'POST', path: p => `/api/conversations/${encodeURIComponent(text(p.waId, 40))}/handoff/close`, write: true },
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
  get_whatsapp_usage: { method: 'GET', path: p => `/api/whatsapp/usage?days=${Math.min(Math.max(Number(p.days)||30,1),366)}` },
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Método não permitido.', 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return fail('SESSION_REQUIRED', 'Sessão necessária.', 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const apiUrl = text(Deno.env.get('MUGOZAP_API_URL'), 500).replace(/\/$/, '')
    const panelKey = Deno.env.get('PANEL_API_KEY')
    const workspaceId = text(request.headers.get('X-Workspace-Id'), 120)
    if (!supabaseUrl || !anonKey || !apiUrl || !panelKey) return fail('SERVICE_NOT_CONFIGURED', 'A integração com o MugoZap ainda não foi configurada.', 503)
    if (!/^https?:\/\//.test(apiUrl)) return fail('INVALID_API_URL', 'A URL interna do MugoZap é inválida.', 503)

    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) return fail('SESSION_EXPIRED', 'Sua sessão expirou. Faça login novamente.', 401)
    const authorizedWorkspace = text(user.app_metadata?.workspace_id || (user as any).workspace_id, 120)
    if (workspaceId && (!authorizedWorkspace || workspaceId !== authorizedWorkspace)) return fail('WORKSPACE_NOT_ALLOWED', 'Seu usuário não possui acesso a este workspace.', 403)
    const { data: profile } = await client.from('profiles').select('organization_id,role,active').eq('id', user.id).single()
    if (!profile?.active || !profile.organization_id) return fail('PROFILE_NOT_ALLOWED', 'Seu usuário não possui acesso ativo.', 403)

    const incoming = await request.json().catch(() => null)
    if (!incoming || JSON.stringify(incoming).length > 12000) return fail('INVALID_PAYLOAD', 'Payload inválido ou acima do limite.', 413)
    const operation = text(incoming.operation, 60), route = routes[operation]
    if (!route) return fail('OPERATION_NOT_ALLOWED', 'Operação não autorizada.', 403)
    if (route.write && !['admin','manager'].includes(profile.role)) return fail('WRITE_NOT_ALLOWED', 'Seu perfil não pode alterar conversas.', 403)
    if (route.admin && profile.role !== 'admin') return fail('ADMIN_REQUIRED', 'Somente administradores podem consultar usuários do WhatsApp.', 403)
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
    const path = route.path(payload)
    if (!path.startsWith('/api/')) return fail('INVALID_ROUTE', 'Rota não autorizada.', 403)
    if (path.includes('undefined') || (operation !== 'get_attendance_meta' && operation !== 'list_conversations' && operation !== 'list_users' && operation !== 'get_dashboard_summary' && path.includes('wa_id=' + encodeURIComponent('')))) return fail('INVALID_IDENTIFIER', 'Identificador da conversa ausente.', 400)

    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000)
    const body = verifiedPayload || (route.body ? route.body(payload) : undefined)
    if (body && JSON.stringify(body).length > 8000) return fail('PAYLOAD_TOO_LARGE', 'Conteúdo acima do limite permitido.', 413)
    const mugoZapHeaders: Record<string,string> = { 'X-Panel-Key': panelKey, ...(body ? {'Content-Type':'application/json'} : {}) }
    if (workspaceId) mugoZapHeaders['X-Workspace-Id'] = workspaceId
    let response: Response
    try {
      response = await fetch(`${apiUrl}${path}`, { method: route.method, signal: controller.signal, headers: mugoZapHeaders, body: body ? JSON.stringify(body) : undefined })
    } catch (error) {
      if (alertReservationId) await client.from('whatsapp_collection_alerts').update({status:'failed',collection_stage:'failed',action:'template_send_failed',error_code:'MUGOZAP_REQUEST_FAILED',error_message:'Serviço do WhatsApp indisponível.'}).eq('id',alertReservationId)
      throw error
    } finally {
      clearTimeout(timeout)
    }
    const responseBody = await response.json().catch(() => null)
    if (!response.ok) {
      if (alertReservationId) await client.from('whatsapp_collection_alerts').update({status:'failed',collection_stage:'failed',action:'template_send_failed',error_code:`MUGOZAP_${response.status}`,error_message:'O MugoZap não conseguiu concluir o envio.'}).eq('id',alertReservationId)
      const detail = String(responseBody?.detail || '')
      const known = detail === 'Template pending approval' ? 'O template de cobrança ainda está em aprovação na Meta.' : detail === 'Template unavailable' ? 'O template de cobrança ainda não está disponível na Meta.' : response.status === 403 ? 'Seu perfil não possui permissão para executar esta ação.' : response.status === 404 ? 'Nenhuma conversa anterior foi encontrada. Inicie uma nova conversa.' : response.status === 429 ? 'Muitas solicitações. Aguarde e tente novamente.' : 'O serviço do WhatsApp está temporariamente indisponível.'
      return fail(`MUGOZAP_${response.status}`, known, response.status)
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
    if (error instanceof DOMException && error.name === 'AbortError') return fail('MUGOZAP_TIMEOUT', 'O MugoZap demorou mais que o esperado.', 504)
    return fail('INTERNAL_ERROR', 'A integração com o WhatsApp está temporariamente indisponível.', 500)
  }
})
