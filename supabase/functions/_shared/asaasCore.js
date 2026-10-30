// Integração com o Asaas (cobranças com multa e juros calculados pelo próprio Asaas).
// Sem dependência de Deno: recebe o client do Supabase (service role), fetch e a configuração por
// parâmetro, para poder ser testado em Node e usado pelo asaas-billing e pelo task-command-worker.

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const OPEN_STATUSES = ['draft', 'pending', 'overdue']
const ASAAS_OPEN = ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS']

export class AsaasError extends Error {
  constructor(code, message, status = 400, details = null) { super(message); this.code = code; this.status = status; this.details = details }
}

// Chave de sandbox (homologação) contém "_hmlg_"; ASAAS_ENV força o ambiente se precisar.
export function asaasBaseUrl(apiKey, env = '') {
  const forced = clean(env).toLowerCase()
  if (forced === 'sandbox') return 'https://api-sandbox.asaas.com/v3'
  if (forced === 'production') return 'https://api.asaas.com/v3'
  return String(apiKey || '').includes('_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'
}

export function asaasConfigFromEnv(getEnv) {
  const apiKey = clean(getEnv('ASAAS_API_KEY'), 400)
  if (!apiKey) throw new AsaasError('ASAAS_NOT_CONFIGURED', 'A chave do Asaas (ASAAS_API_KEY) não está configurada no Supabase.', 503)
  return { apiKey, baseUrl: asaasBaseUrl(apiKey, getEnv('ASAAS_ENV')) }
}

export async function asaasRequest(config, fetchImpl, method, path, body) {
  let response
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: { access_token: config.apiKey, 'Content-Type': 'application/json', accept: 'application/json', 'User-Agent': 'mugo-crm' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new AsaasError('ASAAS_UNREACHABLE', 'Não foi possível falar com o Asaas agora. Tente de novo em instantes.', 502, { message: error?.message })
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const first = Array.isArray(data?.errors) ? data.errors[0] : null
    throw new AsaasError(first?.code || `ASAAS_HTTP_${response.status}`, first?.description || `O Asaas recusou a operação (HTTP ${response.status}).`, response.status >= 500 ? 502 : 422, data)
  }
  return data
}

export const todayInSaoPaulo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

// Parcela já vencida: o Asaas não cria cobrança com data passada, então vence hoje.
export function asaasDueDate(dueDate, today = todayInSaoPaulo()) {
  const due = clean(dueDate, 10)
  return !due || due < today ? today : due
}

export function buildCustomerPayload(client, document) {
  const phone = digits(client.billing_contact_phone || client.phone)
  const brMobile = phone.startsWith('55') && (phone.length === 12 || phone.length === 13) ? phone.slice(2) : (phone.length === 10 || phone.length === 11 ? phone : '')
  return {
    name: clean(client.company_name || client.trade_name, 200),
    cpfCnpj: document,
    email: clean(client.billing_contact_email || client.email, 200) || undefined,
    mobilePhone: brMobile || undefined,
    externalReference: `client:${client.id}`,
    // A cobrança sai pelo WhatsApp da Mugô; os avisos automáticos do Asaas ficam desligados.
    notificationDisabled: true,
  }
}

export function buildPaymentPayload({ installment, customerId, settings = {}, today }) {
  const reference = clean(installment.reference_month, 7)
  return {
    customer: customerId,
    billingType: settings.asaas_billing_type || 'UNDEFINED',
    value: Number(installment.amount),
    dueDate: asaasDueDate(installment.due_date, today),
    description: clean(`Agência Mugô — ${installment.installment_type === 'setup' ? 'implantação' : 'mensalidade'}${reference ? ` ${reference.slice(5, 7)}/${reference.slice(0, 4)}` : ''}`, 500),
    externalReference: `installment:${installment.id}`,
    fine: { value: Number(settings.asaas_fine_percent ?? 2) },
    interest: { value: Number(settings.asaas_interest_percent ?? 1) },
  }
}

export const installmentIdFromReference = (reference) => {
  const match = clean(reference, 200).match(/^installment:([0-9a-f-]{36})$/i)
  return match ? match[1] : null
}

const INSTALLMENT_FIELDS = 'id,organization_id,client_id,contract_id,reference_month,due_date,amount,received_amount,status,paid_at,installment_type,provider,provider_invoice_id,payment_url,boleto_url,clients(id,company_name,trade_name,document_number,email,phone,billing_contact_email,billing_contact_phone,asaas_customer_id)'

async function ensureCustomer({ admin, config, fetchImpl, client, org }) {
  if (client.asaas_customer_id) return client.asaas_customer_id
  const document = digits(client.document_number)
  if (![11, 14].includes(document.length)) throw new AsaasError('CLIENT_DOCUMENT_MISSING', `Cadastre o CPF ou CNPJ de ${client.trade_name || client.company_name} para gerar a cobrança no Asaas.`, 422)
  const found = await asaasRequest(config, fetchImpl, 'GET', `/customers?cpfCnpj=${document}&limit=1`)
  const customerId = found?.data?.[0]?.id || (await asaasRequest(config, fetchImpl, 'POST', '/customers', buildCustomerPayload(client, document))).id
  const saved = await admin.from('clients').update({ asaas_customer_id: customerId }).eq('id', client.id).eq('organization_id', org)
  if (saved.error) throw saved.error
  return customerId
}

// Cria (ou reaproveita/atualiza) a cobrança do Asaas para uma parcela em aberto e devolve o link.
// amount: valor novo opcional — grava na parcela antes de cobrar (o link sempre bate com o CRM).
export async function ensureAsaasCharge({ admin, org, installmentId, amount = null, reason = '', actorId = null, config, fetchImpl = fetch, today = todayInSaoPaulo() }) {
  const loaded = await admin.from('invoice_installments').select(INSTALLMENT_FIELDS).eq('organization_id', org).eq('id', installmentId).maybeSingle()
  if (loaded.error) throw loaded.error
  const installment = loaded.data
  if (!installment) throw new AsaasError('INSTALLMENT_NOT_FOUND', 'Parcela não encontrada.', 404)
  if (!OPEN_STATUSES.includes(installment.status) || Number(installment.received_amount || 0) > 0 || installment.paid_at) {
    throw new AsaasError('INSTALLMENT_NOT_OPEN', 'Só dá para gerar cobrança no Asaas de parcela em aberto e sem recebimento.', 409)
  }
  const wanted = amount == null ? null : Math.round(Number(amount) * 100) / 100
  if (wanted != null) {
    if (!(wanted > 0)) throw new AsaasError('INVALID_AMOUNT', 'Informe um valor maior que zero.', 422)
    if (wanted !== Number(installment.amount)) {
      const previous = Number(installment.amount)
      const updated = await admin.from('invoice_installments').update({ amount: wanted, original_amount: wanted, currency: 'BRL', exchange_rate: 1 })
        .eq('id', installment.id).eq('organization_id', org).in('status', OPEN_STATUSES).eq('received_amount', 0).select('amount').single()
      if (updated.error) throw updated.error
      installment.amount = updated.data.amount
      await admin.from('commercial_events').insert({ organization_id: org, client_id: installment.client_id, contract_id: installment.contract_id, installment_id: installment.id, event_type: 'installment_amount_changed', title: 'Valor da parcela alterado', description: clean(reason) || 'Ajustado ao gerar a cobrança no Asaas.', old_value: { amount: previous }, new_value: { amount: wanted }, created_by: actorId })
    }
  }
  const settingsResult = await admin.from('organization_settings').select('asaas_fine_percent,asaas_interest_percent,asaas_billing_type').eq('organization_id', org).maybeSingle()
  if (settingsResult.error) throw settingsResult.error
  const settings = settingsResult.data || {}
  const customerId = await ensureCustomer({ admin, config, fetchImpl, client: installment.clients || {}, org })
  const payload = buildPaymentPayload({ installment, customerId, settings, today })

  let payment = null
  if (installment.provider === 'asaas' && installment.provider_invoice_id) {
    const existing = await asaasRequest(config, fetchImpl, 'GET', `/payments/${encodeURIComponent(installment.provider_invoice_id)}`).catch((error) => { if (error.status === 422 || error.code === 'ASAAS_HTTP_404') return null; throw error })
    if (existing && !existing.deleted && ASAAS_OPEN.includes(existing.status)) {
      const sameValue = Number(existing.value) === Number(payload.value)
      const stillValidDate = String(existing.dueDate) >= today
      const changes = { value: payload.value, dueDate: payload.dueDate, fine: payload.fine, interest: payload.interest }
      const path = `/payments/${encodeURIComponent(existing.id)}`
      // A API documenta a atualização como PUT; contas antigas ainda aceitam só POST no mesmo caminho.
      payment = sameValue && stillValidDate ? existing : await asaasRequest(config, fetchImpl, 'PUT', path, changes)
        .catch((error) => ['ASAAS_HTTP_404', 'ASAAS_HTTP_405'].includes(error.code) ? asaasRequest(config, fetchImpl, 'POST', path, changes) : Promise.reject(error))
    }
  }
  if (!payment) payment = await asaasRequest(config, fetchImpl, 'POST', '/payments', payload)

  const saved = await admin.from('invoice_installments').update({ provider: 'asaas', provider_invoice_id: payment.id, payment_url: payment.invoiceUrl || null, boleto_url: payment.bankSlipUrl || null })
    .eq('id', installment.id).eq('organization_id', org)
  if (saved.error) throw saved.error
  return { installment_id: installment.id, payment_id: payment.id, payment_url: payment.invoiceUrl || null, boleto_url: payment.bankSlipUrl || null, value: Number(payment.value ?? payload.value), due_date: payment.dueDate || payload.dueDate, fine_percent: payload.fine.value, interest_percent: payload.interest.value }
}

export const ASAAS_PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'])

// Processa um evento do webhook: busca a cobrança no Asaas (o evento pode vir resumido) e dá baixa.
export async function handleAsaasWebhookEvent({ admin, body, config, fetchImpl = fetch }) {
  const eventId = clean(body?.id, 200), event = clean(body?.event, 80), paymentId = clean(body?.payment?.id, 80)
  if (!eventId || !event) throw new AsaasError('INVALID_EVENT', 'Evento do Asaas inválido.', 400)
  const stored = await admin.from('asaas_webhook_events').insert({ id: eventId, event, payment_id: paymentId || null, payload: body }).select('id').maybeSingle()
  if (stored.error) {
    if (stored.error.code === '23505') {
      const previous = await admin.from('asaas_webhook_events').select('status').eq('id', eventId).maybeSingle()
      if (previous.data?.status !== 'failed') return { status: 'duplicate' }
    } else throw stored.error
  }
  const finish = (status, values = {}) => admin.from('asaas_webhook_events').update({ status, processed_at: new Date().toISOString(), ...values }).eq('id', eventId)
  if (!ASAAS_PAID_EVENTS.has(event) || !paymentId) { await finish('ignored'); return { status: 'ignored' } }
  try {
    const payment = await asaasRequest(config, fetchImpl, 'GET', `/payments/${encodeURIComponent(paymentId)}`)
    let installmentId = installmentIdFromReference(payment.externalReference)
    if (!installmentId) {
      const byProvider = await admin.from('invoice_installments').select('id').eq('provider', 'asaas').eq('provider_invoice_id', paymentId).maybeSingle()
      if (byProvider.error) throw byProvider.error
      installmentId = byProvider.data?.id || null
    }
    if (!installmentId) { await finish('ignored', { error_message: 'Cobrança sem parcela do CRM.' }); return { status: 'ignored' } }
    const row = await admin.from('invoice_installments').select('organization_id').eq('id', installmentId).maybeSingle()
    if (row.error) throw row.error
    if (!row.data) { await finish('ignored', { error_message: 'Parcela não encontrada.' }); return { status: 'ignored' } }
    const paidValue = Number(payment.value ?? body?.payment?.value ?? 0)
    const paidOn = clean(payment.clientPaymentDate || payment.paymentDate || payment.confirmedDate, 10) || null
    const confirmed = await admin.rpc('confirm_installment_receipt_asaas', { p_installment_id: installmentId, p_payment_id: paymentId, p_paid_value: paidValue, p_paid_on: paidOn, p_billing_type: payment.billingType || null })
    if (confirmed.error) throw confirmed.error
    await finish('processed', { organization_id: row.data.organization_id, installment_id: installmentId })
    return { status: 'processed', installment_id: installmentId }
  } catch (error) {
    await finish('failed', { error_message: clean(error?.message, 500) })
    throw error
  }
}
