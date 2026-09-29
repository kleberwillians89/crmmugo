import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  debtAmount,
  formatCompetencePt,
  formatDatePt,
  formatFinanceCheckAmountReply,
  formatMoneyPt,
  isFinanceCheckAmountIntent,
  isPaymentClaimIntent,
} from '../supabase/functions/_shared/whatsappWebhookCore.js'

const webhook = fs.readFileSync(new URL('../supabase/functions/whatsapp-webhook/index.ts', import.meta.url), 'utf8')

// --- 1: botão "Consultar cobrança" (o botão real, aprovado — não existe "Consultar valor") ---------
test('1: clique no botão real "Consultar cobrança" (button/interactive) é reconhecido; texto de outro botão não é', () => {
  assert.equal(isFinanceCheckAmountIntent({ type: 'button', body: 'Consultar cobrança' }), true)
  assert.equal(isFinanceCheckAmountIntent({ type: 'interactive', body: 'Consultar cobrança' }), true)
  assert.equal(isFinanceCheckAmountIntent({ type: 'button', body: 'Já realizei o pagamento' }), false)
  assert.equal(isFinanceCheckAmountIntent({ type: 'text', body: 'oi, tudo bem?' }), false)
})

// --- 13: linguagem natural equivalente também dispara a intenção ------------------------------------
test('13: linguagem natural ("quanto devo?", "qual o valor?", etc.) é reconhecida como FINANCE_CHECK_AMOUNT', () => {
  for (const phrase of ['quanto devo?', 'Qual o valor da cobrança?', 'quanto estou devendo', 'qual minha pendência?', 'consultar valor']) {
    assert.equal(isFinanceCheckAmountIntent({ type: 'text', body: phrase }), true, phrase)
  }
})

// --- 2: paid → informa pago (via fallback quando não há elegíveis) ----------------------------------
test('2: sem parcela elegível + alerta anterior pago → "já consta como paga", nunca mostra valor', () => {
  assert.equal(formatFinanceCheckAmountReply([], true), 'Essa cobrança já consta como paga no sistema.')
  assert.match(webhook, /alreadyPaid = installment\.data\?\.status === 'paid' \|\| Boolean\(installment\.data\?\.paid_at\)/)
})

// --- 3/4: cancelled e parcelas futuras nunca aparecem como dívida (via filtro da própria query) -----
test('3/4: query de elegibilidade exclui cancelled/paid (status pending/overdue) e parcela futura (due_date<=hoje)', () => {
  assert.match(webhook, /\.in\('status', \['pending', 'overdue'\]\)\.eq\('received_amount', 0\)\.is\('paid_at', null\)/)
  assert.match(webhook, /\.lte\('due_date', today\)\.order\('due_date', \{ ascending: true \}\)/)
})

// --- 5/6: múltiplas overdue → total correto, formatado em BRL ---------------------------------------
test('5/6: múltiplas cobranças BRL somam corretamente e formatam R$ com separador de milhar', () => {
  const reply = formatFinanceCheckAmountReply([
    { reference_month: '2026-08-01', due_date: '2026-08-05', amount: 1000, original_amount: 1000, currency: 'BRL' },
    { reference_month: '2026-09-01', due_date: '2026-09-05', amount: 1300, original_amount: 1300, currency: 'BRL' },
  ])
  const nbsp = ' '
  assert.equal(reply, `Você possui 2 cobranças vencidas.\nTotal em atraso: R$${nbsp}2.300,00.\n\n• ago/2026 — R$${nbsp}1.000,00\n• set/2026 — R$${nbsp}1.300,00`)
})

// --- 7: EUR usa original_amount (amount pode ser 0 sem câmbio) e símbolo € --------------------------
test('7: EUR usa original_amount, nunca amount (que fica 0 sem câmbio configurado) — nunca "R$ 0,00"', () => {
  const item = { reference_month: '2026-10-01', due_date: '2026-10-10', amount: 0, original_amount: 100, currency: 'EUR' }
  assert.equal(debtAmount(item), 100)
  const reply = formatFinanceCheckAmountReply([item])
  assert.match(reply, /€ 100,00/)
  assert.doesNotMatch(reply, /R\$ 0,00/)
  assert.match(webhook, /export const debtAmount|debtAmount/)
})

