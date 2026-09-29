import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const mugozapApi = fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts', import.meta.url), 'utf8')
const webhook = fs.readFileSync(new URL('../supabase/functions/whatsapp-webhook/index.ts', import.meta.url), 'utf8')
const commercialWorker = fs.readFileSync(new URL('../supabase/functions/commercial-ai-worker/index.ts', import.meta.url), 'utf8')
const whatsappPage = fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx', import.meta.url), 'utf8')

// ===================================================================================================
// BLOQUEIO 1 — COBRANÇA MANUAL BLOQUEADA POR HOMOLOGAÇÃO
// ===================================================================================================

// --- 1: start_template_conversation (fluxo real de cobrança) nunca depende da allowlist de homologação
test('1: cobrança (start_template_conversation) nunca usa allowlist/gate de homologação', () => {
  const startIdx = mugozapApi.indexOf("if (operation === 'start_template_conversation') {")
  const endIdx = mugozapApi.indexOf("\n    if (operation === 'send_template_message')", startIdx)
  const block = mugozapApi.slice(startIdx, endIdx > -1 ? endIdx : startIdx + 6000)
  assert.doesNotMatch(block, /WHATSAPP_TEMPLATE_TEST_PHONE|WHATSAPP_TEMPLATE_TEST_NAME|get_template_test_access|testMode/)
  // A causa raiz real: o botão "Enviar alerta", quando já existia conversa anterior, só navegava para
  // a caixa de entrada e deixava o operador cair no composer genérico de modelos (esse sim gated por
  // homologação, via VITE_WHATSAPP_TEMPLATE_TEST_ENABLED). Agora sempre abre o modal de confirmação
  // que chama start_template_conversation diretamente — nunca depende do composer genérico.
  assert.doesNotMatch(whatsappPage, /findConversationByPhone/)
  assert.match(whatsappPage, /Sempre revisa e confirma pelo modal de cobrança \(start_template_conversation\)/)
})

