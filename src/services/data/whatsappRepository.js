import { getSupabaseClient, getSupabasePublicConfig } from '../../lib/supabase/client.js'
import { getConversationIdentifier, RETRYABLE_WHATSAPP_CODES, WHATSAPP_OPERATION_CONTRACTS } from '../whatsapp/operationContracts.js'
import { blockWhatsAppAuth, buildWhatsAppHeaders, isWhatsAppAuthBlocked, resolveWhatsAppSession } from '../whatsapp/authGuard.js'
export { getConversationIdentifier, hasValidConversationIdentifier } from '../whatsapp/operationContracts.js'

const clean = value => String(value ?? '').trim()
const digits = value => clean(value).replace(/\D/g, '')
const asArray = value => Array.isArray(value) ? value : []
const cache = new Map()
const inFlight = new Map()
const crmAuthCodes = new Set(['AUTH_SESSION_MISSING','AUTH_INVALID_TOKEN','AUTH_BLOCKED'])
const auditedOperations = new Set(['list_conversations','list_messages','list_templates','sync_templates','start_template_conversation','send_template_message','get_template_test_access'])
const publicOperation = operation => operation === 'list_messages' ? 'get_conversation_messages' : operation
const maskTracePhone = value => {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `•••••••••${digits.slice(-4)}` : '[masked]'
}

const safeTraceValue = (value, depth = 0) => {
  if (depth > 5) return '[depth-limited]'
  if (Array.isArray(value)) return value.slice(0, 200).map(item => safeTraceValue(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /authorization|token|jwt|secret|apikey|api_key|panel_key/i.test(key)
      ? '[redacted]'
      : /^(recipient|phone|phone_number|wa_id)$/i.test(key)
        ? maskTracePhone(item)
        : safeTraceValue(item, depth + 1),
  ]))
}
const trace = (stage, operation, detail = {}) => {
  if (!auditedOperations.has(operation)) return
  console.info('[whatsapp_audit]', safeTraceValue({
    event: 'whatsapp_operation_trace',
    stage,
    operation: publicOperation(operation),
    internal_operation: operation,
    occurred_at: new Date().toISOString(),
    ...detail,
  }))
}

export class WhatsAppOperationError extends Error {
  constructor(body = {}, fallback = 'Não foi possível acessar o WhatsApp.') {
    super(body.message || fallback)
    this.name = 'WhatsAppOperationError'
    this.code = body.code || 'INTERNAL_ERROR'
    this.status = Number(body.status || 0)
    this.upstreamStatus = Number(body.upstream_status || 0)
    this.retryable = Boolean(body.retryable || RETRYABLE_WHATSAPP_CODES.has(this.code))
    this.requestId = clean(body.request_id)
    this.details = body.details || {}
  }
}

async function operationError(error) {
  let body = error
  if (typeof error?.context?.json === 'function') body = await error.context.json().catch(() => error)
  else if (error?.context?.body) body = error.context.body
  return new WhatsAppOperationError(body, error?.message)
}

const stableKey = (operation, payload) => `${operation}:${JSON.stringify(payload, Object.keys(payload || {}).sort())}`
const withSignal = (promise, signal) => {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('Request replaced', 'AbortError'))
  return Promise.race([
    promise,
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Request replaced', 'AbortError')), { once: true })),
  ])
}

