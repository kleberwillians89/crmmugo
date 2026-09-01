import assert from 'node:assert/strict'
import fs from 'node:fs'

/**
 * start_template_conversation (cobrança) e send_template_message (homologação)
 * deixaram de usar o MugoZap como transporte. Ambos disparam direto pela Meta
 * Cloud API (POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages)
 * pela infraestrutura já existente na Edge Function (metaConfig / sendMetaMessage /
 * metaFailure / sanitizedMetaError / persistOutboundMessage).
 *
 * Antes: montava `verifiedPayload` e caía no fetch genérico
 *   `${apiUrl}${path}` → POST /api/conversations/start-template → MugoZap → 500
 *   → convertido em INTERNAL_ERROR ("O MugoZap não conseguiu concluir a operação.").
 */

const edge = fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts', import.meta.url), 'utf8')

const between = (start, end) => {
  const a = edge.indexOf(start)
  const b = edge.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, `âncora ausente: ${start} … ${end}`)
  return edge.slice(a, b)
}
const startBlock = between("if (operation === 'start_template_conversation') {", "if(operation==='send_template_message'){")
const sendBlock = between("if(operation==='send_template_message'){", 'const identifierOperations =')
const manualBlock = between("if(operation==='send_manual_message'){", "if (!apiUrl || !panelKey) return fail('MUGOZAP_CONFIGURATION_MISSING'")

