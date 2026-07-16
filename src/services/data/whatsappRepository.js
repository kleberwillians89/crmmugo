import { getSupabaseClient } from '../../lib/supabase/client'

const clean = (value) => String(value ?? '').trim()
const digits = (value) => clean(value).replace(/\D/g, '')
const asArray = (value) => Array.isArray(value) ? value : []

async function operationError(error) {
  const body = typeof error?.context?.json === 'function' ? await error.context.json().catch(()=>null) : error?.context?.body
  const message = body?.message || error?.message || 'Não foi possível acessar o WhatsApp.'
  const result = new Error(message)
  result.code = body?.code || error?.code || 'MUGOZAP_REQUEST_FAILED'
  return result
}

async function invoke(operation, payload = {}) {
  const client = getSupabaseClient()
  if (!client) throw new Error('A área WhatsApp exige o ambiente Supabase autenticado.')
  const { data: sessionData } = await client.auth.getSession()
  const sessionUser = sessionData?.session?.user || {}
  const workspaceId = clean(
    sessionUser.app_metadata?.workspace_id
    || sessionUser.workspace_id
  )
  const { data, error } = await client.functions.invoke('mugozap-api', {
    body: { operation, payload },
    headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
  })
  if (error) throw await operationError(error)
  if (!data?.ok) throw await operationError(data)
  return data.data
}

function normalizeConversation(item = {}) {
  const waId = clean(item.wa_id || item.phone || item.telefone)
  return {
    ...item,
    waId,
    phone: digits(waId || item.telefone),
    name: clean(item.name || item.contact_name || item.push_name) || 'Contato sem nome',
    preview: clean(item.last_message || item.last_message_text || item.preview),
    updatedAt: item.updated_at || item.last_message_at || item.created_at || null,
    unread: Number(item.unread_count || item.unread || 0),
    owner: clean(item.assigned_to || item.human_owner || item.owner),
    status: clean(item.status || item.stage) || 'open',
    source: clean(item.origem_lead || item.source || item.last_source),
    attendanceMode: clean(item.attendance_mode) || (item.automation_paused ? 'paused' : item.bot_enabled === false ? 'human' : 'bot'),
    automationPaused: Boolean(item.automation_paused),
    botEnabled: item.bot_enabled !== false,
    awaitingHuman: Boolean(item.awaiting_human || item.handoff_pending || item.handoff_active),
    collection: Boolean(item.collection_pending || item.cobranca || item.billing_status),
  }
}

function normalizeMessage(item = {}) {
  const direction = clean(item.direction || item.dir || item.type).toLowerCase()
  return {
    ...item,
    id: item.id || `${item.created_at || ''}-${item.text || item.message || ''}`,
    text: clean(item.text || item.message || item.body),
    createdAt: item.created_at || item.timestamp || null,
    direction: ['out', 'outbound', 'sent'].includes(direction) ? 'out' : 'in',
    status: clean(item.status || item.delivery_status),
    template: Boolean(item.template_name || item.is_template || item.meta?.template_name),
    collection: Boolean(item.collection || item.event === 'collection_reminder' || item.meta?.outbound_source === 'collection'),
  }
}

export async function listConversations(filters = {}) {
  const data = await invoke('list_conversations', { limit: Math.min(Number(filters.limit) || 200, 200) })
  return asArray(data?.items || data).map(normalizeConversation).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
}
export async function listMessages(waId, limit = 80) {
  if (!clean(waId)) throw new Error('Selecione uma conversa.')
  const data = await invoke('list_messages', { waId: clean(waId), limit: Math.min(Math.max(Number(limit) || 80, 1), 200) })
  return asArray(data?.items || data).map(normalizeMessage).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
}
export async function findConversationByPhone(phone) {
  const normalized = normalizePhone(phone)
  if (!/^55[1-9]{2}9?\d{8}$/.test(normalized)) throw new Error('Informe um número de WhatsApp válido com DDD.')
  try {
    const data = await invoke('find_conversation_by_phone', { phone: normalized })
    return data?.conversation ? normalizeConversation(data.conversation) : null
  } catch (error) {
    if (error.code === 'MUGOZAP_404' || /não foi encontrada|not found/i.test(error.message)) return null
    throw error
  }
}
export const startTemplateConversation = payload => invoke('start_template_conversation', payload)
export const sendManualMessage = (waId, text) => invoke('send_manual_message', { waId: clean(waId), text: clean(text) })
export const updateConversation = (waId, payload) => invoke('update_conversation', { waId: clean(waId), changes: payload })
export const assignConversation = (waId, userId) => invoke('assign_conversation', { waId: clean(waId), assignedTo: clean(userId) })
export const updateConversationStatus = (waId, status) => invoke('update_attendance_status', { waId: clean(waId), status: clean(status) })
export const closeHandoff = (waId) => invoke('close_handoff', { waId: clean(waId) })
export const getAttendanceMeta = () => invoke('get_attendance_meta')
export async function listWhatsAppUsers() { const data = await invoke('list_users'); return asArray(data?.items || data) }
export async function getWhatsAppSummary() { const data = await invoke('get_dashboard_summary'); return data?.summary || data || {} }

function normalizePhone(value) {
  let phone = digits(value)
  if (phone.startsWith('00')) phone = phone.slice(2)
  if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) phone = `55${phone}`
  return phone
}