async function invoke(operation, payload = {}, options = {}) {
  const contract = WHATSAPP_OPERATION_CONTRACTS[operation]
  if (!contract) throw new WhatsAppOperationError({ code: 'INVALID_OPERATION', message: 'Operação do WhatsApp não reconhecida.', status: 400 })
  const key = stableKey(operation, payload)
  const now = Date.now()
  const cached = cache.get(key)
  if (!options.force && contract.kind === 'read' && cached && cached.expiresAt > now) {
    trace('repository_cache_hit', operation, { payload, body_received: cached.value })
    return cached.value
  }
  if (inFlight.has(key)) {
    trace('repository_inflight_join', operation, { payload })
    return withSignal(inFlight.get(key), options.signal)
  }

  const request = (async () => {
    const client = getSupabaseClient()
    if (!client) throw new WhatsAppOperationError({ code: 'AUTH_SESSION_MISSING', message: 'Sua sessão expirou. Entre novamente no CRM.', status: 401 })
    const { session, error: sessionError } = await resolveWhatsAppSession(client)
    if (sessionError || !session?.access_token) {
      blockWhatsAppAuth()
      invalidateWhatsAppCache()
      throw new WhatsAppOperationError({ code: 'AUTH_SESSION_MISSING', message: 'Sua sessão expirou. Entre novamente no CRM.', status: 401 })
    }
    if (isWhatsAppAuthBlocked()) throw new WhatsAppOperationError({ code: 'AUTH_BLOCKED', message: 'Sua sessão expirou. Entre novamente no CRM.', status: 403 })
    const sessionUser = session.user || {}
    const workspaceId = clean(sessionUser.app_metadata?.workspace_id || sessionUser.workspace_id)
    const publicKey = getSupabasePublicConfig().key
    trace('repository_sent', operation, { payload, endpoint: 'supabase.functions.invoke:mugozap-api' })
    const { data, error } = await client.functions.invoke('mugozap-api', {
      body: { operation, payload },
      headers: buildWhatsAppHeaders(session, publicKey, workspaceId),
    })
    if (error) {
      const structured = await operationError(error)
      trace('repository_received_error', operation, { payload, request_id: structured.requestId, status_http: structured.status, body_received: structured })
      if (crmAuthCodes.has(structured.code)) { blockWhatsAppAuth(session.access_token);invalidateWhatsAppCache() }
      throw structured
    }
    if (!data?.ok) {
      const structured = await operationError(data)
      trace('repository_received_error', operation, { payload, request_id: structured.requestId, status_http: structured.status, body_received: data })
      if (crmAuthCodes.has(structured.code)) { blockWhatsAppAuth(session.access_token);invalidateWhatsAppCache() }
      throw structured
    }
    trace('repository_received', operation, { payload, request_id: clean(data.request_id), status_http: 200, body_received: data.data, body_returned_to_frontend: data.data })
    if (contract.kind === 'read') cache.set(key, { value: data.data, expiresAt: Date.now() + contract.ttl })
    return data.data
  })().finally(() => inFlight.delete(key))

  inFlight.set(key, request)
  return withSignal(request, options.signal)
}

export function invalidateWhatsAppCache(prefix = '') {
  for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key)
}

function requireIdentifier(value) {
  const identifier = getConversationIdentifier(typeof value === 'object' ? value : { wa_id: value })
  if (!identifier) throw new WhatsAppOperationError({ code: 'INVALID_CONVERSATION_ID', message: 'Identificador da conversa ausente.', status: 400 })
  return identifier
}

function normalizeConversation(item = {}) {
  const waId = getConversationIdentifier(item)
  const windowExpiresAt = item.service_window_expires_at || item.customer_care_window_expires_at || item.session_expires_at || null
  const explicitWindow = item.within_24h ?? item.service_window_open ?? item.can_send_freeform
  return {
    ...item,
    waId,
    phone: digits(waId || item.telefone || item.contact_phone),
    name: clean(item.name || item.contact_name || item.push_name) || (waId ? `Contato • final ${waId.slice(-4)}` : 'Contato sem identificação'),
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
    serviceWindowOpen: explicitWindow === undefined || explicitWindow === null ? (windowExpiresAt ? new Date(windowExpiresAt).getTime() > Date.now() : null) : Boolean(explicitWindow),
    serviceWindowExpiresAt: windowExpiresAt,
  }
}

function normalizeMessage(item = {}) {
  const direction = clean(item.direction || item.dir || item.message_direction).toLowerCase()
  const messageType = clean(item.message_type || item.type || item.content?.type || 'text').toLowerCase()
  const providerMessageId = clean(item.provider_message_id || item.message_id || item.meta_message_id || item.wa_message_id)
  const textContent = item.content?.text?.body || item.content?.body || item.text?.body || item.text || item.message || item.body || item.caption
  return {
    ...item,
    id: item.id || providerMessageId || `${item.created_at || item.sent_at || item.timestamp || ''}-${clean(textContent)}`,
    conversation_id: clean(item.conversation_id || item.chat_id || item.wa_id),
    provider_message_id: providerMessageId,
    text: clean(textContent),
    media_url: clean(item.media_url || item.url || item.content?.url),
    template_name: clean(item.template_name || item.template?.name || item.meta?.template_name),
    sender: clean(item.sender || item.from || item.sender_id),
    recipient: clean(item.recipient || item.to || item.recipient_id),
    type: messageType,
    createdAt: item.sent_at || item.created_at || item.timestamp || null,
    sent_at: item.sent_at || item.created_at || item.timestamp || null,
    delivered_at: item.delivered_at || null,
    read_at: item.read_at || null,
    failed_at: item.failed_at || null,
    direction: ['out', 'outbound', 'sent', 'from_me'].includes(direction) || item.from_me === true ? 'out' : 'in',
    status: clean(item.status || item.delivery_status),
    error_code: clean(item.error_code || item.error?.code),
    error_message: clean(item.error_message || item.error?.message),
    raw_payload: item.raw_payload || item.raw || item,
    template: Boolean(item.template_name || item.template || item.is_template || item.meta?.template_name),
    collection: Boolean(item.collection || item.event === 'collection_reminder' || item.meta?.outbound_source === 'collection'),
  }
}

