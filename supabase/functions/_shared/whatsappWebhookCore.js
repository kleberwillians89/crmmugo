export const webhookText = (value, max = 500) => String(value ?? '').trim().slice(0, max)
export const webhookDigits = (value) => webhookText(value, 40).replace(/\D/g, '')
export const webhookTimestamp = (value, now = () => new Date()) => {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : now().toISOString()
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('')

export const verifyMetaSignature = async (body, signature, secret) => {
  if (!secret || !signature.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = `sha256=${hex(await crypto.subtle.sign('HMAC', key, body))}`
  if (expected.length !== signature.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  return difference === 0
}

export const hashWebhookPayload = async (value) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))

export const verifyWebhookChallenge = (searchParams, verifyToken) =>
  Boolean(verifyToken && searchParams.get('hub.mode') === 'subscribe' && searchParams.get('hub.verify_token') === verifyToken)

export const webhookMessageContent = (message) => {
  const type = webhookText(message?.type, 40) || 'unknown'
  if (type === 'text') return { type, body: webhookText(message?.text?.body, 4000), media: {} }
  if (type === 'interactive') return { type, body: webhookText(message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title, 4000), media: { reply_id: webhookText(message?.interactive?.button_reply?.id || message?.interactive?.list_reply?.id, 200) } }
  if (type === 'button') return { type, body: webhookText(message?.button?.text, 4000), media: { payload: webhookText(message?.button?.payload, 500) } }
  const media = message?.[type] || {}
  return { type, body: webhookText(media?.caption, 4000), media: { id: webhookText(media?.id, 200), mime_type: webhookText(media?.mime_type, 120), sha256: webhookText(media?.sha256, 200), filename: webhookText(media?.filename, 240) } }
}

export const META_STATUS_RANK = Object.freeze({ queued: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5 })
export const shouldApplyMetaStatus = (current, next) => {
  if (!(next in META_STATUS_RANK)) return false
  if (['delivered', 'read'].includes(current) && next === 'failed') return false
  return next === 'failed' || (META_STATUS_RANK[current] ?? 0) <= META_STATUS_RANK[next]
}

export const inboundEventKey = (providerMessageId) => `message:${webhookText(providerMessageId, 240)}`
export const statusEventKey = (providerMessageId, status, timestamp) => `status:${webhookText(providerMessageId, 240)}:${webhookText(status, 30).toLowerCase()}:${webhookText(timestamp, 40)}`

// FINANCE_CHECK_AMOUNT: "Consultar cobrança" é o botão real, hoje aprovado no template
// mugo_alerta_pagamento_pendente (não existe botão "Consultar valor" — não inventamos um). Aceita os
// 3 formatos reais que a Meta entrega para clique em botão de template (button/interactive) e também
// linguagem natural equivalente, sempre dentro de contexto financeiro (o chamador decide o contexto).
const FINANCE_CHECK_AMOUNT_PHRASES = [
  'consultar cobranca', 'consultar valor', 'qual o valor', 'qual valor', 'qual e o valor',
  'quanto estou devendo', 'quanto devo', 'qual minha pendencia', 'qual a minha pendencia',
  'valor da cobranca', 'valor da minha cobranca',
]
const foldFinanceText = (value) => webhookText(value, 240).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[?!.]+$/g, '').trim()
export const isFinanceCheckAmountIntent = (content) => {
  const folded = foldFinanceText(content?.body)
  if (!folded) return false
  if (content?.type === 'button' || content?.type === 'interactive') {
    return folded === 'consultar cobranca'
  }
  return FINANCE_CHECK_AMOUNT_PHRASES.some((phrase) => folded === phrase || folded.includes(phrase))
}

// PAYMENT_CLAIMED: "Já realizei o pagamento" é o outro botão real do mesmo template. Uma alegação de
// pagamento NUNCA confirma pagamento — nunca deve ser usada para marcar invoice_installments como
// paga (isso exige conferência financeira real, fora deste fluxo).
const PAYMENT_CLAIM_PHRASES = [
  'ja realizei o pagamento', 'ja paguei', 'ja fiz o pagamento', 'realizei o pagamento',
  'fiz o pagamento', 'ja fiz o pix', 'ja paguei a fatura', 'paguei a cobranca', 'acabei de pagar',
]
export const isPaymentClaimIntent = (content) => {
  const folded = foldFinanceText(content?.body)
  if (!folded) return false
  if (content?.type === 'button' || content?.type === 'interactive') {
    return folded === 'ja realizei o pagamento'
  }
  return PAYMENT_CLAIM_PHRASES.some((phrase) => folded === phrase || folded.includes(phrase))
}

const PT_MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const formatDatePt = (isoDate) => {
  const [year, month, day] = webhookText(isoDate, 10).split('-')
  return day && month && year ? `${day}/${month}/${year}` : ''
}
export const formatCompetencePt = (referenceMonth) => {
  const [year, month] = webhookText(referenceMonth, 10).split('-')
  const index = Number(month) - 1
  return year && PT_MONTH_ABBR[index] ? `${PT_MONTH_ABBR[index]}/${year}` : ''
}
export const formatMoneyPt = (value, currency) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(Number(value || 0))
// EUR/moeda estrangeira sem câmbio configurado grava amount=0 (ver normalize_receivable_currency) —
// o valor real e confiável é sempre original_amount para não-BRL.
export const debtAmount = (item) => (item?.currency === 'BRL' ? item?.amount : item?.original_amount)

// Nunca soma moedas diferentes; nunca mostra parcela futura ou já quitada como dívida (o chamador só
// passa itens já elegíveis). `items` vazio + `alreadyPaid` distingue "nada vencido" de "essa cobrança
// específica já foi paga" (pagamento pode ter ocorrido entre o envio do alerta e o clique do cliente).
export const formatFinanceCheckAmountReply = (items, alreadyPaid = false) => {
  if (!items.length) {
    return alreadyPaid
      ? 'Essa cobrança já consta como paga no sistema.'
      : 'Não encontramos cobranças vencidas em aberto no momento.'
  }
  if (items.length === 1) {
    const item = items[0]
    return `Olá! O valor em aberto desta cobrança é ${formatMoneyPt(debtAmount(item), item.currency)}.\nVencimento: ${formatDatePt(item.due_date)}.`
  }
  const lines = items.map((item) => `• ${formatCompetencePt(item.reference_month)} — ${formatMoneyPt(debtAmount(item), item.currency)}`)
  const currencies = [...new Set(items.map((item) => item.currency || 'BRL'))]
  if (currencies.length === 1) {
    const total = items.reduce((sum, item) => sum + Number(debtAmount(item) || 0), 0)
    return `Você possui ${items.length} cobranças vencidas.\nTotal em atraso: ${formatMoneyPt(total, currencies[0])}.\n\n${lines.join('\n')}`
  }
  const totals = currencies.map((currency) => {
    const total = items.filter((item) => (item.currency || 'BRL') === currency).reduce((sum, item) => sum + Number(debtAmount(item) || 0), 0)
    return `${currency}: ${formatMoneyPt(total, currency)}`
  })
  return `Você possui ${items.length} cobranças vencidas em moedas diferentes.\n${totals.join('\n')}\n\n${lines.join('\n')}`
}
