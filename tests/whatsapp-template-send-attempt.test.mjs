import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  createTemplateSendAttempt,
  isAmbiguousTemplateSendOutcome,
  templateSendFingerprint,
} from '../src/services/whatsapp/templateSendAttempt.js'

let sequence = 0
const attempt = createTemplateSendAttempt(() => `logical-attempt-${++sequence}`)
const message = (templateName = 'template_a', recipient = '5511999999999', value = 'Ana') => templateSendFingerprint({
  recipient,
  templateName,
  language: 'pt_BR',
  components: [{ type: 'body', parameters: [{ type: 'text', text: value }] }],
})

// Dois cliques/retries seguros da mesma tentativa reutilizam a chave.
assert.equal(attempt.begin(message()), 'logical-attempt-1')
assert.equal(attempt.begin(message()), 'logical-attempt-1')

// Todo resultado ambíguo preserva e bloqueia a tentativa atual.
for (const code of ['META_TIMEOUT', 'MESSAGE_SEND_UNCONFIRMED', 'SEND_OUTCOME_UNKNOWN', 'MESSAGE_PERSISTENCE_UNCONFIRMED']) {
  assert.equal(isAmbiguousTemplateSendOutcome({ code }), true, `${code} deveria ser ambíguo`)
  attempt.markAmbiguous(message())
  assert.equal(attempt.isAmbiguous(message()), true)
  assert.equal(attempt.begin(message()), 'logical-attempt-1')
}

// Sucesso libera uma futura mensagem intencional, mesmo com conteúdo idêntico.
attempt.markSuccess()
assert.equal(attempt.begin(message()), 'logical-attempt-2')

// Template, destinatário ou parâmetros diferentes constituem nova tentativa.
assert.equal(attempt.begin(message('template_b')), 'logical-attempt-3')
assert.equal(attempt.begin(message('template_b', '5511888888888')), 'logical-attempt-4')
assert.equal(attempt.begin(message('template_b', '5511888888888', 'Bia')), 'logical-attempt-5')

// Registry da sessão: close/unmount, navegação SPA e reload da mesma aba criam novas
// instâncias do controlador, mas recuperam a tentativa ambígua e a mesma chave.
const sessionData = new Map()
globalThis.sessionStorage = {
  getItem: key => sessionData.get(key) ?? null,
  setItem: (key,value) => sessionData.set(key,String(value)),
  removeItem: key => sessionData.delete(key),
}
let sessionSequence = 0
const sessionKey = () => `session-attempt-${String(++sessionSequence).padStart(4, '0')}`
const sensitiveRecipient = '5511987654321'
const sensitiveValue = 'Cliente Sigiloso'
const persistedFingerprint = message('template_session', sensitiveRecipient, sensitiveValue)

const openedDrawer = createTemplateSendAttempt(sessionKey)
const originalKey = openedDrawer.begin(persistedFingerprint)
openedDrawer.markAmbiguous(persistedFingerprint)
openedDrawer.reset() // close/unmount não pode apagar o registry

const reopenedDrawer = createTemplateSendAttempt(sessionKey)
assert.equal(reopenedDrawer.isAmbiguous(persistedFingerprint), true, 'close → reopen perdeu o bloqueio')
assert.equal(reopenedDrawer.begin(persistedFingerprint), originalKey, 'close → reopen criou outra chave')

const afterSpaNavigation = createTemplateSendAttempt(sessionKey)
assert.equal(afterSpaNavigation.isAmbiguous(persistedFingerprint), true, 'navegação SPA perdeu o bloqueio')
assert.equal(afterSpaNavigation.begin(persistedFingerprint), originalKey, 'navegação SPA criou outra chave')

// Uma nova instância lê diretamente o sessionStorage, equivalente ao bootstrap após
// refresh da mesma aba. O storage contém somente fingerprint opaco/chave/estado.
const afterRefresh = createTemplateSendAttempt(sessionKey)
assert.equal(afterRefresh.isAmbiguous(persistedFingerprint), true, 'refresh perdeu o bloqueio da sessão')
assert.equal(afterRefresh.begin(persistedFingerprint), originalKey, 'refresh criou outra chave')
const serializedSession = [...sessionData.values()].join('\n')
assert.doesNotMatch(serializedSession, new RegExp(sensitiveRecipient))
assert.doesNotMatch(serializedSession, new RegExp(sensitiveValue))
assert.match(persistedFingerprint, /^template-send-[a-f0-9]{32}$/)

afterRefresh.markSuccess()
assert.equal(afterRefresh.isAmbiguous(persistedFingerprint), false, 'sucesso não limpou o bloqueio persistido')
assert.notEqual(afterRefresh.begin(persistedFingerprint), originalKey, 'sucesso não liberou uma nova tentativa')
delete globalThis.sessionStorage

const drawer = fs.readFileSync(new URL('../src/components/WhatsAppConversationTemplateDrawer.jsx', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../src/components/WhatsAppTemplateSendModal.jsx', import.meta.url), 'utf8')
const page = fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx', import.meta.url), 'utf8')
for (const source of [drawer, modal]) {
  assert.match(source, /createTemplateSendAttempt/)
  assert.match(source, /idempotency_key:/)
  assert.match(source, /isAmbiguousTemplateSendOutcome/)
  assert.match(source, /O resultado do envio ainda não foi confirmado\. Verifique o histórico antes de tentar novamente\./)
  assert.match(source, /outcomePending/)
}
const approvedSend = page.slice(page.indexOf('async function sendApprovedTemplate'), page.indexOf('const checkTemplateTestAccess'))
assert.doesNotMatch(approvedSend, /crypto\.randomUUID/)
assert.match(approvedSend, /IDEMPOTENCY_KEY_MISSING/)

console.log('WhatsApp template logical send attempt: OK')
