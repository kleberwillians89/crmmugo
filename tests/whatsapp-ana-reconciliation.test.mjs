import assert from 'node:assert/strict'
import fs from 'node:fs'

const state = {
  alerts: [{ id: 'alert-ana', organization_id: 'org-mugo', client_id: 'client-ana', wa_id: '5511999991234', provider_message_id: 'wamid.ana.confirmed', template_name: 'mugo_alerta_pagamento_pendente', template_language: 'pt_BR', status: 'sent', sent_at: '2026-08-30T14:00:00.000Z' }],
  contacts: new Map(), conversations: new Map(), messages: new Map(), transportCalls: 0,
}

const reconcile = (alert) => {
  assert.ok(alert.provider_message_id, 'somente envio confirmado pode ser reconciliado')
  const identity = `${alert.organization_id}:connection-meta:${alert.wa_id}`
  if (!state.contacts.has(identity)) state.contacts.set(identity, { id: 'contact-ana', client_id: alert.client_id, wa_id: alert.wa_id })
  if (!state.conversations.has(identity)) state.conversations.set(identity, { id: 'conversation-ana', contact_id: 'contact-ana', wa_id: alert.wa_id, last_message_at: alert.sent_at })
  if (!state.messages.has(alert.provider_message_id)) state.messages.set(alert.provider_message_id, { conversation_id: 'conversation-ana', direction: 'out', message_type: 'template', template_name: alert.template_name, provider_message_id: alert.provider_message_id, status: 'sent', sent_at: alert.sent_at })
  return state.conversations.get(identity)
}

const conversation = reconcile(state.alerts[0])
assert.equal(state.transportCalls, 0, 'reconciliação não envia mensagem')
assert.equal(conversation.id, 'conversation-ana')
assert.equal(state.messages.get('wamid.ana.confirmed').conversation_id, conversation.id)
assert.equal([...state.conversations.values()].filter((item) => item.wa_id === '5511999991234').length, 1)
reconcile(state.alerts[0])
assert.equal(state.messages.size, 1, 'provider_message_id torna a reconstrução idempotente')
const inbox = [...state.conversations.values()].filter((item) => [...state.messages.values()].some((message) => message.conversation_id === item.id))
assert.deepEqual(inbox.map((item) => item.id), ['conversation-ana'])

const edge = fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts', import.meta.url), 'utf8')
const repository = fs.readFileSync(new URL('../src/services/data/whatsappRepository.js', import.meta.url), 'utf8')
assert.match(edge, /if\(operation==='reconcile_whatsapp_history'\)/)
assert.match(edge, /\.not\('provider_message_id','is',null\)/)
assert.match(edge, /already_sent:true,reconciled:true/)
assert.match(edge, /A mensagem não foi reenviada/)
assert.match(repository, /from\('whatsapp_conversations'\)/)
assert.match(repository, /from\('whatsapp_messages'\)/)

console.log('WhatsApp Ana reconciliation: ok (no resend)')