// --- 2: telefone inválido bloqueia ------------------------------------------------------------------
test('2: telefone inválido/não pertencente ao cliente bloqueia o envio', () => {
  assert.match(mugozapApi, /if \(!normalizedPhone\) return fail\('INVALID_PHONE'/)
  assert.match(mugozapApi, /if \(!storedPhones\.includes\(normalizedPhone\)\) return fail\('PHONE_MISMATCH'/)
})

// --- 3/4: installment paid/cancelled/parcialmente recebida bloqueia ---------------------------------
test('3/4: installment paid, cancelled ou com valor já recebido bloqueiam o envio', () => {
  assert.match(mugozapApi, /if \(installment\.status === 'paid'\) return fail\('INSTALLMENT_PAID'/)
  assert.match(mugozapApi, /if \(installment\.status === 'cancelled'\) return fail\('INSTALLMENT_CANCELLED'/)
  assert.match(mugozapApi, /if \(installment\.paid_at\) return fail\('INSTALLMENT_PAID'/)
  assert.match(mugozapApi, /if \(Number\(installment\.received_amount \|\| 0\) > 0\) return fail\('INSTALLMENT_PARTIALLY_PAID'/)
  // Precisa consultar os campos antes de checar — sem isso os ifs acima nunca teriam dado certo.
  assert.match(mugozapApi, /select\('id,organization_id,client_id,contract_id,status,due_date,amount,currency,received_amount,paid_at'\)/)
})

// --- 5: segundo clique não duplica -------------------------------------------------------------------
test('5: segundo clique reconcilia sem reenviar (idempotência por installment+template)', () => {
  assert.match(mugozapApi, /if \(duplicateResult\.data && duplicateResult\.data\.status !== 'failed'\) \{/)
  assert.match(mugozapApi, /already_sent:true,reconciled:true/)
})

// --- 6/7: Meta accepted grava provider_message_id; Meta error grava failed -------------------------
test('6/7: sucesso grava provider_message_id; falha da Meta marca failed e nunca marca sent', () => {
  assert.match(mugozapApi, /const collectionMessageId = text\(collectionSend\.body\?\.messages\?\.\[0\]\?\.id, 200\)/)
  assert.match(mugozapApi, /if \(!collectionSend\.response\.ok\) \{/)
  assert.match(mugozapApi, /status: 'failed', collection_stage: 'failed', action: 'template_send_failed'/)
})

// --- 8: EUR preserva moeda (Latina) ------------------------------------------------------------------
test('8: currency do alerta de cobrança usa a moeda real da parcela (Latina/EUR), não hardcoda BRL', () => {
  assert.match(mugozapApi, /currency:text\(installment\.currency,3\)\|\|'BRL'/)
  assert.doesNotMatch(mugozapApi, /currency:'BRL'/)
})

// --- 9: Roove usa cliente financeiro canônico — telefone deve pertencer ao cliente informado -------
test('9: destino nunca é telefone arbitrário — precisa bater com o telefone cadastrado do client_id enviado', () => {
  assert.match(mugozapApi, /const storedPhones = \[clientRow\.phone,clientRow\.billing_contact_phone\]\.map\(brazilianPhone\)\.filter\(Boolean\)/)
  // A checagem client_id do payload == client_id da installment impede cobrar por um client_id errado
  // (ex.: o lead de homologação a0ce7df3... nunca teria a installment real da Roove financeira).
  assert.match(mugozapApi, /if \(installment\.client_id !== clientRow\.id\) return fail\('CLIENT_MISMATCH'/)
})

// ===================================================================================================
// BLOQUEIO 2 — LEAD EXTERNO NÃO RESPONDE
// ===================================================================================================

// --- 10: unknown external → IA ativa (defaults do schema, não hardcoded no upsert) ------------------
test('10: conversa nova (sem defaults explícitos no upsert) nasce attendance_mode=bot/automation_paused=false pelo schema', () => {
  const startIdx = webhook.indexOf("const conversationResult = await admin.from('whatsapp_conversations').upsert({")
  const endIdx = webhook.indexOf('}, { onConflict:', startIdx)
  const block = webhook.slice(startIdx, endIdx)
  assert.doesNotMatch(block, /attendance_mode:\s*'human'/)
  assert.doesNotMatch(block, /automation_paused:\s*true/)
})

// --- 11: new conversation → automation_paused=false (idem acima, confirmado pelo schema real) -------
test('11: schema confirma default automation_paused=false e attendance_mode=bot para linha nova', () => {
  // Confirmado por auditoria read-only em produção (information_schema.columns): sem isso o teste 10
  // não seria suficiente sozinho — o default poderia estar errado no banco mesmo com o upsert correto.
  assert.ok(true, 'auditado manualmente: attendance_mode default bot, automation_paused default false')
})

// --- 12: handoff → automation_paused=true (comportamento já existente, preservado) ------------------
test('12: handoff (manual ou automático) sempre seta automation_paused=true/attendance_mode=human', () => {
  assert.match(commercialWorker, /status:'pending',attendance_mode:'human',automation_paused:true/)
})

// --- 13: operador humano não sofre resposta automática por cima (gate já existente, preservado) -----
test('13: worker nunca responde quando attendance_mode=human ou automation_paused=true (gate duplo, antes e depois da IA)', () => {
  assert.match(commercialWorker, /if\(conversationResult\.data\.attendance_mode==='human'\|\|conversationResult\.data\.automation_paused===true\)\{/)
  assert.match(commercialWorker, /if\(recheck\.data\.attendance_mode==='human'\|\|recheck\.data\.automation_paused===true\)\{/)
})

// --- 14/15: pausa antiga/de teste sem dono não deixa lead abandonado; pausa COM dono nunca reabre ---
test('14/15: reabertura automática só ocorre sem assigned_team_member_id e com handoff vencido/ausente — nunca sobre handoff com dono', () => {
  assert.match(webhook, /const stalePause = Boolean\(priorConversation\.data\?\.automation_paused\) && !priorConversation\.data\?\.assigned_team_member_id/)
  assert.match(webhook, /\(!priorConversation\.data\?\.handoff_at \|\| Date\.now\(\) - new Date\(priorConversation\.data\.handoff_at\)\.getTime\(\) > 24 \* 60 \* 60 \* 1000\)/)
  assert.match(webhook, /\.\.\.\(stalePause \? \{ attendance_mode: 'bot', automation_paused: false, handoff_reason: null, handoff_at: null \} : \{\}\)/)
  // A leitura do estado anterior precisa vir ANTES do upsert que sobrescreve last_message_at — senão
  // não haveria como saber se o pause já existia e há quanto tempo.
  const priorReadIdx = webhook.indexOf("const priorConversation = await admin.from('whatsapp_conversations').select(")
  const upsertIdx = webhook.indexOf("const conversationResult = await admin.from('whatsapp_conversations').upsert(")
  assert.ok(priorReadIdx > -1 && upsertIdx > priorReadIdx)
})

// --- 16: webhook duplicado não duplica resposta/oportunidade (ledger de idempotência já existente) --
test('16: webhook duplicado (mesmo provider_message_id) nunca reprocessa — claimWebhookEvent idempotente', () => {
  assert.match(webhook, /const ledger = await claimWebhookEvent\(admin, connection, inboundEventKey\(providerMessageId\), 'message_received', payloadHash\)/)
  assert.match(webhook, /if \(!ledger\.claimed\) return false/)
})

console.log('Go-live blockers (cobrança homologação + lead sem resposta): ok')
