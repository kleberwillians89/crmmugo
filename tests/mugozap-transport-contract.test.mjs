import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts', import.meta.url), 'utf8')
const referenceUrl = new URL('../_reference/mugozap/mugo-zap/server/app.py', import.meta.url)
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/mugozap-transport-contract.json', import.meta.url), 'utf8'))
assert.equal(fixture.limitations.manual_send_returns_provider_message_id, false)
assert.deepEqual(fixture.limitations.template_allowlist, ['mugo_alerta_pagamento_pendente:pt_BR'])
assert.equal(fixture.limitations.webhook_validates_hmac, false)
assert.equal(fixture.limitations.webhook_resolves_tenant_by_phone_number_id, false)

// Contratos observados no repositório fornecido, não inferidos.
if (fs.existsSync(referenceUrl)) {
const app = fs.readFileSync(referenceUrl, 'utf8')
assert.match(app, /@app\.get\("\/health"\)/)
assert.match(app, /@app\.get\("\/api\/conversations"\)/)
assert.match(app, /@app\.get\("\/api\/messages"\)/)
assert.match(app, /@app\.post\("\/api\/conversations\/\{wa_id\}\/send"\)/)
assert.match(app, /@app\.post\("\/api\/conversations\/start-template"\)/)
assert.match(app, /return \{"ok": ok\}/, 'envio manual real não devolve provider_message_id')
assert.match(app, /template_name != "mugo_alerta_pagamento_pendente"/)
assert.match(app, /return \{"ok": True, "conversation": .*"provider_message_id": provider_message_id\}/)
assert.match(app, /@app\.get\("\/webhook"\)/)
assert.match(app, /@app\.post\("\/webhook"\)/)
assert.doesNotMatch(app, /X-Hub-Signature-256/, 'webhook legado não prova assinatura HMAC')
assert.match(app, /workspace_id = resolve_workspace_id\(\)/, 'webhook legado usa resolução default em vez de phone_number_id')
}

// O adapter preserva os endpoints compatíveis, mas não usa o retorno ambíguo do
// envio manual: chama Meta para obter wamid e só então grava o ledger canônico.
assert.match(edge, /list_conversations: \{ method: 'GET', path: \(\) => '\/api\/conversations' \}/)
assert.match(edge, /start_template_conversation: \{ method: 'POST', path: \(\) => '\/api\/conversations\/start-template'/)
assert.match(edge, /if\(operation==='send_manual_message'\)/)
assert.match(edge, /sendMetaMessage\(config/)
assert.match(edge, /providerMessageId=text\(sent\.body\?\.messages\?\.\[0\]\?\.id/)
assert.match(edge, /idempotency_key',idempotencyKey/)
assert.match(edge, /persistOutboundMessage/)

console.log('MugoZap transport contracts: ok')
