import { getSupabaseClient } from '../../lib/supabase/client.js'
import { getConversationIdentifier, RETRYABLE_WHATSAPP_CODES, WHATSAPP_OPERATION_CONTRACTS } from '../whatsapp/operationContracts.js'
import { blockWhatsAppAuth, buildWhatsAppHeaders, isWhatsAppAuthBlocked, resolveWhatsAppSession } from '../whatsapp/authGuard.js'
export { getConversationIdentifier, hasValidConversationIdentifier } from '../whatsapp/operationContracts.js'

const clean = value => String(value ?? '').trim()
const digits = value => clean(value).replace(/\D/g, '')
const asArray = value => Array.isArray(value) ? value : []
const cache = new Map()
const inFlight = new Map()

export class WhatsAppOperationError extends Error {
  constructor(body = {}, fallback = 'Não foi possível acessar o WhatsApp.') {
    super(body.message || fallback)
    this.name = 'WhatsAppOperationError'
    this.code = body.code || 'INTERNAL_ERROR'
    this.status = Number(body.status || 0)
    this.upstreamStatus = Number(body.upstream_status || 0)
    this.retryable = Boolean(body.retryable || RETRYABLE_WHATSAPP_CODES.has(this.code))
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
  if (!options.force && contract.kind === 'read' && cached && cached.expiresAt > now) return cached.value
  if (inFlight.has(key)) return withSignal(inFlight.get(key), options.signal)

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
    const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    const { data, error } = await client.functions.invoke('mugozap-api', {
      body: { operation, payload },
      headers: buildWhatsAppHeaders(session, publicKey, workspaceId),
    })
    if (error) {
      const structured = await operationError(error)
      if ([401,403].includes(structured.status)) { blockWhatsAppAuth(session.access_token);invalidateWhatsAppCache() }
      throw structured
    }
    if (!data?.ok) {
      const structured = await operationError(data)
      if ([401,403].includes(structured.status)) { blockWhatsAppAuth(session.access_token);invalidateWhatsAppCache() }
      throw structured
    }
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

export async function health(options) { return invoke('health', {}, options) }
export async function listConversations(filters = {}, options) {
  const data = await invoke('list_conversations', { limit: Math.min(Number(filters.limit) || 200, 200) }, options)
  return asArray(data?.items || data).map(normalizeConversation).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
}
export async function listMessages(conversation, limit = 80, options) {
  const waId = requireIdentifier(conversation)
  const data = await invoke('list_messages', { waId, limit: Math.min(Math.max(Number(limit) || 80, 1), 200) }, options)
  return asArray(data?.items || data).map(normalizeMessage).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
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
export const getTemplateStatus = (templateName, options) => invoke('get_template_status', { template_name: templateName }, options).then(data => data?.template || { name: templateName, language: 'pt_BR', status: 'SYNC_ERROR', category: '', quality: 'UNKNOWN', error: 'Resposta inválida.' })
export const getCollectionTemplateStatus = options => getTemplateStatus('mugo_alerta_pagamento_pendente', options)
export const getWhatsAppUsage = (days = 30, options) => invoke('get_usage', { days }, options).then(data => data?.usage || {})
export const sendManualMessage = (conversation, text) => {
  const value = clean(text)
  if (!value) throw new WhatsAppOperationError({ code: 'INVALID_PAYLOAD', message: 'Digite uma mensagem antes de enviar.', status: 400 })
  return invoke('send_manual_message', { waId: requireIdentifier(conversation), text: value })
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
