import assert from 'node:assert/strict'
import {
  ACTION_CATALOG,
  ACTION_TYPES,
  TRIGGER_CATALOG,
  compileAction,
  compileFlowDefinition,
  describeAction,
  describeTrigger,
  isTriggerAvailable,
  nextStatusFor,
  normalizeFlowDefinition,
  validateFlowDefinition,
} from '../src/services/whatsapp/automationFlow.js'

// ---- integridade do catálogo ---------------------------------------------------------
assert.ok(TRIGGER_CATALOG.length >= 4)
assert.ok(TRIGGER_CATALOG.every((t) => typeof t.type === 'string' && typeof t.available === 'boolean'))
assert.equal(isTriggerAvailable('manual_event'), true)
assert.equal(isTriggerAvailable('whatsapp_message_received'), true)
assert.equal(describeTrigger('nope'), null)
assert.equal(describeAction('send_template').type, 'send_template')
assert.deepEqual(ACTION_TYPES.slice().sort(), ACTION_CATALOG.map((a) => a.type).slice().sort())

// ---- normalização tolerante --------------------------------------------------------
const normalized = normalizeFlowDefinition({
  trigger_type: 'lead_created',
  conditions: [{ field: 'client.status', operator: 'eq', value: 'lead' }, { field: '' }],
  actions: [{ type: 'add_note', config: { title: 'Oi' } }, { type: '' }],
})
assert.equal(normalized.trigger.type, 'lead_created')
assert.equal(normalized.conditions.length, 1)
assert.equal(normalized.actions.length, 1)
assert.equal(normalized.actions[0].key, 'step_1')

// ---- compilação de ações ---------------------------------------------------------
assert.deepEqual(
  compileAction({ type: 'send_template', config: { template_name: 'x', body_parameters: 'a\nb\n\n' } }),
  { type: 'send_template', template_name: 'x', language: 'pt_BR', body_parameters: ['a', 'b'] },
)
assert.equal(compileAction({ type: 'wait', config: { minutes: '0' } }).minutes, 1)
assert.equal(compileAction({ type: 'create_task', config: { priority: 'bogus' } }).priority, 'medium')

// ---- validação: caminhos de erro --------------------------------------------------
const inboundTrigger = validateFlowDefinition({ trigger: { type: 'whatsapp_message_received' }, actions: [{ type: 'end_flow' }] }, { name: 'Fluxo' })
assert.equal(inboundTrigger.valid, true)

const noActions = validateFlowDefinition({ trigger: { type: 'manual_event' }, actions: [] }, { name: 'Fluxo' })
assert.equal(noActions.valid, false)
assert.ok(noActions.errors.some((e) => e.path === 'actions'))

const missingConfig = validateFlowDefinition(
  { trigger: { type: 'manual_event' }, actions: [{ type: 'send_template', config: { language: 'pt_BR' } }] },
  { name: 'Fluxo' },
)
assert.equal(missingConfig.valid, false)
assert.ok(missingConfig.errors.some((e) => e.path === 'actions.0.config.template_name'))

const endNotLast = validateFlowDefinition(
  { trigger: { type: 'manual_event' }, actions: [{ type: 'end_flow' }, { type: 'add_note', config: { title: 'x' } }] },
  { name: 'Fluxo' },
)
assert.equal(endNotLast.valid, false)

const shortName = validateFlowDefinition({ trigger: { type: 'manual_event' }, actions: [{ type: 'end_flow' }] }, { name: 'x' })
assert.equal(shortName.valid, false)
assert.ok(shortName.errors.some((e) => e.path === 'name'))

const triggerConfigMissing = validateFlowDefinition(
  { trigger: { type: 'crm_event', config: {} }, actions: [{ type: 'end_flow' }] },
  { name: 'Fluxo válido' },
)
assert.equal(triggerConfigMissing.valid, false)
assert.ok(triggerConfigMissing.errors.some((e) => e.path === 'trigger.config.event_name'))

// ---- validação: caminho feliz --------------------------------------------------
const ok = validateFlowDefinition(
  {
    trigger: { type: 'invoice_overdue', config: { min_amount: '100' } },
    conditions: [{ field: 'installment.days_overdue', operator: 'gte', value: '3' }],
    actions: [
      { type: 'send_template', config: { template_name: 'mugo_alerta_pagamento_pendente', language: 'pt_BR' } },
      { type: 'wait', config: { minutes: '60' } },
      { type: 'create_task', config: { title: 'Ligar para o cliente' } },
      { type: 'end_flow' },
    ],
  },
  { name: 'Régua de cobrança' },
)
assert.equal(ok.valid, true)
assert.equal(ok.errors.length, 0)
assert.equal(ok.definition.actions.length, 4)
assert.equal(ok.definition.actions[0].template_name, 'mugo_alerta_pagamento_pendente')

// compileFlowDefinition é idempotente
assert.deepEqual(compileFlowDefinition(ok.definition), ok.definition)

// ---- transições de status --------------------------------------------------------
assert.equal(nextStatusFor('activate', 'draft'), 'active')
assert.equal(nextStatusFor('pause', 'active'), 'paused')
assert.equal(nextStatusFor('archive', 'paused'), 'archived')
assert.equal(nextStatusFor('restore', 'archived'), 'draft')
assert.equal(nextStatusFor('activate', 'archived'), null)
assert.equal(nextStatusFor('pause', 'paused'), null)
assert.equal(nextStatusFor('bogus', 'draft'), null)

console.log('WhatsApp automation flow contracts: ok')
