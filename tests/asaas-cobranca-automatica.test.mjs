import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { asaasBaseUrl, asaasDueDate, buildPaymentPayload, ensureAsaasCharge, handleAsaasWebhookEvent, installmentIdFromReference } from '../supabase/functions/_shared/asaasCore.js'
import { currentCollectionSlot, normalizeTimes, paymentClaimBlocks } from '../supabase/functions/_shared/collectionCadenceCore.js'
import { formatFinanceCheckAmountReply } from '../supabase/functions/_shared/whatsappWebhookCore.js'

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

// Fake mínimo do client do Supabase (encadeável) sobre tabelas em memória.
function fakeAdmin(tables, rpcs = {}) {
  const calls = []
  const query = (table) => {
    const filters = [], state = { op: 'select', values: null }
    const rows = () => (tables[table] ||= []).filter((row) => filters.every((f) => f(row)))
    const api = {
      select() { return api },
      eq(key, value) { filters.push((row) => row[key] === value); return api },
      in(key, values) { filters.push((row) => values.includes(row[key])); return api },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return api },
      update(values) { state.op = 'update'; state.values = values; return api },
      insert(values) { state.op = 'insert'; state.values = values; return api },
      maybeSingle() { return run(true) },
      single() { return run(true) },
      then(resolve, reject) { return run(false).then(resolve, reject) },
    }
    const run = async (single) => {
      calls.push({ table, op: state.op, values: state.values })
      if (state.op === 'insert') {
        const list = tables[table] ||= []
        if (list.some((row) => row.id && row.id === state.values.id)) return { data: null, error: { code: '23505' } }
        list.push({ ...state.values }); return { data: { ...state.values }, error: null }
      }
      const found = rows()
      if (state.op === 'update') found.forEach((row) => Object.assign(row, state.values))
      return { data: single ? (found[0] ? { ...found[0] } : null) : found, error: null }
    }
    return api
  }
  return { from: query, rpc: async (name, args) => { calls.push({ rpc: name, args }); return rpcs[name] ? rpcs[name](args) : { data: null, error: null } }, calls, tables }
}
function fakeFetch(routes) {
  const seen = []
  const impl = async (url, init) => {
    const path = url.replace(/^https:\/\/api(-sandbox)?\.asaas\.com\/v3/, ''), key = `${init.method} ${path.split('?')[0]}`
    seen.push({ key, body: init.body ? JSON.parse(init.body) : null, headers: init.headers })
    const handler = routes[key]
    if (!handler) return { ok: false, status: 404, json: async () => ({ errors: [{ code: 'not_found', description: 'não achou' }] }) }
    return { ok: true, status: 200, json: async () => handler(init.body ? JSON.parse(init.body) : null) }
  }
  impl.seen = seen
  return impl
}
const config = { apiKey: '$aact_prod_x', baseUrl: 'https://api.asaas.com/v3' }
const installment = (extra = {}) => ({ id: '11111111-1111-4111-8111-111111111111', organization_id: 'org', client_id: 'c1', contract_id: 'k1', reference_month: '2026-11-01', due_date: '2026-11-05', amount: 2500, received_amount: 0, status: 'pending', paid_at: null, installment_type: 'monthly', provider: null, provider_invoice_id: null, clients: { id: 'c1', company_name: 'Origami Investimentos', document_number: '12.345.678/0001-90', phone: '+5511992000357' }, ...extra })

test('ambiente do Asaas pela chave; vencimento passado vira hoje; payload leva multa e juros das configurações', () => {
  assert.equal(asaasBaseUrl('$aact_hmlg_abc'), 'https://api-sandbox.asaas.com/v3')
  assert.equal(asaasBaseUrl('$aact_prod_abc'), 'https://api.asaas.com/v3')
  assert.equal(asaasBaseUrl('$aact_prod_abc', 'sandbox'), 'https://api-sandbox.asaas.com/v3')
  assert.equal(asaasDueDate('2026-10-05', '2026-10-30'), '2026-10-30')
  assert.equal(asaasDueDate('2026-11-05', '2026-10-30'), '2026-11-05')
  const payload = buildPaymentPayload({ installment: installment(), customerId: 'cus_1', settings: { asaas_fine_percent: 2, asaas_interest_percent: 1, asaas_billing_type: 'UNDEFINED' }, today: '2026-10-30' })
  assert.deepEqual([payload.fine, payload.interest, payload.billingType, payload.externalReference], [{ value: 2 }, { value: 1 }, 'UNDEFINED', `installment:${installment().id}`])
  assert.equal(installmentIdFromReference(payload.externalReference), installment().id)
})

