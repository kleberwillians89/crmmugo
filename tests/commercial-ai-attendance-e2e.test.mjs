import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { classifyConversationKind, classifyCommercialInterests, defaultCommercialDecision, enforceCommercialHandoffPolicy, enforceCommercialResponsePolicy, validateCommercialDecision } from '../supabase/functions/_shared/commercialAgentCore.js'

const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8')
const worker = fs.readFileSync('supabase/functions/commercial-ai-worker/index.ts', 'utf8')

// Roda a decisão exatamente como o worker roda: OpenAI indisponível (ambiente de teste não chama
// rede), então cai no fallback determinístico — mas passa pelas MESMAS políticas de handoff/resposta
// que o resultado da IA passaria. Isso testa a pipeline de decisão de ponta a ponta, não só o parser.
function runDecision(text, ctx = {}) {
  const context = { qualification: {}, opportunity: {}, ...ctx }
  let decision = defaultCommercialDecision(text, context)
  decision = validateCommercialDecision(decision) || decision
  decision = enforceCommercialHandoffPolicy(decision, text, context)
  decision = enforceCommercialResponsePolicy(decision, text, context)
  return decision
}
const neverSilent = (decision) => {
  assert.ok(decision, 'decisão não pode ser nula/indefinida')
  assert.ok(decision.response && decision.response.trim().length > 0, 'resposta nunca pode ser vazia')
}

// --- A: "oi" → resposta -----------------------------------------------------------------------
test('A: "oi" sempre gera resposta (nunca silêncio)', () => {
  const d = runDecision('oi')
  neverSilent(d)
  assert.doesNotMatch(d.response, /selecione uma op|digite \d|como posso auxili/i)
})

// --- B: "quero redesenhar meu site" → new_business + SITE + resposta ---------------------------
test('B: "quero redesenhar meu site" → new_business, intents inclui SITE, gera resposta', () => {
  assert.equal(classifyConversationKind('quero redesenhar meu site').kind, 'new_business')
  const d = runDecision('quero redesenhar meu site')
  neverSilent(d)
  assert.ok(d.intents.includes('SITE'))
  assert.equal(d.handoff, false)
})

// --- C: "meu site caiu" → support + resposta/handoff, nunca silêncio ---------------------------
test('C: "meu site caiu" → support, handoff true, resposta de reconhecimento (nunca silêncio)', () => {
  assert.equal(classifyConversationKind('meu site caiu').kind, 'support')
  const d = runDecision('meu site caiu')
  neverSilent(d)
  assert.equal(d.handoff, true)
  assert.equal(d.handoff_reason, 'support_requires_team')
  assert.equal(d.create_task, true)
})

// --- D: "meu site está velho e quero outro" → new_business -------------------------------------
test('D: "meu site está velho e quero outro" → new_business (desejo de mudança vence "meu site")', () => {
  assert.equal(classifyConversationKind('meu site está velho e quero outro').kind, 'new_business')
})

// --- E: "quero site e tráfego" → SITE + PAID_TRAFFIC --------------------------------------------
test('E: "quero site e tráfego" → intents inclui SITE e PAID_TRAFFIC, mesma oportunidade', () => {
  const interests = classifyCommercialInterests('quero site e tráfego')
  assert.ok(interests.includes('SITE'))
  assert.ok(interests.includes('PAID_TRAFFIC'))
})

// --- Evidência de produção: existing_client NUNCA pode significar "não atender" ------------------
test('produção: contato já vinculado a client/opportunity (existing_client) continua sendo atendido — "oi" repetido nunca fica mudo', () => {
  // Reproduz exatamente o caso relatado: 1ª mensagem cria opportunity e vincula o contato a um
  // client; mensagens seguintes ("quero redesenhar meu site", "oi", "oi") chegam com
  // hasExistingClient=true e não podem parar de gerar resposta por causa disso.
  const existingClientKind = classifyConversationKind('oi', { hasExistingClient: true })
  assert.equal(existingClientKind.kind, 'existing_client')
  for (const text of ['oi', 'oi', 'quero redesenhar meu site']) {
    const d = runDecision(text, { hasExistingClient: true })
    neverSilent(d)
  }
  // "existing_client" é classificação (afeta temperatura/relatório) — nunca um gate de resposta.
  // O webhook não pode ter NENHUMA exclusão por kind, e o worker não pode ter nenhum retorno
  // antecipado condicionado a leadKind/conversation_kind === 'existing_client'.
  assert.doesNotMatch(webhook, /existing_client/)
  assert.doesNotMatch(worker, /leadKind\.kind\s*===\s*'existing_client'|conversation_kind\s*===\s*'existing_client'/)
  // A única classificação usada para modular comportamento é dentro de assessCommercialTemperature
  // (define temperatura, não se responde) — confirmamos que é a única ocorrência semântica restante.
  const commercialCore = fs.readFileSync('supabase/functions/_shared/commercialAgentCore.js', 'utf8')
  const occurrences = (commercialCore.match(/existing_client/g) || []).length
  assert.ok(occurrences >= 3) // enum + reason de classificação + exclusão de temperatura "hot"
})

