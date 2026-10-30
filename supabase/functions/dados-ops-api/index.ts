// Ponte OPERACIONAL CRM Mugô -> Mugô Dados (tarefas e atendimento). Fase 1: somente leitura.
//
// Separada de propósito da data-platform-api (que só entrega números do funil e nunca lê conversa):
// conteúdo de conversa é mais sensível, então tem função, chave e testes próprios.
//
// Regras que o código nunca quebra (checadas em tests/dados-ops-api.test.mjs):
// - Autentica só por X-Dados-Ops-Key (segredo DADOS_OPS_API_KEY); nunca JWT de usuário final.
// - O chamador nunca informa organization_id/client_id: manda external_client_id (o id da empresa no
//   Mugô Dados) e a função resolve organização + cliente via external_integrations. Toda query filtra
//   pelos DOIS juntos.
// - Financeiro fica fora: nenhuma tarefa ligada a parcela, nem categoria financeira.
// - Logs nunca carregam texto de mensagem, telefone ou nome — só ids, endpoint, status e duração.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)
const clampLimit = (value: unknown, fallback = 50, max = 200) => Math.min(Math.max(Number(value) || fallback, 1), max)
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const FINANCE_CATEGORY = /^financ/i
const TASK_STATUS = new Set(['pending', 'in_progress', 'completed', 'cancelled'])

const maskPhone = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '••••'
}

async function handleTasks(admin: any, org: string, clientId: string, url: URL, limit: number) {
  const status = text(url.searchParams.get('status'), 20)
  let query = admin.from('crm_tasks')
    .select('id,title,status,priority,due_date,due_time,starts_at,category,task_type,tags,notes,assigned_to,updated_at')
    .eq('organization_id', org).eq('client_id', clientId)
    .is('archived_at', null).is('installment_id', null)
    .order('due_date', { ascending: true, nullsFirst: false }).limit(limit)
  if (status && TASK_STATUS.has(status)) query = query.eq('status', status)
  else query = query.in('status', ['pending', 'in_progress'])
  const tasks = await query
  if (tasks.error) throw tasks.error
  const visible = (tasks.data || []).filter((row: any) => !FINANCE_CATEGORY.test(String(row.category || '')))
  const memberIds = [...new Set(visible.map((row: any) => row.assigned_to).filter(Boolean))]
  const members = memberIds.length
    ? await admin.from('team_members').select('id,name,color').eq('organization_id', org).in('id', memberIds)
    : { data: [], error: null }
  if (members.error) throw members.error
  const byId = new Map((members.data || []).map((row: any) => [row.id, row]))
  return json({
    ok: true,
    data: {
      tasks: visible.map((row: any) => ({
        id: row.id, title: row.title, status: row.status, priority: row.priority, due_date: row.due_date,
        due_time: row.due_time, starts_at: row.starts_at, category: row.category, task_type: row.task_type,
        tags: row.tags || [], notes: text(row.notes, 1000) || null, updated_at: row.updated_at,
        assignee: row.assigned_to && byId.get(row.assigned_to)
          ? { name: (byId.get(row.assigned_to) as any).name, color: (byId.get(row.assigned_to) as any).color } : null,
      })),
    },
  })
}

async function handleConversations(admin: any, org: string, clientId: string, limit: number) {
  // Conversa pertence ao cliente quando o CONTATO está vinculado a ele no CRM (whatsapp_contacts.client_id).
  const contacts = await admin.from('whatsapp_contacts').select('id,display_name,profile_name,wa_id')
    .eq('organization_id', org).eq('client_id', clientId).limit(500)
  if (contacts.error) throw contacts.error
  const contactIds = (contacts.data || []).map((row: any) => row.id)
  if (!contactIds.length) return json({ ok: true, data: { conversations: [] } })
  const conversations = await admin.from('whatsapp_conversations')
    .select('id,contact_id,status,attendance_mode,unread_count,last_message_at,last_inbound_at,service_window_expires_at')
    .eq('organization_id', org).in('contact_id', contactIds)
    .order('last_message_at', { ascending: false, nullsFirst: false }).limit(limit)
  if (conversations.error) throw conversations.error
  const byContact = new Map((contacts.data || []).map((row: any) => [row.id, row]))
  const ids = (conversations.data || []).map((row: any) => row.id)
  const last = ids.length
    ? await admin.from('whatsapp_messages').select('conversation_id,direction,message_type,text_content,template_name,created_at')
      .eq('organization_id', org).in('conversation_id', ids).order('created_at', { ascending: false }).limit(Math.min(ids.length * 5, 1000))
    : { data: [], error: null }
  if (last.error) throw last.error
  const preview = new Map<string, any>()
  for (const row of last.data || []) if (!preview.has(row.conversation_id)) preview.set(row.conversation_id, row)
  return json({
    ok: true,
    data: {
      conversations: (conversations.data || []).map((row: any) => {
        const contact: any = byContact.get(row.contact_id) || {}
        const message = preview.get(row.id)
        return {
          id: row.id, status: row.status, attendance_mode: row.attendance_mode, unread_count: row.unread_count,
          last_message_at: row.last_message_at, service_window_expires_at: row.service_window_expires_at,
          contact: { name: text(contact.display_name || contact.profile_name, 120) || null, phone_masked: maskPhone(contact.wa_id) },
          last_message: message ? {
            direction: message.direction, at: message.created_at,
            text: text(message.text_content, 160) || (message.template_name ? `Modelo: ${message.template_name}` : `[${message.message_type}]`),
          } : null,
        }
      }),
    },
  })
}