test('gera cliente e cobrança no Asaas uma vez; segunda chamada reaproveita; valor novo atualiza parcela e cobrança', async () => {
  const tables = { invoice_installments: [installment()], organization_settings: [{ organization_id: 'org', asaas_fine_percent: 2, asaas_interest_percent: 1, asaas_billing_type: 'UNDEFINED' }], clients: [{ id: 'c1', organization_id: 'org' }], commercial_events: [] }
  // O fake não faz join: a parcela já traz "clients"; a atualização de asaas_customer_id é refletida à mão.
  const admin = fakeAdmin(tables)
  let created = 0, current = null
  const fetchImpl = fakeFetch({
    'GET /customers': () => ({ data: [] }),
    'POST /customers': () => ({ id: 'cus_1' }),
    'POST /payments': (body) => { created += 1; current = { id: 'pay_1', status: 'PENDING', value: body.value, dueDate: body.dueDate, invoiceUrl: 'https://www.asaas.com/i/pay_1' }; return current },
    'GET /payments/pay_1': () => current,
    'PUT /payments/pay_1': (body) => { current = { ...current, value: body.value, dueDate: body.dueDate }; return current },
  })
  const first = await ensureAsaasCharge({ admin, org: 'org', installmentId: installment().id, config, fetchImpl, today: '2026-10-30' })
  assert.equal(first.payment_url, 'https://www.asaas.com/i/pay_1')
  assert.equal(tables.invoice_installments[0].provider_invoice_id, 'pay_1')
  assert.equal(fetchImpl.seen.find((call) => call.key === 'POST /customers').body.cpfCnpj, '12345678000190')
  assert.equal(fetchImpl.seen[0].headers.access_token, config.apiKey)
  tables.invoice_installments[0].clients.asaas_customer_id = 'cus_1'
  await ensureAsaasCharge({ admin, org: 'org', installmentId: installment().id, config, fetchImpl, today: '2026-10-30' })
  assert.equal(created, 1)
  const edited = await ensureAsaasCharge({ admin, org: 'org', installmentId: installment().id, amount: 2300, config, fetchImpl, today: '2026-10-30' })
  assert.equal(edited.value, 2300)
  assert.equal(tables.invoice_installments[0].amount, 2300)
  assert.equal(created, 1)
  assert.ok(tables.commercial_events.some((row) => row.event_type === 'installment_amount_changed'))
})

test('sem CPF/CNPJ não chama o Asaas e explica o que falta; parcela paga é recusada', async () => {
  const fetchImpl = fakeFetch({})
  const admin = fakeAdmin({ invoice_installments: [installment({ clients: { id: 'c1', company_name: 'Latinas', document_number: null } })], organization_settings: [] })
  await assert.rejects(ensureAsaasCharge({ admin, org: 'org', installmentId: installment().id, config, fetchImpl }), /CPF ou CNPJ de Latinas/)
  assert.equal(fetchImpl.seen.filter((call) => call.key.startsWith('POST')).length, 0)
  const paid = fakeAdmin({ invoice_installments: [installment({ status: 'paid', received_amount: 2500 })] })
  await assert.rejects(ensureAsaasCharge({ admin: paid, org: 'org', installmentId: installment().id, config, fetchImpl }), /em aberto/)
})

test('webhook: pagamento confirmado dá baixa uma vez; evento repetido é ignorado; outros eventos não mexem', async () => {
  const tables = { asaas_webhook_events: [], invoice_installments: [installment({ provider: 'asaas', provider_invoice_id: 'pay_1' })] }
  const admin = fakeAdmin(tables, { confirm_installment_receipt_asaas: async () => ({ data: {}, error: null }) })
  const fetchImpl = fakeFetch({ 'GET /payments/pay_1': () => ({ id: 'pay_1', value: 2550, billingType: 'PIX', paymentDate: '2026-11-07', externalReference: `installment:${installment().id}` }) })
  const body = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } }
  assert.equal((await handleAsaasWebhookEvent({ admin, body, config, fetchImpl })).status, 'processed')
  assert.equal((await handleAsaasWebhookEvent({ admin, body, config, fetchImpl })).status, 'duplicate')
  const confirm = admin.calls.filter((call) => call.rpc === 'confirm_installment_receipt_asaas')
  assert.equal(confirm.length, 1)
  assert.deepEqual([confirm[0].args.p_paid_value, confirm[0].args.p_billing_type, confirm[0].args.p_paid_on], [2550, 'PIX', '2026-11-07'])
  assert.equal((await handleAsaasWebhookEvent({ admin, body: { id: 'evt_2', event: 'PAYMENT_CREATED', payment: { id: 'pay_1' } }, config, fetchImpl })).status, 'ignored')
})