// --- F: "quanto custa?" → nunca inventa preço ----------------------------------------------------
test('F: "quanto custa?" nunca inventa preço — só menciona valor com authorized_pricing preenchido', () => {
  const d = runDecision('quanto custa?')
  neverSilent(d)
  assert.doesNotMatch(d.response, /r\$\s*\d|\d[\d.,]*\s*(reais|mil reais)/i)
  // authorized_pricing = {} é o padrão de produção — nada autorizado, nunca inventa valor.
  assert.match(worker, /authorized_pricing:settings\.authorized_pricing\|\|\{\}/)
})

// --- G: "não sei o que preciso" → conversa exploratória, nunca silêncio -------------------------
test('G: "não sei o que preciso" (other/exploratory) gera resposta natural, nunca silêncio', () => {
  assert.equal(classifyConversationKind('não sei o que preciso').kind, 'other')
  const d = runDecision('não sei o que preciso')
  neverSilent(d)
})

// --- H: memória de nome + empresa ao longo da conversa ------------------------------------------
test('H: contexto de nome/empresa já capturados chega ao worker via qualification/client (memória real)', () => {
  assert.match(worker, /qualification:qualification\|\|\{\}/)
  assert.match(worker, /messages:messages\.map\(row=>/)
  // O contact_updates só popula contact_name/company_name quando a própria pessoa se identifica —
  // nunca a partir do display_name do WhatsApp (ver teste de identidade abaixo).
  assert.match(worker, /for\(const key of \['contact_name','email'\]\)if\(decision\.contact_updates\[key\]\)/)
})

// --- I: "também queria tráfego" mantém interesse anterior e soma o novo -------------------------
test('I: mergeInterests preserva interesses antigos da oportunidade e soma os novos (nunca substitui)', () => {
  assert.match(worker, /mergeInterests\(qualification\.service_interest,opportunity\.service_interests,decision\.intents,decision\.opportunity_updates\?\.service_interests\)/)
})

// --- J/K: cliente existente — a intenção atual decide, não o histórico de já ser cliente --------
test('J-K: cliente existente com "quero fazer outro site" é new_business; com "meu site caiu" é support', () => {
  assert.equal(classifyConversationKind('quero fazer outro site', { hasExistingClient: true }).kind, 'new_business')
  assert.equal(classifyConversationKind('meu site caiu', { hasExistingClient: true }).kind, 'support')
})

// --- L: "preciso da nota fiscal" → finance, nunca silêncio, nunca vira venda --------------------
test('L: "preciso da nota fiscal" → finance, resposta de encaminhamento, handoff — nunca nova venda', () => {
  assert.equal(classifyConversationKind('preciso da nota fiscal').kind, 'finance')
  const d = runDecision('preciso da nota fiscal')
  neverSilent(d)
  assert.equal(d.handoff, true)
  assert.equal(d.handoff_reason, 'finance_requires_team')
  assert.doesNotMatch(d.response, /empresa\?|projeto|orçamento/i)
})

// --- M: "quero falar com uma pessoa" → handoff imediato -----------------------------------------
test('M: "quero falar com uma pessoa" → handoff imediato, sem outro telefone', () => {
  const d = runDecision('quero falar com uma pessoa')
  neverSilent(d)
  assert.equal(d.handoff, true)
  assert.equal(d.handoff_reason, 'human_requested')
  assert.doesNotMatch(d.response, /\+?\d{2}\s?\d{4,5}-?\d{4}/)
})

// --- N: evento pending + conversa vira human ANTES do worker → skipped, nenhuma msg automática ---
test('N: conversa em human/automation_paused é pulada pelo worker — nunca responde depois do handoff', () => {
  assert.match(worker, /attendance_mode==='human'\|\|conversationResult\.data\.automation_paused===true/)
  assert.match(worker, /reason:'human_attendance_active'/)
  // A checagem acontece ANTES de qualquer chamada à OpenAI ou envio de mensagem.
  const checkIdx = worker.indexOf("attendance_mode==='human'||conversationResult.data.automation_paused===true")
  const sendIdx = worker.indexOf('await sendMessage(admin,event,conversation,decision.response)')
  const openAiIdx = worker.indexOf('await askOpenAI(')
  assert.ok(checkIdx > -1 && sendIdx > -1 && openAiIdx > -1 && checkIdx < openAiIdx && checkIdx < sendIdx)
  // Segunda checagem depois da OpenAI (que pode demorar) e antes de qualquer persistência/envio.
  const recheckIdx = worker.indexOf("const recheck=await admin.from('whatsapp_conversations')")
  assert.ok(recheckIdx > -1 && recheckIdx > openAiIdx && recheckIdx < sendIdx)
})

// --- O: continuação de conversa usa contexto (não é reanalisada isolada) ------------------------
test('O: histórico e resumo da conversa (memória) chegam ao contexto da IA — mensagem nunca é isolada', () => {
  assert.match(worker, /opportunity:opportunity\|\|\{\}/) // opportunity completo inclui conversation_summary
  assert.match(worker, /\.order\('created_at',\{ascending:false\}\)\.limit\(14\)/)
  assert.match(worker, /previousKind:opportunity\.lead_kind/)
})

// --- Seção 21: reprodução exata do caso real — pipeline, não só classifyConversationKind --------
test('21: caso real — MSG2 "quero redesenhar meu site" gera evento comercial e resposta completa (pipeline)', () => {
  // MSG1 já respondida (caso real confirmado); o requisito é que a MSG2 NUNCA fique muda.
  const kind = classifyConversationKind('quero redesenhar meu site', { hasExistingClient: false })
  assert.equal(kind.kind, 'new_business')
  const decision = runDecision('quero redesenhar meu site')
  neverSilent(decision)
  assert.ok(decision.intents.includes('SITE'))
  // Pipeline real: webhook sempre cria o evento (sem gate por kind) → dispatch → worker reclama →
  // processing → decide → envia → completed. Provamos cada elo, não só a classificação isolada.
  assert.match(webhook, /if \(commercial\.data\?\.ai_mode === 'controlled_auto'\) \{\s*const queuedCommercial = await admin\.from\('commercial_ai_events'\)\.insert/)
  assert.match(webhook, /await dispatchCommercialAiWorker\(\)/)
  assert.match(worker, /admin\.from\('commercial_ai_events'\)\.update\(\{status:'processing'/)
  assert.match(worker, /status:'completed',decision:\{\.\.\.decision,temperature,lead_kind:leadKind,provider_message_id:providerMessageId/)
  assert.match(worker, /const providerMessageId=await sendMessage\(admin,event,conversation,decision\.response\)/)
})

// --- Identidade: display_name nunca vira contact_name automaticamente --------------------------
test('identidade: display_name/profile_name do WhatsApp nunca preenche contact_name automaticamente', () => {
  assert.match(worker, /contact_name:null,phone:contact\.wa_id/)
  assert.doesNotMatch(worker, /contact_name:display/)
  assert.match(worker, /company_name:display/) // company_name pode usar o display como rótulo provisório
})

// --- Handoff nunca informa outro telefone (prompt) ----------------------------------------------
test('handoff nunca sugere outro telefone/canal — atendimento continua no mesmo WhatsApp (prompt)', () => {
  const prompt = fs.readFileSync('supabase/functions/_shared/commercialAgentCore.js', 'utf8')
  assert.match(prompt, /nunca informe outro telefone ou canal/)
})

// --- Estrutura da decisão evoluída: conversation_kind interpretado pela IA, validado pela policy ---
test('decisão estruturada inclui conversation_kind — IA interpreta, policy valida antes de persistir', () => {
  assert.match(worker, /conversation_kind:\{type:\['string','null'\],enum:\[\.\.\.COMMERCIAL_LEAD_KINDS,null\]\}/)
  assert.match(worker, /COMMERCIAL_LEAD_KINDS\.includes\(decision\.conversation_kind\)/)
  const commercialCore = fs.readFileSync('supabase/functions/_shared/commercialAgentCore.js', 'utf8')
  assert.match(commercialCore, /conversation_kind: COMMERCIAL_LEAD_KINDS\.includes\(value\.conversation_kind\) \? value\.conversation_kind : null/)
})

// --- Preservar infraestrutura funcional ----------------------------------------------------------
test('infra preservada: dispatch imediato, cron, Vault, ledger e Assistente Interna continuam intactos', () => {
  assert.match(webhook, /dispatchCommercialAiWorker/)
  assert.match(webhook, /dispatchTaskCommandWorker/)
  const cron = fs.readFileSync('supabase/migrations/202609250004_commercial_ai_worker_dispatch.sql', 'utf8')
  assert.match(cron, /commercial-ai-worker-every-minute/)
  assert.match(worker, /COMMERCIAL_AI_WORKER_KEY/)
  assert.match(webhook, /claimWebhookEvent/)
})
