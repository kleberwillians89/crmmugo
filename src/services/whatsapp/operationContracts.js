export const WHATSAPP_OPERATION_CONTRACTS = Object.freeze({
  health: { kind: 'read', ttl: 60_000 },
  list_conversations: { kind: 'read', ttl: 30_000 },
  list_messages: { kind: 'read', ttl: 15_000, identifier: true },
  send_manual_message: { kind: 'write', identifier: true },
  assign_conversation: { kind: 'write', identifier: true },
  pause_automation: { kind: 'write', identifier: true },
  resume_automation: { kind: 'write', identifier: true },
  close_conversation: { kind: 'write', identifier: true },
  find_conversation_by_phone: { kind: 'read', ttl: 30_000 },
  start_template_conversation: { kind: 'write' },
  get_template_status: { kind: 'read', ttl: 600_000 },
  get_usage: { kind: 'read', ttl: 300_000 },
  batch_collection_alerts: { kind: 'write' },
  mark_collection_negotiation: { kind: 'write' },
  mark_installment_paid: { kind: 'write' },
  get_attendance_meta: { kind: 'read', ttl: 60_000 },
  list_users: { kind: 'read', ttl: 60_000 },
  get_dashboard_summary: { kind: 'read', ttl: 30_000 },
})

export const RETRYABLE_WHATSAPP_CODES = new Set([
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_COLD_START',
  'UPSTREAM_UNAVAILABLE',
])

const clean = value => String(value ?? '').trim()
const digits = value => clean(value).replace(/\D/g, '')

export function getConversationIdentifier(conversation = {}) {
  const candidates = [
    conversation.wa_id,
    conversation.waId,
    conversation.phone,
    conversation.telefone,
    conversation.contact_phone,
  ]
  for (const candidate of candidates) {
    const normalized = digits(candidate)
    if (/^\d{10,15}$/.test(normalized)) return normalized
  }
  const id = clean(conversation.id)
  return /^\d{10,15}$/.test(id) ? id : ''
}

export const hasValidConversationIdentifier = conversation => Boolean(getConversationIdentifier(conversation))