test('régua: 9h/12h/18h no vencimento, 9h nos dias seguintes, só o horário mais recente e com limite de atraso', () => {
  const base = { dueDate: '2026-11-05', dueDayTimes: ['09:00', '12:00', '18:00'], overdueTimes: ['09:00'], maxOverdueDays: 15 }
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-05', now: '08:59' }), null)
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-05', now: '09:00' }).slotKey, '2026-11-05@09:00')
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-05', now: '13:30' }).slotKey, '2026-11-05@12:00')
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-05', now: '18:05' }).slotKey, '2026-11-05@18:00')
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-05', now: '23:30' }), null)
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-06', now: '09:10' }).slotKey, '2026-11-06@09:00')
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-06', now: '11:30' }).slotKey, '2026-11-06@09:00')
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-06', now: '15:00' }), null)
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-21', now: '09:10' }), null)
  assert.equal(currentCollectionSlot({ ...base, today: '2026-11-04', now: '09:10' }), null)
  assert.deepEqual(normalizeTimes(['18:00', '9:00', 'x'], []), ['09:00', '18:00'])
})

test('régua para quando o cliente toca em "Já realizei o pagamento" depois do vencimento', () => {
  const item = { id: 'i1', client_id: 'c1', due_date: '2026-11-05' }
  assert.equal(paymentClaimBlocks([{ details: { installment_id: 'i1', claimed_at: '2026-11-05T15:00:00Z' } }], item), true)
  assert.equal(paymentClaimBlocks([{ details: { client_id: 'c1', claimed_at: '2026-11-06T10:00:00Z' } }], item), true)
  assert.equal(paymentClaimBlocks([{ details: { installment_id: 'i1', claimed_at: '2026-10-05T15:00:00Z' } }], item), false)
  assert.equal(paymentClaimBlocks([{ details: { installment_id: 'outra', claimed_at: '2026-11-06T10:00:00Z' } }], item), false)
})

test('"Consultar cobrança" responde com o link do Asaas quando existe', () => {
  const reply = formatFinanceCheckAmountReply([{ id: 'i1', reference_month: '2026-11-01', due_date: '2026-11-05', amount: 2500, currency: 'BRL', payment_url: 'https://www.asaas.com/i/pay_1' }])
  assert.match(reply, /https:\/\/www\.asaas\.com\/i\/pay_1/)
  assert.match(reply, /multa e juros/)
  assert.doesNotMatch(formatFinanceCheckAmountReply([{ id: 'i1', reference_month: '2026-11-01', due_date: '2026-11-05', amount: 2500, currency: 'BRL' }]), /asaas/)
})

test('robô de cobrança: horário reservado antes de enviar, sem reenvio cego, webhook autenticado', () => {
  const worker = read('supabase/functions/collection-cadence-worker/index.ts')
  assert.match(worker, /from\('collection_dispatch_log'\)\.insert\(/)
  assert.match(worker, /if\(reserved\.error\.code==='23505'\)return 'already'/)
  assert.match(worker, /paymentClaimBlocks\(claims\.data,row\)/)
  assert.match(worker, /\.in\('status',\['pending','overdue'\]\)\.eq\('received_amount',0\)\.is\('paid_at',null\)/)
  const webhook = read('supabase/functions/asaas-webhook/index.ts')
  assert.match(webhook, /sameSecret\(request\.headers\.get\('asaas-access-token'\)/)
  const migration = read('supabase/migrations/202610300004_cobranca_automatica.sql')
  assert.match(migration, /'\{09:00,12:00,18:00\}'/)
  assert.match(migration, /unique \(installment_id, slot_key\)/)
})

test('migration Asaas: baixa automática só pelo service_role, idempotente e com multa/juros registrados', () => {
  const sql = read('supabase/migrations/202610300003_asaas.sql')
  assert.match(sql, /revoke all on function public\.confirm_installment_receipt_asaas\(uuid, text, numeric, date, text\) from public, anon, authenticated/)
  assert.match(sql, /if r\.status = 'paid' then return r; end if;/)
  assert.match(sql, /'multa\/juros R\$ '/)
  assert.match(sql, /default 2 check/)
  assert.match(sql, /default 1 check/)
})

test('template com link: usado só quando aprovado e com link do Asaas; senão cai no alerta atual', () => {
  const worker = read('supabase/functions/collection-cadence-worker/index.ts')
  assert.match(worker, /const LINK_TEMPLATE='mugo_cobranca_link_v1'/)
  assert.match(worker, /const useLink=Boolean\(linkTemplateOk&&paymentUrl\)/)
  assert.match(worker, /\[name,brl\(row\.amount\),dateBr\(row\.due_date\),String\(paymentUrl\)\]/)
  assert.match(worker, /if\(templates\.error\|\|!approved\(template\)\)/)
})
