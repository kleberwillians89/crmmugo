import assert from 'node:assert/strict'
import {
  createEmptyGraph,
  isGraphDefinition,
  legacyDefinitionToGraph,
  nextGraphNode,
  validateGraph,
} from '../src/services/whatsapp/automationGraph.js'
import { executeGraphRun } from '../src/services/whatsapp/automationExecutor.js'

const node = (id, type, config = {}, x = 0, y = 0) => ({ id, type, config, position: { x, y } })
const edge = (source, target, branch = 'always') => ({ id: `${source}-${branch}-${target}`, source, target, branch })

assert.equal(isGraphDefinition(createEmptyGraph()), true)
const legacy = legacyDefinitionToGraph({
  trigger: { type: 'manual_event', config: {} },
  conditions: [{ field: 'client.status', operator: 'eq', value: 'lead' }],
  actions: [{ key: 'finish', type: 'end_flow', config: {} }],
})
assert.equal(legacy.schema_version, 2)
assert.equal(nextGraphNode(legacy, 'trigger_1'), 'condition_1')
assert.equal(nextGraphNode(legacy, 'condition_1', 'yes'), 'finish')
assert.equal(nextGraphNode(legacy, 'condition_1', 'no'), 'legacy_conditions_not_met')
assert.equal(validateGraph(legacy).valid, true)

const branched = {
  schema_version: 2,
  nodes: [
    node('start', 'trigger', { trigger_type: 'whatsapp_message_received' }),
    node('is_vip', 'condition', { field: 'client.segment', operator: 'eq', value: 'vip' }),
    node('vip_note', 'add_note', { title: 'VIP respondeu' }),
    node('wait', 'wait', { minutes: 15 }),
    node('ordinary_end', 'end_flow'),
    node('vip_end', 'end_flow'),
  ],
  edges: [
    edge('start', 'is_vip'),
    edge('is_vip', 'vip_note', 'yes'),
    edge('is_vip', 'ordinary_end', 'no'),
    edge('vip_note', 'wait'),
    edge('wait', 'vip_end'),
  ],
}
assert.deepEqual(validateGraph(branched).errors, [])

const calls = []
const first = await executeGraphRun({
  definition: branched,
  context: { client: { segment: 'vip' } },
  handlers: { add_note: async (action) => { calls.push(action.title); return { event_id: 'evt-1' } } },
  now: () => new Date('2026-08-31T12:00:00.000Z'),
})
assert.equal(first.status, 'waiting')
assert.deepEqual(first.steps.map((item) => item.key), ['is_vip', 'vip_note', 'wait'])
assert.equal(first.steps[0].result.branch, 'yes')
assert.equal(first.wait.resumeNodeId, 'vip_end')
assert.equal(first.wait.resumeAt, '2026-08-31T12:15:00.000Z')
assert.deepEqual(calls, ['VIP respondeu'])

const resumed = await executeGraphRun({
  definition: branched,
  resumeNodeId: first.wait.resumeNodeId,
  context: { client: { segment: 'vip' } },
  now: () => new Date('2026-08-31T12:15:00.000Z'),
})
assert.equal(resumed.status, 'succeeded')
assert.deepEqual(resumed.steps.map((item) => item.key), ['vip_end'])

const ordinary = await executeGraphRun({
  definition: branched,
  context: { client: { segment: 'regular' } },
  now: () => new Date('2026-08-31T12:00:00.000Z'),
})
assert.equal(ordinary.status, 'succeeded')
assert.deepEqual(ordinary.steps.map((item) => item.key), ['is_vip', 'ordinary_end'])
assert.equal(ordinary.steps[0].result.branch, 'no')

const retryFailure = await executeGraphRun({
  definition: branched,
  context: { client: { segment: 'vip' } },
  handlers: { add_note: async () => { throw Object.assign(new Error('temporário'), { code: 'NETWORK_ERROR' }) } },
  now: () => new Date('2026-08-31T12:00:00.000Z'),
})
assert.equal(retryFailure.status, 'failed')
assert.equal(retryFailure.retryable, true)
assert.equal(retryFailure.resumeNodeId, 'vip_note')
const retrySuccess = await executeGraphRun({
  definition: branched,
  resumeNodeId: retryFailure.resumeNodeId,
  context: { client: { segment: 'vip' } },
  handlers: { add_note: async () => ({ event_id: 'evt-retry' }) },
  now: () => new Date('2026-08-31T12:01:00.000Z'),
})
assert.equal(retrySuccess.status, 'waiting')
assert.deepEqual(retrySuccess.steps.map((item) => item.key), ['vip_note', 'wait'])

const disconnected = structuredClone(branched)
disconnected.edges = disconnected.edges.filter((item) => item.target !== 'ordinary_end')
assert.ok(validateGraph(disconnected).errors.some((item) => item.code === 'CONDITION_BRANCHES_REQUIRED'))
assert.ok(validateGraph(disconnected).errors.some((item) => item.code === 'DISCONNECTED_NODE'))

const cyclic = structuredClone(branched)
cyclic.edges = cyclic.edges.filter((item) => item.source !== 'wait')
cyclic.edges.push(edge('wait', 'is_vip'))
assert.ok(validateGraph(cyclic).errors.some((item) => item.code === 'INVALID_CYCLE'))

const badTemplate = legacyDefinitionToGraph({ trigger: { type: 'crm_event', config: {} }, actions: [{ type: 'send_template', config: { template_name: 'Nome Inválido' } }] })
const badTemplateErrors = validateGraph(badTemplate).errors
assert.ok(badTemplateErrors.some((item) => item.code === 'TRIGGER_CONFIG_MISSING'))
assert.ok(badTemplateErrors.some((item) => item.code === 'INCOMPLETE_ACTION'))

console.log('WhatsApp automation graph contracts: ok')
