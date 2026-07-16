import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-workspace-id','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
const fail = (code: string, message: string, status = 400) => json({ ok: false, code, message }, status)
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)

const routes: Record<string, { method: string, path: (payload: any) => string, body?: (payload: any) => unknown, write?: boolean, admin?: boolean }> = {
  list_conversations: { method: 'GET', path: () => '/api/conversations' },
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
    const { data: profile } = await client.from('profiles').select('organization_id,role,active').eq('id', user.id).single()
    if (!profile?.active || !profile.organization_id) return fail('PROFILE_NOT_ALLOWED', 'Seu usuário não possui acesso ativo.', 403)

    const incoming = await request.json().catch(() => null)
    if (!incoming || JSON.stringify(incoming).length > 12000) return fail('INVALID_PAYLOAD', 'Payload inválido ou acima do limite.', 413)
    const operation = text(incoming.operation, 60), route = routes[operation]
    if (!route) return fail('OPERATION_NOT_ALLOWED', 'Operação não autorizada.', 403)
    if (route.write && !['admin','manager'].includes(profile.role)) return fail('WRITE_NOT_ALLOWED', 'Seu perfil não pode alterar conversas.', 403)
    if (route.admin && profile.role !== 'admin') return fail('ADMIN_REQUIRED', 'Somente administradores podem consultar usuários do WhatsApp.', 403)
    const payload = incoming.payload || {}, path = route.path(payload)
    if (!path.startsWith('/api/')) return fail('INVALID_ROUTE', 'Rota não autorizada.', 403)
    if (path.includes('undefined') || (operation !== 'get_attendance_meta' && operation !== 'list_conversations' && operation !== 'list_users' && operation !== 'get_dashboard_summary' && path.includes('wa_id=' + encodeURIComponent('')))) return fail('INVALID_IDENTIFIER', 'Identificador da conversa ausente.', 400)

    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000)
    const body = route.body ? route.body(payload) : undefined
    if (body && JSON.stringify(body).length > 8000) return fail('PAYLOAD_TOO_LARGE', 'Conteúdo acima do limite permitido.', 413)
    const mugoZapHeaders: Record<string,string> = { 'X-Panel-Key': panelKey, ...(body ? {'Content-Type':'application/json'} : {}) }
    if (workspaceId) mugoZapHeaders['X-Workspace-Id'] = workspaceId
    const response = await fetch(`${apiUrl}${path}`, { method: route.method, signal: controller.signal, headers: mugoZapHeaders, body: body ? JSON.stringify(body) : undefined }).finally(() => clearTimeout(timeout))
    const responseBody = await response.json().catch(() => null)
    if (!response.ok) {
      const known = response.status === 403 ? 'Você não possui permissão para esta operação no MugoZap.' : response.status === 404 ? 'A conversa não foi encontrada.' : response.status === 429 ? 'Muitas solicitações. Aguarde e tente novamente.' : 'O MugoZap não conseguiu concluir a operação.'
      return fail(`MUGOZAP_${response.status}`, known, response.status)
    }
    return json({ ok: true, data: responseBody })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return fail('MUGOZAP_TIMEOUT', 'O MugoZap demorou mais que o esperado.', 504)
    return fail('INTERNAL_ERROR', 'A integração com o WhatsApp está temporariamente indisponível.', 500)
  }
})