// --- 8: moedas diferentes nunca são somadas ----------------------------------------------------------
test('8: BRL e EUR aparecem separados, nunca somados numa única "Total"', () => {
  const reply = formatFinanceCheckAmountReply([
    { reference_month: '2026-10-01', due_date: '2026-10-05', amount: 3500, original_amount: 3500, currency: 'BRL' },
    { reference_month: '2026-10-01', due_date: '2026-10-10', amount: 0, original_amount: 100, currency: 'EUR' },
  ])
  assert.match(reply, /BRL: R\$ 3\.500,00/)
  assert.match(reply, /EUR: € 100,00/)
  assert.doesNotMatch(reply, /Total em atraso/)
})

// --- 9: resolução do cliente só por client_id vinculado ao contato — nunca por nome -----------------
test('9: Roove lead comercial (sem client_id vinculado) nunca acessa dívida da Roove financeira — resolução é só por client_id', () => {
  assert.match(webhook, /if \(clientId\) \{\s*\n\s*const due = await admin\.from\('invoice_installments'\)/)
  // Sem client_id (contato não vinculado a nenhum cliente), items fica vazio por construção — nunca
  // cai num fallback que resolveria por nome/telefone.
  assert.doesNotMatch(webhook.slice(webhook.indexOf('handleFinanceCheckAmount = async'), webhook.indexOf('const handlePaymentClaim')), /company_name|trade_name|contact_name/)
})

// --- 10: clique duplicado nunca cria cobrança/altera installment/collection_alert -------------------
test('10: handleFinanceCheckAmount nunca escreve em invoice_installments ou whatsapp_collection_alerts (só lê)', () => {
  const block = webhook.slice(webhook.indexOf('const handleFinanceCheckAmount'), webhook.indexOf('const processInbound ='))
  assert.doesNotMatch(block, /from\('invoice_installments'\)\.(insert|update|upsert|delete)/)
  assert.doesNotMatch(block, /from\('whatsapp_collection_alerts'\)\.(insert|update|upsert|delete)/)
  // Idempotência: já existe uma resposta para esse provider_message_id → não reprocessa/reenvia.
  assert.match(block, /const idempotencyKey = `finance-check-amount:\$\{providerMessageId\}`/)
  assert.match(block, /if \(existing\.data\) return/)
})

// --- 11: resposta é registrada em whatsapp_messages (aparece na Caixa de Entrada) -------------------
test('11: resposta financeira grava em whatsapp_messages com metadata (source=finance, intent=FINANCE_CHECK_AMOUNT)', () => {
  assert.match(webhook, /source: 'finance', intent: 'FINANCE_CHECK_AMOUNT'/)
  assert.match(webhook, /direction: 'out', message_type: 'text', status: 'accepted'/)
  assert.match(webhook, /last_outbound_source: 'finance'/)
})

// --- 12: contexto financeiro (queue=finance_collection) vence a IA comercial ------------------------
test('12: FINANCE_CHECK_AMOUNT intercepta ANTES do dispatch para commercial-ai-worker, quando queue=finance_collection', () => {
  assert.match(webhook, /const financeContext = conversationResult\.data\.queue === 'finance_collection'/)
  assert.match(webhook, /if \(financeContext && isFinanceCheckAmountIntent\(content\)\) \{/)
  const financeIdx = webhook.indexOf("const financeContext = conversationResult.data.queue === 'finance_collection'")
  const commercialDispatchIdx = webhook.indexOf('await dispatchCommercialAiWorker()')
  assert.ok(financeIdx > -1 && commercialDispatchIdx > financeIdx)
  // E vem depois do respeito à prioridade humana (nunca responde por cima de handoff real).
  const humanControlledIdx = webhook.indexOf('const humanControlled =')
  assert.ok(humanControlledIdx > -1 && financeIdx > humanControlledIdx)
})

// --- Auxiliares de formatação (data/competência) — conferência direta ------------------------------
test('auxiliares: formatDatePt e formatCompetencePt produzem DD/MM/AAAA e mês/ano abreviados em pt-BR', () => {
  assert.equal(formatDatePt('2026-10-05'), '05/10/2026')
  assert.equal(formatCompetencePt('2026-08-01'), 'ago/2026')
  assert.equal(formatMoneyPt(3500, 'BRL'), 'R$ 3.500,00')
})

// --- Nenhuma dívida vencida ---------------------------------------------------------------------------
test('nenhuma cobrança vencida: mensagem correta, nunca mostra parcela futura como dívida', () => {
  assert.equal(formatFinanceCheckAmountReply([]), 'Não encontramos cobranças vencidas em aberto no momento.')
})

// ===================================================================================================
// PAYMENT_CLAIMED ("Já realizei o pagamento") — alegação nunca é confirmação
// ===================================================================================================

test('claim: botão real "Já realizei o pagamento" e linguagem natural são reconhecidos; nunca colide com consultar cobrança', () => {
  assert.equal(isPaymentClaimIntent({ type: 'button', body: 'Já realizei o pagamento' }), true)
  assert.equal(isPaymentClaimIntent({ type: 'interactive', body: 'Já realizei o pagamento' }), true)
  for (const phrase of ['já paguei', 'já fiz o pagamento', 'já fiz o pix', 'acabei de pagar']) {
    assert.equal(isPaymentClaimIntent({ type: 'text', body: phrase }), true, phrase)
  }
  assert.equal(isPaymentClaimIntent({ type: 'button', body: 'Consultar cobrança' }), false)
  assert.equal(isFinanceCheckAmountIntent({ type: 'text', body: 'já paguei' }), false)
})

test('claim != confirmação: handlePaymentClaim nunca escreve em invoice_installments (status/received_amount/paid_at intocados)', () => {
  const block = webhook.slice(webhook.indexOf('const handlePaymentClaim'), webhook.indexOf('const processInbound ='))
  assert.doesNotMatch(block, /from\('invoice_installments'\)\.(insert|update|upsert|delete)/)
  assert.doesNotMatch(block, /status:\s*'paid'/)
  assert.doesNotMatch(block, /received_amount\s*[:=]/)
  assert.doesNotMatch(block, /paid_at\s*[:=]\s*(?!null)/)
  // Só lê para descobrir QUAL parcela está sendo alegada — nunca atualiza o que lê.
  assert.match(block, /from\('invoice_installments'\)\.select\(/)
})

test('claim: registra evento com os campos exigidos e responde exatamente o texto pedido', () => {
  assert.match(webhook, /event_type: 'payment_claimed', details: eventDetails/)
  assert.match(webhook, /kind: 'payment_claimed', provider_message_id: providerMessageId, client_id: clientId, client_name: clientName \|\| null,/)
  assert.match(webhook, /installment_id: claimedItem\?\.id \|\| null, amount: claimedItem \? debtAmount\(claimedItem\) : null, currency: claimedItem\?\.currency \|\| null,/)
  assert.match(webhook, /due_date: claimedItem\?\.due_date \|\| null, phone: waId, claimed_at: now,/)
  assert.match(webhook, /const reply = 'Obrigado\. Registramos sua informação e vamos conferir o pagamento\.'/)
})

test('claim: notifica o responsável usando um notification_type já permitido pela constraint (não inventa valor)', () => {
  // Constraint real de team_notification_outbox (auditada antes de escrever): não inclui
  // "payment_claimed" — por isso reaproveita 'operational_alert', já permitido, com payload.kind.
  assert.match(webhook, /notification_type: 'operational_alert',/)
  assert.match(webhook, /payload: \{ kind: 'payment_claimed', conversation_id: conversation\.id, \.\.\.eventDetails \}/)
})

test('claim: idempotente por provider_message_id — clique repetido (mesma entrega) não duplica evento nem notificação', () => {
  assert.match(webhook, /const idempotencyKey = `payment-claim:\$\{providerMessageId\}`/)
  assert.match(webhook, /if \(existing\.data\) return/)
  assert.match(webhook, /idempotency_key: `payment-claim:\$\{providerMessageId\}`,/)
})

test('claim: contexto financeiro (queue=finance_collection) tem prioridade sobre a IA comercial, igual ao consultar cobrança', () => {
  const claimIdx = webhook.indexOf('if (financeContext && isPaymentClaimIntent(content)) {')
  const commercialDispatchIdx = webhook.indexOf('await dispatchCommercialAiWorker()')
  assert.ok(claimIdx > -1 && commercialDispatchIdx > claimIdx)
})

console.log('FINANCE_CHECK_AMOUNT + PAYMENT_CLAIMED (Consultar cobrança / Já realizei o pagamento): ok')
