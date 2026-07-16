import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getConversationIdentifier, hasValidConversationIdentifier, WHATSAPP_OPERATION_CONTRACTS } from '../src/services/whatsapp/operationContracts.js'

assert.equal(getConversationIdentifier({ wa_id: '+55 (11) 99999-1234' }), '5511999991234')
assert.equal(getConversationIdentifier({ waId: '5511988881234' }), '5511988881234')
assert.equal(getConversationIdentifier({ contact_phone: '11 97777-1234' }), '11977771234')
assert.equal(getConversationIdentifier({ id: '57a90ce4-d88f-4dc4-8b69-5aa25d08a94c' }), '')
assert.equal(hasValidConversationIdentifier({ telefone: '' }), false)

for (const operation of [
  'health','list_conversations','list_messages','send_manual_message','assign_conversation',
  'pause_automation','resume_automation','close_conversation','find_conversation_by_phone',
  'start_template_conversation','get_template_status','get_usage','batch_collection_alerts',
  'mark_collection_negotiation','mark_installment_paid',
]) assert.ok(WHATSAPP_OPERATION_CONTRACTS[operation], `Contrato ausente: ${operation}`)

const edge = fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts', import.meta.url), 'utf8')
for (const code of [
  'INVALID_OPERATION','INVALID_PAYLOAD','INVALID_CONVERSATION_ID','UNAUTHENTICATED',
  'PROFILE_NOT_FOUND','FORBIDDEN','DUPLICATE_ALERT','INSTALLMENT_PAID',
  'TEMPLATE_NOT_CONFIGURED','TEMPLATE_PENDING','TEMPLATE_REJECTED','TEMPLATE_PAUSED',
  'UPSTREAM_UNAUTHORIZED','UPSTREAM_FORBIDDEN','UPSTREAM_NOT_FOUND',
  'UPSTREAM_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_COLD_START','MESSAGE_SEND_FAILED','INTERNAL_ERROR',
]) assert.match(edge, new RegExp(code), `Código de erro ausente: ${code}`)
assert.match(edge, /timeoutFor/)
assert.match(edge, /mugozap_upstream/)
for (const logLine of edge.split('\n').filter(line => line.includes('console.log'))) {
  assert.doesNotMatch(logLine, /PANEL_API_KEY|Authorization|PIX/)
}

const page = fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx', import.meta.url), 'utf8')
assert.doesNotMatch(page, /setInterval/)
assert.match(page, /hasValidConversationIdentifier/)
assert.match(page, /sendingRef\.current/)
assert.match(page, /historyRequestRef/)

console.log('WhatsApp stability contracts: OK')
