import assert from 'node:assert/strict'
import {
  classifyActionError,
  deadLetterDecision,
  deriveIdempotencyKey,
  evaluateCondition,
  evaluateConditions,
  executeRun,
  matchFlow,
  nextRetryDelaySeconds,
  planRun,
  resolveContextValue,
  selectFlows,
} from '../src/services/whatsapp/automationExecutor.js'

const FIXED_NOW = new Date('2026-08-31T12:00:00.000Z')

// ---- match de gatilho ------------------------------------------------------------
const activeFlow = { id: 'f1', status: 'active', triggerType: 'invoice_overdue', triggerConfig: { min_amount: 100 } }
assert.equal(matchFlow(activeFlow, { event_type: 'invoice_overdue', sanitized_payload: { amount: 200 } }), true)
assert.equal(matchFlow(activeFlow, { event_type: 'invoice_overdue', sanitized_payload: { amount: 50 } }), false)
assert.equal(matchFlow(activeFlow, { event_type: 'lead_created' }), false)
assert.equal(matchFlow({ ...activeFlow, status: 'paused' }, { event_type: 'invoice_overdue', sanitized_payload: { amount: 200 } }), false)

const crmFlow = { id: 'f2', status: 'active', triggerType: 'crm_event', triggerConfig: { event_name: 'proposal_accepted' } }
assert.equal(matchFlow(crmFlow, { event_type: 'crm_event', sanitized_payload: { event_name: 'proposal_accepted' } }), true)
assert.equal(matchFlow(crmFlow, { event_type: 'crm_event', sanitized_payload: { event_name: 'other' } }), false)

const inboundFlow = { id: 'f3', status: 'active', triggerType: 'whatsapp_message_received', triggerConfig: {} }
assert.equal(matchFlow(inboundFlow, { event_type: 'whatsapp_message_received', sanitized_payload: { conversation_id: 'conversation-1' } }), true)
assert.equal(matchFlow({ ...inboundFlow, status: 'paused' }, { event_type: 'whatsapp_message_received' }), false)

assert.deepEqual(
  selectFlows({ event_type: 'invoice_overdue', sanitized_payload: { amount: 999 } }, [activeFlow, crmFlow, inboundFlow]).map((f) => f.id),
  ['f1'],
)

// ---- condições -----------------------------------------------------------------
const ctx = { client: { status: 'lead' }, installment: { days_overdue: 5, amount: 500 } }
assert.equal(resolveContextValue('installment.days_overdue', ctx), 5)
assert.equal(evaluateCondition({ field: 'installment.days_overdue', operator: 'gte', value: '3' }, ctx), true)
assert.equal(evaluateCondition({ field: 'installment.days_overdue', operator: 'lt', value: '3' }, ctx), false)
assert.equal(evaluateCondition({ field: 'client.status', operator: 'in', value: 'lead,opportunity' }, ctx), true)
assert.equal(evaluateCondition({ field: 'client.missing', operator: 'exists' }, ctx), false)
assert.equal(evaluateCondition({ field: 'client.missing', operator: 'not_exists' }, ctx), true)
assert.equal(evaluateConditions([{ field: 'client.status', operator: 'eq', value: 'lead' }, { field: 'installment.amount', operator: 'gt', value: '100' }], ctx), true)
assert.equal(evaluateConditions([{ field: 'client.status', operator: 'eq', value: 'churned' }], ctx), false)

// ---- idempotência -------------------------------------------------------------
assert.equal(deriveIdempotencyKey({ id: 'flow-a' }, { id: 'evt-1' }), 'flow-a:evt-1')
assert.equal(deriveIdempotencyKey({ id: 'flow-a' }, { dedupe_key: 'lead_created:c1', id: 'evt-1' }), 'flow-a:lead_created:c1')
assert.equal(
  deriveIdempotencyKey({ id: 'flow-a' }, { id: 'evt-1' }),
  deriveIdempotencyKey({ id: 'flow-a' }, { id: 'evt-1' }),
  'a mesma combinação fluxo+evento gera sempre a mesma chave',
)