// ---------------------------------------------------------------------------
// 1 + 2 + 12: templates não tocam mais o MugoZap; o transporte MugoZap segue
// existindo apenas para as operações que ainda dependem dele.
for (const [name, block] of [['start_template_conversation', startBlock], ['send_template_message', sendBlock]]) {
  assert.doesNotMatch(block, /apiUrl|panelKey|X-Panel-Key|mugoZapHeaders|MUGOZAP_/, `${name} ainda referencia o transporte MugoZap`)
  assert.doesNotMatch(block, /\/api\/conversations\/start-template/, `${name} ainda aponta para o endpoint MugoZap`)
  assert.doesNotMatch(block, /INTERNAL_ERROR|upstreamFailure/, `${name} ainda cai no erro genérico do MugoZap`)
}
// O endpoint MugoZap de start-template só aparece nas 2 definições de rota (mantidas
// apenas para route.write / RBAC) — nunca mais como transporte.
assert.equal((edge.match(/path: \(\) => '\/api\/conversations\/start-template'/g) || []).length, 2)
assert.doesNotMatch(edge, /fetch\([^)]*\/api\/conversations\/start-template/)
// O fetch genérico do MugoZap continua no arquivo, para as demais operações.
assert.match(edge, /response=await fetch\(`\$\{apiUrl\}\$\{path\}`/)
assert.match(edge, /if \(!apiUrl \|\| !panelKey\) return fail\('MUGOZAP_CONFIGURATION_MISSING'/)
for (const op of ['list_conversations', 'assign_conversation', 'pause_automation', 'find_conversation_by_phone']) {
  assert.match(edge, new RegExp(`${op}: \\{ method: '(GET|PATCH|POST)', path:`), `rota MugoZap ${op} removida`)
}
// send_manual_message não foi alterada: continua Meta direto com a mesma forma.
assert.match(manualBlock, /sendMetaMessage\(config,\{messaging_product:'whatsapp'/)
assert.match(manualBlock, /providerMessageId=text\(sent\.body\?\.messages\?\.\[0\]\?\.id,200\)/)

// ---------------------------------------------------------------------------
// 3 + 4: ambos usam a Meta Cloud API, endpoint com PHONE_NUMBER_ID.
assert.match(edge, /const sendMetaMessage = async \(config: any, payload: unknown\) => \{[\s\S]*?fetch\(`https:\/\/graph\.facebook\.com\/\$\{config\.version\}\/\$\{config\.phoneNumberId\}\/messages`/)
assert.match(edge, /const phoneNumberId = text\(Deno\.env\.get\('PHONE_NUMBER_ID'\), 80\)/)
for (const [name, block] of [['start_template_conversation', startBlock], ['send_template_message', sendBlock]]) {
  assert.match(block, /metaConfig\(true\)/, `${name} não valida PHONE_NUMBER_ID via metaConfig(true)`)
  assert.match(block, /buildTemplateMetaPayload\(/, `${name} não monta o payload Meta de template`)
  assert.match(block, /sendMetaMessage\(\w*[cC]onfig\b/, `${name} não envia pela Meta`)
  assert.match(block, /graph\.facebook\.com\/\$\{\w*[cC]onfig\.version\}\/\$\{\w*[cC]onfig\.phoneNumberId\}\/messages/, `${name} não chama o endpoint /messages da Meta`)
}
// Helper puro: payload no formato exato exigido pela Meta.
assert.match(edge, /const buildTemplateMetaPayload = \(recipient: string, templateName: string, language: string, components: any\[\]\) => \(\{[\s\S]*?messaging_product: 'whatsapp'[\s\S]*?recipient_type: 'individual'[\s\S]*?type: 'template'[\s\S]*?language: \{ code: language \}/)
// Helper puro: componentes normalizados para lowercase (body / button copy_code / text / coupon_code).
assert.match(edge, /const metaTemplateComponents = \(components: any\) =>/)
assert.match(edge, /if \(parameterType === 'text'\) return \{ type: 'text', text: text\(parameter\?\.text, 2000\) \}/)
assert.match(edge, /if \(parameterType === 'coupon_code'\) return \{ type: 'coupon_code', coupon_code:/)
assert.match(edge, /return \{ type: 'button', sub_type: metaStatus\(component\?\.sub_type\)\.toLowerCase\(\), index: String\(/)

// Contrato Meta (reimplementação mínima do que os helpers produzem) — trava a forma.
const buildTemplateMetaPayload = (recipient, name, language, components) => ({
  messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'template',
  template: { name, language: { code: language }, ...(components.length ? { components } : {}) },
})
const bodyOnly = buildTemplateMetaPayload('5511999990000', 'mugo_alerta_pagamento_pendente', 'pt_BR', [
  { type: 'body', parameters: [{ type: 'text', text: 'Kleber' }] },
])
assert.deepEqual(bodyOnly, {
  messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511999990000', type: 'template',
  template: { name: 'mugo_alerta_pagamento_pendente', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Kleber' }] }] },
})
const noParams = buildTemplateMetaPayload('5511999990000', 'hello_world', 'pt_BR', [])
assert.equal('components' in noParams.template, false, 'template sem parâmetros não envia components')

// ---------------------------------------------------------------------------
// 5: nenhuma linha com console.log expõe token/Authorization.
for (const line of edge.split('\n')) {
  if (!line.includes('console.log')) continue
  assert.doesNotMatch(line, /META_ACCESS_TOKEN|accessToken|Authorization|Bearer/, `log expõe credencial: ${line.trim().slice(0, 120)}`)
}
// O token só é usado no header da chamada, nunca no corpo/log.
assert.match(edge, /headers: \{ Authorization: `Bearer \$\{config\.accessToken\}`, 'Content-Type': 'application\/json' \}/)

// ---------------------------------------------------------------------------
// 6 + 7: provider_message_id vem de body.messages[0].id; sem ele => UNCONFIRMED.
assert.match(startBlock, /const collectionMessageId = text\(collectionSend\.body\?\.messages\?\.\[0\]\?\.id, 200\)/)
assert.match(startBlock, /if \(!collectionMessageId\) \{[\s\S]*?MESSAGE_SEND_UNCONFIRMED/)
const startAfterProviderId = startBlock.slice(startBlock.indexOf('const collectionMessageId ='))
assert.doesNotMatch(startAfterProviderId, /CRM_AUDIT_FAILED/, 'start_template_conversation não pode usar CRM_AUDIT_FAILED após a Meta')
assert.match(startAfterProviderId, /MESSAGE_PERSISTENCE_UNCONFIRMED/)
assert.doesNotMatch(startBlock.match(/if \(!collectionMessageId\) \{[\s\S]*?\n      \}/)?.[0] || '', /status: 'failed'/, 'resultado sem provider_message_id deve continuar bloqueando duplicata')
assert.match(sendBlock, /const homologationMessageId=text\(homologationSend\.body\?\.messages\?\.\[0\]\?\.id,200\)/)
assert.match(sendBlock, /if\(!homologationMessageId\)return fail\('MESSAGE_SEND_UNCONFIRMED'/)

// ---------------------------------------------------------------------------
// 8: erro confirmado da Meta -> metaFailure (código Meta preservado), nunca genérico.
for (const [name, block] of [['start_template_conversation', startBlock], ['send_template_message', sendBlock]]) {
  assert.match(block, /if\s*\(!\w+Send\.response\.ok\)[\s\S]*?metaFailure\(\w+Send\.response\.status, ?\w+Send\.body, ?requestId\)/, `${name} não usa metaFailure no erro da Meta`)
}
// start: além de metaFailure, marca a reserva com o código Meta sanitizado.
assert.match(startBlock, /const collectionMetaError = sanitizedMetaError\(collectionSend\.body\)/)
assert.match(startBlock, /error_code: collectionMetaError\.code \? `META_\$\{collectionMetaError\.code\}` : 'META_API_ERROR'/)
assert.match(startBlock, /action: 'template_send_failed'/)
assert.match(startBlock, /status: 'failed', collection_stage: 'failed'/)
// metaFailure devolve códigos reais da Meta, não do MugoZap.
assert.match(edge, /return fail\('META_TOKEN_EXPIRED'/)
assert.match(edge, /return fail\('META_PERMISSION_MISSING'/)
assert.match(edge, /return fail\('META_RESOURCE_INVALID'/)
assert.match(edge, /return fail\('META_API_ERROR'/)

// ---------------------------------------------------------------------------
// 9: a reserva em whatsapp_collection_alerts acontece ANTES do envio.
const reservationAt = startBlock.indexOf("from('whatsapp_collection_alerts').insert({")
const firstSendAt = startBlock.indexOf('sendMetaMessage(config')
assert.ok(reservationAt >= 0 && firstSendAt > reservationAt, 'a reserva deve preceder o envio pela Meta')
assert.match(startBlock, /alertReservationId = reservation\.data\.id/)
// sem service role key para o histórico canônico => não envia.
assert.match(startBlock, /if \(!serviceKey\) \{[\s\S]*?SUPABASE_SERVICE_ROLE_KEY_MISSING[\s\S]*?\}\n\n\s+\/\/ ===== Transporte direto Meta/)
assert.match(sendBlock, /if\(!serviceKey\)return fail\('SUPABASE_SERVICE_ROLE_KEY_MISSING'[\s\S]*?\)\n\s+const homologationConfig/)

// ---------------------------------------------------------------------------
// 10: start persiste após a confirmação; send_template atualiza a reserva existente.
const startSendAt = startBlock.search(/sendMetaMessage\(\w*[cC]onfig\b/)
const startIdGuardAt = startBlock.search(/if\s*\(!\w+MessageId\)/)
const startPersistAt = startBlock.lastIndexOf('persistOutboundMessage({')
assert.ok(startSendAt >= 0 && startIdGuardAt > startSendAt && startPersistAt > startIdGuardAt, 'start_template_conversation: persistência deve vir após a confirmação')
// start: atualização canônica da reserva após sucesso.
assert.match(startBlock, /provider_message_id: collectionMessageId, template_status: 'APPROVED'/)
assert.match(startBlock, /collection_stage: 'waiting_customer', action: 'template_sent', status: 'sent', sent_at: new Date\(\)\.toISOString\(\)/)
assert.match(startBlock, /raw_response: \{ provider: 'meta', provider_message_id: collectionMessageId/)
assert.match(startBlock, /error_code: null, error_message: null/)
// a conversa devolvida ao frontend é a canônica do CRM (persistOutboundMessage).
assert.match(startBlock, /return json\(\{ ok: true, data: \{ provider_message_id: collectionMessageId, message_id: collectionMessageId, status: 'accepted', conversation: canonical\.conversation, message: canonical\.message \} \}\)/)
assert.match(sendBlock, /conversation:canonical\.conversation,message:canonical\.message/)

// ---------------------------------------------------------------------------
// 11: TIMEOUT após o disparo => sem retry automático, estado reconciliável.
assert.match(edge, /const sendMetaMessage = async[\s\S]*?\n\}/)
const sendMetaBody = between('const sendMetaMessage = async (config: any, payload: unknown) => {', '// Índice do botão')
assert.doesNotMatch(sendMetaBody, /for\s*\(|while\s*\(|retry|attempt/i, 'sendMetaMessage não pode ter retry')
assert.equal((sendMetaBody.match(/await fetch\(/g) || []).length, 1, 'sendMetaMessage faz exatamente uma chamada')
for (const [name, block] of [['start_template_conversation', startBlock], ['send_template_message', sendBlock]]) {
  // janela do catch de timeout do ENVIO (ancorada no comentário "Timeout ... disparo")
  const from = block.search(/Timeout (?:DEPOIS|depois) do disparo/)
  assert.ok(from >= 0, `${name}: catch de timeout do envio ausente`)
  const cat = block.slice(from, block.indexOf('\n      }', from) + 8)
  assert.doesNotMatch(cat, /sendMetaMessage|for\s*\(|while\s*\(/, `${name}: timeout não pode reenviar`)
  assert.match(cat, /META_TIMEOUT/, `${name}: timeout deve devolver META_TIMEOUT`)
  assert.match(block, /não será reenviada automaticamente|Verifique o histórico/, `${name}: orientar verificação do histórico`)
}
// start: no timeout a reserva NÃO vira 'failed' (pode ter sido enviada) — fica reconciliável.
assert.match(startBlock, /timedOut\s*\n?\s*\?\s*\{ action: 'template_send_unconfirmed', error_code: 'META_TIMEOUT'/)

// ===========================================================================
// HARDENING send_template_message: reserva canônica ANTES do envio (fecha a
// janela de duplicidade quando a Meta aceita mas o registro pós-envio falha).
// ===========================================================================

// (a) idempotência de entrada: mesmo contrato de send_manual_message.
assert.match(sendBlock, /const priorSend=await client\.from\('whatsapp_messages'\)\.select\('provider_message_id,status,conversation_id'\)[\s\S]*?\.eq\('idempotency_key',idempotencyKey\)\.maybeSingle\(\)/)
assert.match(sendBlock, /if\(priorSend\.data\?\.provider_message_id\)return json\(\{ok:true,data:\{already_sent:true/)
// reserva incerta ('queued') bloqueia retry cego; 'failed' (Meta recusou sem aceitar) libera nova tentativa.
assert.match(sendBlock, /if\(priorSend\.data&&priorSend\.data\.status!=='failed'\)return fail\('SEND_OUTCOME_UNKNOWN'[^)]*409\)/)
assert.match(sendBlock, /if\(priorSend\.data\?\.status==='failed'\)\s*\n\s*await createClient\([\s\S]*?\.update\(\{status:'queued',error_code:null,error_message:null,failed_at:null\}\)[\s\S]*?\.eq\('idempotency_key',idempotencyKey\)/)

// (1) a RESERVA (providerMessageId:null, status:'queued') ocorre ANTES de sendMetaMessage.
const reserveAt = sendBlock.indexOf("providerMessageId:null,\n          idempotencyKey,messageType:'template'")
const sendAt = sendBlock.indexOf('sendMetaMessage(homologationConfig,homologationMetaPayload)')
assert.ok(reserveAt >= 0, 'reserva canônica queued ausente em send_template_message')
assert.ok(sendAt > reserveAt, 'a reserva canônica deve preceder sendMetaMessage')
assert.match(sendBlock, /providerMessageId:null,[\s\S]*?status:'queued'\}\)/)

// (2) se a reserva falhar, sendMetaMessage NÃO é chamado (o catch retorna).
assert.match(
  sendBlock,
  /try\{\s*canonicalReservation=await persistOutboundMessage\(\{[\s\S]*?status:'queued'\}\)\s*\}catch\(error\)\{\s*return fail\('CRM_AUDIT_FAILED','Não foi possível reservar[^)]*nada foi enviado[\s\S]*?\}/,
  'reserva sem try/catch-return antes do envio',
)
const reserveCatch = sendBlock.slice(sendBlock.indexOf("try{\n        canonicalReservation=await persistOutboundMessage"), sendAt)
assert.doesNotMatch(reserveCatch, /sendMetaMessage/, 'nada pode enviar entre a reserva e o guard de erro dela')

// (3) mesma idempotency_key => atualiza o MESMO whatsapp_message.
assert.match(edge, /onConflict: idempotencyKey \? 'connection_id,idempotency_key' : 'connection_id,provider_message_id'/)
assert.equal((sendBlock.match(/idempotencyKey,messageType:'template'/g) || []).length, 1, 'a reserva deve usar a idempotency_key')
assert.ok(sendBlock.includes(".eq('connection_id',canonicalReservation.connection_id)\n            .eq('idempotency_key',idempotencyKey).is('provider_message_id',null)"), 'finalização não usa connection_id + idempotency_key')

// (4) erro HTTP confirmado da Meta => reserva vira failed (não fica queued eternamente).
assert.match(
  sendBlock,
  /if\(!homologationSend\.response\.ok\)\{[\s\S]*?\.from\('whatsapp_messages'\)\s*\.update\(\{status:'failed',error_code:[\s\S]*?\.eq\('idempotency_key',idempotencyKey\)\.is\('provider_message_id',null\)[\s\S]*?return metaFailure\(/,
  'erro confirmado da Meta não marca a reserva como failed',
)

// (5) o catch de timeout de send_template_message não contém segunda chamada sendMetaMessage.
const sendTimeoutCatch = sendBlock.match(/catch\(error\)\{\s*\/\/ 5\)[\s\S]*?\}\n/)
assert.ok(sendTimeoutCatch, 'catch de timeout de send_template_message ausente')
assert.doesNotMatch(sendTimeoutCatch[0], /sendMetaMessage|persistOutboundMessage/, 'timeout não pode reenviar nem regravar')

// (6) persistência pós-Meta atualiza a reserva e pode repetir somente a gravação no banco.
assert.match(sendBlock, /for\(let attempt=0;attempt<3;attempt\+\+\)/)
assert.match(sendBlock, /\.from\('whatsapp_messages'\)\.update\(\{provider_message_id:homologationMessageId,status:'accepted'/)
assert.match(sendBlock, /MESSAGE_PERSISTENCE_UNCONFIRMED/)
assert.match(sendBlock, /provider_message_id:homologationMessageId/)
const postMetaBlock = sendBlock.slice(sendBlock.indexOf('const homologationMessageId='))
assert.doesNotMatch(postMetaBlock, /CRM_AUDIT_FAILED/, 'falha pós-Meta não pode usar CRM_AUDIT_FAILED')

// (7) NENHUMA possibilidade de dois envios na mesma execução.
assert.equal((sendBlock.match(/await sendMetaMessage\(/g) || []).length, 1, 'send_template_message deve chamar sendMetaMessage exatamente uma vez')
assert.equal((startBlock.match(/await sendMetaMessage\(/g) || []).length, 1, 'start_template_conversation deve chamar sendMetaMessage exatamente uma vez')

// start_template_conversation permanece como aprovado: sem reserva queued em
// whatsapp_messages, sem pre-check SEND_OUTCOME_UNKNOWN.
assert.doesNotMatch(startBlock, /status:\s*'queued'|SEND_OUTCOME_UNKNOWN|from\('whatsapp_messages'\)\.select/)

// ---------------------------------------------------------------------------
// Contrato de ordenação (reimplementação mínima do fluxo do bloco) — trava:
// reserva antes do envio; reserva falha => sem envio; 1 envio por execução;
// mesma chave nunca reenvia; erro confirmado => failed; sucesso => mesma chave.
const runSendTemplate = async ({ store, key, reserveFails = false, finalPersistFails = false, meta }) => {
  const calls = { send: 0, persist: 0, persistKeys: [] }
  const persist = async ({ idempotencyKey, providerMessageId, status }) => {
    calls.persist += 1
    calls.persistKeys.push(idempotencyKey)
    if (reserveFails && providerMessageId === null) throw new Error('CRM_CONNECTION_NOT_FOUND')
    if (finalPersistFails && providerMessageId) throw new Error('DATABASE_TIMEOUT')
    const row = store.get(idempotencyKey) || { idempotency_key: idempotencyKey }
    row.status = status
    if (providerMessageId) row.provider_message_id = providerMessageId
    store.set(idempotencyKey, row)
    return { conversation_id: 'conv-1', conversation: {}, message: row }
  }
  const sendMeta = async () => { calls.send += 1; if (meta.throws) throw Object.assign(new DOMException('t', 'TimeoutError')); return meta.response }
  // pré-check idempotência
  const prior = store.get(key)
  if (prior?.provider_message_id) return { code: 'ALREADY_SENT', calls }
  if (prior) return { code: 'SEND_OUTCOME_UNKNOWN', calls }
  // reserva ANTES do envio
  try { await persist({ idempotencyKey: key, providerMessageId: null, status: 'queued' }) }
  catch { return { code: 'CRM_AUDIT_FAILED', calls } }
  // envio (uma vez)
  let res
  try { res = await sendMeta() } catch { return { code: 'META_TIMEOUT', calls } }
  if (!res.ok) { const r = store.get(key); r.status = 'failed'; return { code: 'META_API_ERROR', calls } }
  const id = res.body?.messages?.[0]?.id
  if (!id) return { code: 'MESSAGE_SEND_UNCONFIRMED', calls }
  try { await persist({ idempotencyKey: key, providerMessageId: id, status: 'accepted' }) }
  catch { return { code: 'MESSAGE_PERSISTENCE_UNCONFIRMED', id, calls } }
  return { code: 'OK', id, calls }
}
// Meta confirmou provider_message_id, mas a gravação final falhou: nunca incentiva retry.
{
  const store = new Map()
  const r = await runSendTemplate({ store, key: 'k-persist-fail', finalPersistFails: true, meta: { response: { ok: true, body: { messages: [{ id: 'wamid.known' }] } } } })
  assert.equal(r.code, 'MESSAGE_PERSISTENCE_UNCONFIRMED')
  assert.equal(r.id, 'wamid.known')
  assert.equal(r.calls.send, 1)
}

// reserva falha => sendMetaMessage não é chamado
{
  const store = new Map()
  const r = await runSendTemplate({ store, key: 'k-reserve-fail', reserveFails: true, meta: { response: { ok: true, body: { messages: [{ id: 'x' }] } } } })
  assert.equal(r.code, 'CRM_AUDIT_FAILED')
  assert.equal(r.calls.send, 0, 'reserva falhou mas ainda tentou enviar')
}
// sucesso: 1 envio, mesma chave nas duas gravações, uma única whatsapp_message
{
  const store = new Map()
  const r = await runSendTemplate({ store, key: 'k-ok', meta: { response: { ok: true, body: { messages: [{ id: 'wamid.1' }] } } } })
  assert.equal(r.code, 'OK'); assert.equal(r.calls.send, 1)
  assert.deepEqual(r.calls.persistKeys, ['k-ok', 'k-ok'])
  assert.equal(store.size, 1); assert.equal(store.get('k-ok').provider_message_id, 'wamid.1')
}
// meta aceita mas gravação pós-envio falha (janela original) => registro canônico existe,
// retry com a MESMA chave nunca reenvia
{
  const store = new Map()
  store.set('k-window', { idempotency_key: 'k-window', status: 'queued' }) // reserva feita, update final falhou
  const retry = await runSendTemplate({ store, key: 'k-window', meta: { response: { ok: true, body: { messages: [{ id: 'wamid.dup' }] } } } })
  assert.equal(retry.code, 'SEND_OUTCOME_UNKNOWN')
  assert.equal(retry.calls.send, 0, 'retry com mesma chave NÃO pode reenviar')
}
// timeout: exatamente 1 envio, sem segunda tentativa
{
  const store = new Map()
  const r = await runSendTemplate({ store, key: 'k-timeout', meta: { throws: true } })
  assert.equal(r.code, 'META_TIMEOUT'); assert.equal(r.calls.send, 1)
}
// erro confirmado da Meta => reserva marcada failed
{
  const store = new Map()
  const r = await runSendTemplate({ store, key: 'k-fail', meta: { response: { ok: false, body: { error: { code: 131009 } } } } })
  assert.equal(r.code, 'META_API_ERROR'); assert.equal(r.calls.send, 1)
  assert.equal(store.get('k-fail').status, 'failed')
}
// já confirmado antes => idempotente, sem envio
{
  const store = new Map()
  store.set('k-done', { idempotency_key: 'k-done', status: 'accepted', provider_message_id: 'wamid.old' })
  const r = await runSendTemplate({ store, key: 'k-done', meta: { throws: true } })
  assert.equal(r.code, 'ALREADY_SENT'); assert.equal(r.calls.send, 0)
}

console.log('MugoZap template Meta transport: ok')