const messageRows = data => {
  if (Array.isArray(data)) return data
  for (const candidate of [data?.items, data?.messages, data?.data, data?.results]) if (Array.isArray(candidate)) return candidate
  return []
}

export async function health(options) { return invoke('health', {}, options) }
export async function getWhatsAppSystemHealth(options) { return invoke('health_check', {}, options) }
export async function listConversations(filters = {}, options) {
  const data = await invoke('list_conversations', { limit: Math.min(Number(filters.limit) || 200, 200) }, options)
  return asArray(data?.items || data).map(normalizeConversation).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
}
export async function listMessages(conversation, limit = 80, options) {
  const waId = requireIdentifier(conversation)
  const data = await invoke('list_messages', { waId, limit: Math.min(Math.max(Number(limit) || 80, 1), 200) }, options)
  return messageRows(data).map(normalizeMessage).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
}
export async function findConversationByPhone(phone, options) {
  const normalized = normalizePhone(phone)
  if (!/^55[1-9]{2}9?\d{8}$/.test(normalized)) throw new WhatsAppOperationError({ code: 'INVALID_PAYLOAD', message: 'Informe um número de WhatsApp válido com DDD.', status: 400 })
  try {
    const data = await invoke('find_conversation_by_phone', { phone: normalized }, options)
    return data?.conversation ? normalizeConversation(data.conversation) : null
  } catch (error) {
    if (error.code === 'UPSTREAM_NOT_FOUND') return null
    throw error
  }
}
export const startTemplateConversation = payload => invoke('start_template_conversation', payload)
export const sendTemplateMessage = payload => invoke('send_template_message', payload)
export const getTemplateTestAccess = (recipient,templateName,language='pt_BR',options) => invoke('get_template_test_access', {recipient,template_name:templateName,language}, options)
export const listStoredWhatsAppTemplates = options => invoke('list_templates', {}, options)
export const syncWhatsAppTemplates = async options => {
  invalidateWhatsAppCache('list_templates:')
  invalidateWhatsAppCache('get_template_status:')
  const result=await invoke('sync_templates', {}, {...options,force:true})
  invalidateWhatsAppCache('list_templates:')
  invalidateWhatsAppCache('get_template_status:')
  return result
}
export const getTemplateStatus = (templateName, options) => invoke('get_template_status', { template_name: templateName }, options).then(data => data?.template || { name: templateName, language: 'pt_BR', status: 'SYNC_ERROR', category: '', quality: 'UNKNOWN', error: 'Resposta inválida.' })
export const getCollectionTemplateStatus = options => getTemplateStatus('mugo_alerta_pagamento_pendente', options)
export const getWhatsAppUsage = (days = 30, options) => invoke('get_usage', { days }, options).then(data => data?.usage || {})
export const sendManualMessage = (conversation, text, idempotencyKey) => {
  const value = clean(text)
  if (!value) throw new WhatsAppOperationError({ code: 'INVALID_PAYLOAD', message: 'Digite uma mensagem antes de enviar.', status: 400 })
  return invoke('send_manual_message', { waId: requireIdentifier(conversation), text: value, idempotencyKey: clean(idempotencyKey) })
}
export const assignConversation = (conversation, userId) => invoke('assign_conversation', { waId: requireIdentifier(conversation), assignedTo: clean(userId) })
export const pauseAutomation = conversation => invoke('pause_automation', { waId: requireIdentifier(conversation) })
export const resumeAutomation = conversation => invoke('resume_automation', { waId: requireIdentifier(conversation) })
export const closeConversation = conversation => invoke('close_conversation', { waId: requireIdentifier(conversation) })
export const updateConversation = (conversation, changes) => invoke('pause_automation', { waId: requireIdentifier(conversation), changes })
export const closeHandoff = resumeAutomation
export const getAttendanceMeta = options => invoke('get_attendance_meta', {}, options)
export const listWhatsAppUsers = options => invoke('list_users', {}, options).then(data => asArray(data?.items || data))
export const getWhatsAppSummary = options => invoke('get_dashboard_summary', {}, options).then(data => data?.summary || data || {})

function normalizePhone(value) {
  let phone = digits(value)
  if (phone.startsWith('00')) phone = phone.slice(2)
  if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) phone = `55${phone}`
  return phone
}
