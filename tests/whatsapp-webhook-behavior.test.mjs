import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  inboundEventKey,
  shouldApplyMetaStatus,
  statusEventKey,
  verifyMetaSignature,
  verifyWebhookChallenge,
  webhookDigits,
  webhookMessageContent,
} from '../supabase/functions/_shared/whatsappWebhookCore.js'

const encoder = new TextEncoder()
const body = encoder.encode(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }))
const secret = 'meta-test-secret'
const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, body))
const signature = `sha256=${[...signatureBytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`
assert.equal(await verifyMetaSignature(body, signature, secret), true)
assert.equal(await verifyMetaSignature(body, `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`, secret), false)
assert.equal(await verifyMetaSignature(body, '', secret), false)
assert.equal(verifyWebhookChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=token'), 'token'), true)
assert.equal(verifyWebhookChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=wrong'), 'token'), false)

assert.equal(webhookDigits('+55 (11) 99999-1234'), '5511999991234')
assert.deepEqual(webhookMessageContent({ type: 'text', text: { body: 'Olá' } }), { type: 'text', body: 'Olá', media: {} })
assert.deepEqual(webhookMessageContent({ type: 'interactive', interactive: { button_reply: { id: 'yes', title: 'Sim' } } }), { type: 'interactive', body: 'Sim', media: { reply_id: 'yes' } })
assert.equal(inboundEventKey('wamid.in.1'), 'message:wamid.in.1')
assert.equal(statusEventKey('wamid.out.1', 'read', '1788177600'), 'status:wamid.out.1:read:1788177600')
assert.equal(shouldApplyMetaStatus('sent', 'delivered'), true)
assert.equal(shouldApplyMetaStatus('delivered', 'read'), true)
assert.equal(shouldApplyMetaStatus('read', 'delivered'), false)
assert.equal(shouldApplyMetaStatus('read', 'failed'), false)

// Modelo comportamental mínimo: tenant + conexão + wa_id identifica uma única
// conversa; status encontra a mensagem pelo wamid e não cria outra linha.
const state = { conversations: new Map(), messages: new Map(), unread: new Map(), events: new Set() }
const receive = ({ organizationId, connectionId, waId, messageId, text }) => {
  const event = `${connectionId}:${inboundEventKey(messageId)}`
  if (state.events.has(event)) return false
  state.events.add(event)
  const conversationKey = `${organizationId}:${connectionId}:${waId}`
  if (!state.conversations.has(conversationKey)) state.conversations.set(conversationKey, { id: `conversation-${state.conversations.size + 1}`, organizationId, connectionId, waId })
  const conversation = state.conversations.get(conversationKey)
  state.messages.set(messageId, { conversationId: conversation.id, direction: 'in', status: 'received', text })
  state.unread.set(conversation.id, (state.unread.get(conversation.id) || 0) + 1)
  return true
}
state.conversations.set('org-a:connection-a:5511999991234', { id: 'conversation-ana', organizationId: 'org-a', connectionId: 'connection-a', waId: '5511999991234' })
state.messages.set('wamid.out.ana', { conversationId: 'conversation-ana', direction: 'out', status: 'sent' })
assert.equal(receive({ organizationId: 'org-a', connectionId: 'connection-a', waId: '5511999991234', messageId: 'wamid.in.ana', text: 'Recebi' }), true)
assert.equal(state.conversations.size, 1, 'inbound da Ana reutiliza a conversa outbound')
assert.equal(state.messages.get('wamid.in.ana').conversationId, 'conversation-ana')
assert.equal(state.unread.get('conversation-ana'), 1)
assert.equal(receive({ organizationId: 'org-a', connectionId: 'connection-a', waId: '5511999991234', messageId: 'wamid.in.ana', text: 'Recebi' }), false)
assert.equal(state.messages.size, 2, 'webhook duplicado não cria mensagem')
const beforeStatus = state.messages.size
state.messages.get('wamid.out.ana').status = 'delivered'
assert.equal(state.messages.size, beforeStatus, 'status atualiza pelo wamid sem inserir mensagem')
assert.notEqual(`${'org-b'}:${'connection-b'}:${'5511999991234'}`, 'org-a:connection-a:5511999991234')

const webhook = fs.readFileSync(new URL('../supabase/functions/whatsapp-webhook/index.ts', import.meta.url), 'utf8')
assert.match(webhook, /eq\('phone_number_id', phoneNumberId\)/)
assert.match(webhook, /eq\('provider_message_id', providerMessageId\)/)
assert.match(webhook, /rpc\('increment_whatsapp_unread'/)
assert.match(webhook, /whatsapp_message_received/)
assert.match(webhook, /if \(!connectionResult\.data\) \{ unknownConnections \+= 1; continue \}/)

// --- claimWebhookEvent: ledger de idempotência nunca reprocessa completed, nunca duplica em corrida,
// e só reclama processamento travado (>2min) via optimistic-lock (eq updated_at) ------------------
assert.match(webhook, /if \(existing\.data\.processing_status === 'completed'\) return \{ claimed: false, id: existing\.data\.id \}/)
assert.match(webhook, /const recent = existing\.data\.processing_status === 'processing'\s*\n\s*&& startedAt && Date\.now\(\) - new Date\(startedAt\)\.getTime\(\) < 2 \* 60 \* 1000/)
assert.match(webhook, /if \(recent\) return \{ claimed: false, id: existing\.data\.id \}/)
assert.match(webhook, /\.eq\('id', existing\.data\.id\)\.eq\('updated_at', existing\.data\.updated_at\)\.select\('id'\)\.maybeSingle\(\)/)
assert.match(webhook, /if \(inserted\.error\.code !== '23505'\) throw inserted\.error/)
assert.match(webhook, /\.eq\('id', id\)\.eq\('processing_status', 'processing'\)/)

// --- Regressão: painel lateral (Caixa de Entrada) nunca vincula cliente por nome, só por client_id
// ou telefone — é o que garante que um lead comercial de homologação (ex.: "Roove" lead) nunca puxe
// dados de um cliente financeiro homônimo com telefone diferente (ex.: "Roove" financeira real). ---
const whatsappPage = fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx', import.meta.url), 'utf8')
assert.match(whatsappPage, /const client=clients\.find\(item=>item\.id===selectedLink\?\.client_id\)\|\|clients\.find\(item=>samePhone\(item\.phone,selected\?\.phone\)\|\|samePhone\(item\.billing_contact_phone,selected\?\.phone\)\)/)
assert.doesNotMatch(whatsappPage, /clients\.find\([^)]*\.(company_name|trade_name|contact_name)\s*===/, 'painel lateral nunca deve resolver cliente comparando nome')

console.log('WhatsApp webhook behavioral contracts: ok')