async function handleMessages(admin: any, org: string, clientId: string, url: URL, limit: number) {
  const conversationId = text(url.searchParams.get('conversation_id'), 40)
  if (!isUuid(conversationId)) return json({ ok: false, code: 'CONVERSATION_ID_REQUIRED' }, 400)
  const conversation = await admin.from('whatsapp_conversations').select('id,contact_id').eq('organization_id', org).eq('id', conversationId).maybeSingle()
  if (conversation.error) throw conversation.error
  if (!conversation.data) return json({ ok: false, code: 'CONVERSATION_NOT_FOUND' }, 404)
  // A conversa só é entregue se o contato dela for DESTE cliente — nunca de outro cliente da organização.
  const contact = await admin.from('whatsapp_contacts').select('id').eq('organization_id', org).eq('client_id', clientId).eq('id', conversation.data.contact_id).maybeSingle()
  if (contact.error) throw contact.error
  if (!contact.data) return json({ ok: false, code: 'CONVERSATION_NOT_FOUND' }, 404)
  const messages = await admin.from('whatsapp_messages')
    .select('id,direction,message_type,status,text_content,template_name,created_at,sent_at,delivered_at,read_at,failed_at,error_code')
    .eq('organization_id', org).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit)
  if (messages.error) throw messages.error
  return json({
    ok: true,
    data: {
      messages: (messages.data || []).reverse().map((row: any) => ({
        id: row.id, direction: row.direction, type: row.message_type, status: row.status,
        text: text(row.text_content, 4000) || null, template_name: row.template_name, at: row.created_at,
        read_at: row.read_at, failed: Boolean(row.failed_at), error_code: row.error_code ? text(row.error_code, 60) : null,
      })),
    },
  })
}

Deno.serve(async (request: Request) => {
  const startedAt = Date.now()
  if (request.method !== 'GET') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const url = new URL(request.url)
  const expectedKey = Deno.env.get('DADOS_OPS_API_KEY') || ''
  if (!expectedKey || request.headers.get('X-Dados-Ops-Key') !== expectedKey) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceKey) return json({ ok: false, code: 'CONFIGURATION_MISSING' }, 503)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const externalClientId = text(url.searchParams.get('external_client_id'), 200)
  const limit = clampLimit(url.searchParams.get('limit'))
  const endpoint = url.pathname.split('/').filter(Boolean).pop() || ''
  if (!externalClientId) return json({ ok: false, code: 'EXTERNAL_CLIENT_ID_REQUIRED' }, 400)

  const integration = await admin.from('external_integrations').select('organization_id,client_id')
    .eq('provider', 'mugo_dados').eq('external_client_id', externalClientId).eq('status', 'active').maybeSingle()
  if (integration.error) {
    console.log(JSON.stringify({ event: 'dados_ops_lookup_failed', endpoint, duration_ms: Date.now() - startedAt }))
    return json({ ok: false, code: 'LOOKUP_FAILED' }, 500)
  }
  if (!integration.data) return json({ ok: false, code: 'UNKNOWN_EXTERNAL_CLIENT' }, 403)
  const organizationId = integration.data.organization_id
  const clientId = integration.data.client_id

  try {
    let response: Response
    if (endpoint === 'tasks') response = await handleTasks(admin, organizationId, clientId, url, limit)
    else if (endpoint === 'conversations') response = await handleConversations(admin, organizationId, clientId, limit)
    else if (endpoint === 'messages') response = await handleMessages(admin, organizationId, clientId, url, limit)
    else return json({ ok: false, code: 'NOT_FOUND' }, 404)
    console.log(JSON.stringify({ event: 'dados_ops_request', organization_id: organizationId, client_id: clientId, endpoint, status_http: response.status, duration_ms: Date.now() - startedAt }))
    return response
  } catch (error) {
    console.log(JSON.stringify({ event: 'dados_ops_query_failed', organization_id: organizationId, client_id: clientId, endpoint, error_code: String((error as any)?.code || 'unknown').slice(0, 60) }))
    return json({ ok: false, code: 'QUERY_FAILED' }, 500)
  }
})