// ---- backoff / dead-letter --------------------------------------------------
assert.equal(nextRetryDelaySeconds(1), 30)
assert.equal(nextRetryDelaySeconds(3), 120)
assert.equal(nextRetryDelaySeconds(50), 3600)
assert.deepEqual(deadLetterDecision({ attempts: 1, maxAttempts: 6, retryable: true }), { deadLetter: false, retryAfterSeconds: 30 })
assert.deepEqual(deadLetterDecision({ attempts: 6, maxAttempts: 6, retryable: true }), { deadLetter: true, retryAfterSeconds: null })
assert.deepEqual(deadLetterDecision({ attempts: 1, maxAttempts: 6, retryable: false }), { deadLetter: true, retryAfterSeconds: null })

assert.equal(classifyActionError({ code: 'UPSTREAM_TIMEOUT' }).retryable, true)
assert.equal(classifyActionError({ code: 'TEMPLATE_REJECTED' }).retryable, false)
assert.equal(classifyActionError({ name: 'AbortError' }).code, 'UPSTREAM_TIMEOUT')
assert.equal(classifyActionError({ retryable: true, code: 'CUSTOM' }).retryable, true)

// ---- plano de execução ------------------------------------------------------
const flow = {
  id: 'flow-x',
  activeVersionId: 'v1',
  triggerType: 'manual_event',
  definition: {
    conditions: [],
    actions: [
      { key: 'a1', type: 'add_note', title: 'Nota' },
      { key: 'a2', type: 'wait', minutes: 30 },
      { key: 'a3', type: 'end_flow' },
    ],
  },
}
const plan = planRun(flow, { id: 'evt-9' })
assert.equal(plan.idempotencyKey, 'flow-x:evt-9')
assert.equal(plan.steps.length, 3)
assert.equal(planRun(flow, { id: 'evt-9' }, { resumeFromIndex: 1 }).steps.length, 2)

// ---- executeRun: sucesso -------------------------------------------------
const calls = []
const handlers = {
  add_note: async (action) => { calls.push(['add_note', action.title]); return { recorded: true } },
  send_message: async (action) => { calls.push(['send_message', action.text]); return { provider_message_id: 'wamid.1' } },
}
const success = await executeRun({
  plan: planRun({ ...flow, definition: { conditions: [], actions: [{ key: 's1', type: 'add_note', title: 'X' }, { key: 's2', type: 'end_flow' }] } }, { id: 'e1' }),
  handlers,
  now: FIXED_NOW,
})
assert.equal(success.status, 'succeeded')
assert.equal(success.steps.length, 2)
assert.equal(success.steps[0].status, 'succeeded')
assert.equal(success.steps[1].actionType, 'end_flow')

// ---- executeRun: wait pausa a execução --------------------------------
const waited = await executeRun({ plan, handlers, now: FIXED_NOW })
assert.equal(waited.status, 'waiting')
assert.equal(waited.wait.resumeFromIndex, 2)
assert.equal(waited.wait.resumeAt, new Date(FIXED_NOW.getTime() + 30 * 60000).toISOString())
assert.equal(waited.steps.at(-1).actionType, 'wait')

// ---- executeRun: falha de handler para a execução no passo ------------
const failure = await executeRun({
  plan: planRun({ ...flow, definition: { conditions: [], actions: [{ key: 'f1', type: 'send_message', text: 'oi' }, { key: 'f2', type: 'add_note', title: 'depois' }] } }, { id: 'e2' }),
  handlers: {
    send_message: async () => { throw Object.assign(new Error('Meta rejeitou'), { code: 'TEMPLATE_REJECTED' }) },
    add_note: async () => { throw new Error('não deveria rodar') },
  },
  now: FIXED_NOW,
})
assert.equal(failure.status, 'failed')
assert.equal(failure.errorCode, 'TEMPLATE_REJECTED')
assert.equal(failure.retryable, false)
assert.equal(failure.steps.length, 1)
assert.equal(failure.steps[0].status, 'failed')

// ---- executeRun: handler ausente é falha explícita, não silenciosa ----
const missing = await executeRun({
  plan: planRun({ ...flow, definition: { conditions: [], actions: [{ key: 'm1', type: 'handoff_to_human' }] } }, { id: 'e3' }),
  handlers: {},
  now: FIXED_NOW,
})
assert.equal(missing.status, 'failed')
assert.equal(missing.errorCode, 'HANDLER_MISSING')

console.log('WhatsApp automation executor contracts: ok')
