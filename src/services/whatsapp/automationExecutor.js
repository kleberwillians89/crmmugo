// Núcleo do executor de automações — puro, determinístico, sem I/O.
// É importado tanto pela edge function `whatsapp-automation-worker` quanto pelos testes,
// que injetam handlers de ação para exercitar o comportamento real sem rede.

import { CONDITION_OPERATORS, TERMINAL_ACTIONS, describeAction } from './automationFlow.js'
import { graphNodeAction, graphTrigger, isGraphDefinition, nextGraphNode, normalizeGraph } from './automationGraph.js'

const RETRYABLE_CODES = new Set([
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_COLD_START',
  'UPSTREAM_UNAVAILABLE',
  'MUGOZAP_TEMPORARY_ERROR',
  'META_TEMPORARY_ERROR',
  'RATE_LIMITED',
  'NETWORK_ERROR',
])

const MAX_RETRY_DELAY_SECONDS = 3600

export function nextRetryDelaySeconds(attempts) {
  const normalized = Math.max(1, Math.trunc(Number(attempts) || 1))
  return Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** (normalized - 1))
}

export function classifyActionError(error) {
  const code =
    (error && (error.code || error.error_code)) ||
    (error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'ACTION_FAILED')
  const retryable =
    typeof error?.retryable === 'boolean' ? error.retryable : RETRYABLE_CODES.has(code)
  return {
    code: String(code),
    retryable,
    message: String(error?.message || 'A ação falhou.').slice(0, 500),
    provider_message: error?.provider_message ? String(error.provider_message).slice(0, 500) : undefined,
  }
}

export function deadLetterDecision({ attempts, maxAttempts = 6, retryable = false }) {
  const used = Math.max(0, Math.trunc(Number(attempts) || 0))
  const ceiling = Math.max(1, Math.trunc(Number(maxAttempts) || 1))
  if (!retryable) return { deadLetter: true, retryAfterSeconds: null }
  if (used >= ceiling) return { deadLetter: true, retryAfterSeconds: null }
  return { deadLetter: false, retryAfterSeconds: nextRetryDelaySeconds(used) }
}

// Chave de idempotência estável: um evento nunca dispara o mesmo fluxo duas vezes.
export function deriveIdempotencyKey(flow, event) {
  const flowId = String(flow?.id || flow?.flowId || '')
  const eventKey = String(event?.dedupe_key || event?.id || event?.event_id || '')
  return `${flowId}:${eventKey}`
}

function toComparable(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'number') return value
  const asNumber = Number(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(asNumber)) return asNumber
  return String(value)
}

export function resolveContextValue(path, context) {
  return String(path || '')
    .split('.')
    .reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), context)
}

export function evaluateCondition(condition, context) {
  const actual = resolveContextValue(condition.field, context)
  const operator = CONDITION_OPERATORS.includes(condition.operator) ? condition.operator : 'eq'
  const expected = condition.value

  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== ''
    case 'not_exists':
      return actual === undefined || actual === null || actual === ''
    case 'eq':
      return toComparable(actual) === toComparable(expected)
    case 'neq':
      return toComparable(actual) !== toComparable(expected)
    case 'gt':
      return Number(actual) > Number(expected)
    case 'gte':
      return Number(actual) >= Number(expected)
    case 'lt':
      return Number(actual) < Number(expected)
    case 'lte':
      return Number(actual) <= Number(expected)
    case 'in':
      return String(expected)
        .split(',')
        .map((item) => item.trim())
        .includes(String(actual))
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase())
    default:
      return false
  }
}

export function evaluateConditions(conditions = [], context = {}) {
  return conditions.every((condition) => evaluateCondition(condition, context))
}

function triggerConfigMatches(flow, event) {
  const config = flow?.triggerConfig || flow?.trigger_config || {}
  const payload = event?.sanitized_payload || event?.payload || {}
  switch (flow?.triggerType || flow?.trigger_type) {
    case 'crm_event':
      return !config.event_name || String(payload.event_name || '') === String(config.event_name)
    case 'invoice_overdue':
      return config.min_amount == null || Number(payload.amount || 0) >= Number(config.min_amount)
    case 'client_inactive':
      return (
        config.inactive_days == null ||
        Number(payload.inactive_days || 0) >= Number(config.inactive_days)
      )
    default:
      return true
  }
}

export function matchFlow(flow, event) {
  if (!flow || flow.status !== 'active') return false
  const flowTrigger = flow.triggerType || flow.trigger_type
  const eventType = event?.event_type || event?.eventType
  if (!flowTrigger || flowTrigger !== eventType) return false
  return triggerConfigMatches(flow, event)
}

export function selectFlows(event, flows = []) {
  return flows.filter((flow) => matchFlow(flow, event))
}

// Monta o plano de execução (passos) a partir da definição da versão ativa.
export function planRun(flow, event, { resumeFromIndex = 0 } = {}) {
  const definition = flow?.definition || {}
  const actions = Array.isArray(definition.actions) ? definition.actions : []
  return {
    flowId: flow.id,
    versionId: flow.activeVersionId || flow.active_version_id || null,
    triggerType: flow.triggerType || flow.trigger_type || '',
    idempotencyKey: deriveIdempotencyKey(flow, event),
    conditions: Array.isArray(definition.conditions) ? definition.conditions : [],
    steps: actions
      .map((action, index) => ({
        key: action.key || `step_${index + 1}`,
        index,
        action,
      }))
      .filter((step) => step.index >= resumeFromIndex),
  }
}

const clock = (now) => (typeof now === 'function' ? now() : now || new Date())

// Executa um plano. `handlers` mapeia action.type -> async (action, ctx) => result.
// `wait` e `end_flow` são tratados aqui e nunca chegam aos handlers.
export async function executeRun({ plan, handlers = {}, context = {}, now, attempts = 1 }) {
  const steps = []
  const startedAt = clock(now).toISOString()

  for (const step of plan.steps) {
    const type = step.action?.type
    const spec = describeAction(type)
    const stepStartedAt = clock(now).toISOString()

    if (!spec) {
      steps.push({
        key: step.key,
        index: step.index,
        actionType: type || 'unknown',
        status: 'failed',
        errorCode: 'UNKNOWN_ACTION',
        errorMessage: `Ação não reconhecida: ${type}`,
        result: {},
        startedAt: stepStartedAt,
        finishedAt: stepStartedAt,
      })
      return { status: 'failed', steps, errorCode: 'UNKNOWN_ACTION', errorMessage: `Ação não reconhecida: ${type}`, startedAt, finishedAt: stepStartedAt, wait: null }
    }

    if (type === 'end_flow') {
      steps.push({
        key: step.key,
        index: step.index,
        actionType: type,
        status: 'succeeded',
        result: { ended: true },
        startedAt: stepStartedAt,
        finishedAt: stepStartedAt,
      })
      return { status: 'succeeded', steps, startedAt, finishedAt: clock(now).toISOString(), wait: null }
    }

    if (type === 'wait') {
      const minutes = Math.max(1, Math.trunc(Number(step.action.minutes) || 0))
      const resumeAt = new Date(clock(now).getTime() + minutes * 60_000).toISOString()
      steps.push({
        key: step.key,
        index: step.index,
        actionType: type,
        status: 'succeeded',
        result: { waited_minutes: minutes, resume_at: resumeAt },
        startedAt: stepStartedAt,
        finishedAt: stepStartedAt,
      })
      return {
        status: 'waiting',
        steps,
        startedAt,
        finishedAt: null,
        wait: { resumeFromIndex: step.index + 1, resumeAt, minutes },
      }
    }

    const handler = handlers[type]
    if (typeof handler !== 'function') {
      steps.push({
        key: step.key,
        index: step.index,
        actionType: type,
        status: 'failed',
        errorCode: 'HANDLER_MISSING',
        errorMessage: `Nenhum executor conectado para a ação "${type}".`,
        result: {},
        startedAt: stepStartedAt,
        finishedAt: clock(now).toISOString(),
      })
      return {
        status: 'failed',
        steps,
        errorCode: 'HANDLER_MISSING',
        errorMessage: `Nenhum executor conectado para a ação "${type}".`,
        retryable: false,
        startedAt,
        finishedAt: clock(now).toISOString(),
        wait: null,
      }
    }

    try {
      const result = await handler(step.action, { ...context, step, attempts })
      steps.push({
        key: step.key,
        index: step.index,
        actionType: type,
        status: 'succeeded',
        result: result && typeof result === 'object' ? result : { ok: true },
        startedAt: stepStartedAt,
        finishedAt: clock(now).toISOString(),
      })
    } catch (error) {
      const classified = classifyActionError(error)
      steps.push({
        key: step.key,
        index: step.index,
        actionType: type,
        status: 'failed',
        errorCode: classified.code,
        errorMessage: classified.message,
        result: classified.provider_message ? { provider_message: classified.provider_message } : {},
        startedAt: stepStartedAt,
        finishedAt: clock(now).toISOString(),
      })
      return {
        status: 'failed',
        steps,
        errorCode: classified.code,
        errorMessage: classified.message,
        retryable: classified.retryable,
        resumeFromIndex: step.index,
        startedAt,
        finishedAt: clock(now).toISOString(),
        wait: null,
      }
    }
  }

  return { status: 'succeeded', steps, startedAt, finishedAt: clock(now).toISOString(), wait: null }
}

export async function executeGraphRun({ definition, handlers = {}, context = {}, now, attempts = 1, resumeNodeId = null }) {
  const graph = normalizeGraph(definition)
  const trigger = graph.nodes.find(node => node.type === 'trigger')
  let nodeId = resumeNodeId || (trigger ? nextGraphNode(graph, trigger.id) : null)
  const steps = []
  const startedAt = clock(now).toISOString()
  let sequence = 0

  while (nodeId && sequence <= graph.nodes.length) {
    const node = graph.nodes.find(item => item.id === nodeId)
    const stepStartedAt = clock(now).toISOString()
    if (!node) return { status: 'failed', steps, errorCode: 'GRAPH_NODE_MISSING', errorMessage: `Node ${nodeId} não encontrado.`, startedAt, finishedAt: stepStartedAt }

    if (node.type === 'condition') {
      const passed = evaluateCondition({ field: node.config.field, operator: node.config.operator || 'eq', value: node.config.value }, context)
      steps.push({ key: node.id, index: sequence, actionType: 'condition', status: 'succeeded', result: { branch: passed ? 'yes' : 'no', passed }, startedAt: stepStartedAt, finishedAt: clock(now).toISOString() })
      nodeId = nextGraphNode(graph, node.id, passed ? 'yes' : 'no')
      sequence += 1
      continue
    }

    const action = graphNodeAction(node)
    if (node.type === 'end_flow') {
      steps.push({ key: node.id, index: sequence, actionType: node.type, status: 'succeeded', result: { ended: true }, startedAt: stepStartedAt, finishedAt: stepStartedAt })
      return { status: 'succeeded', steps, startedAt, finishedAt: clock(now).toISOString(), wait: null }
    }
    if (node.type === 'wait') {
      const minutes = Math.max(1, Math.trunc(Number(action.minutes) || 0))
      const resumeAt = new Date(clock(now).getTime() + minutes * 60_000).toISOString()
      const nextNodeId = nextGraphNode(graph, node.id)
      steps.push({ key: node.id, index: sequence, actionType: node.type, status: 'succeeded', result: { waited_minutes: minutes, resume_at: resumeAt, resume_node_id: nextNodeId }, startedAt: stepStartedAt, finishedAt: stepStartedAt })
      return { status: 'waiting', steps, startedAt, finishedAt: null, wait: { resumeNodeId: nextNodeId, resumeAt, minutes } }
    }
    const handler = handlers[node.type]
    if (typeof handler !== 'function') return { status: 'failed', steps: [...steps, { key: node.id, index: sequence, actionType: node.type, status: 'failed', errorCode: 'HANDLER_MISSING', errorMessage: `Nenhum executor conectado para a ação "${node.type}".`, result: {}, startedAt: stepStartedAt, finishedAt: clock(now).toISOString() }], errorCode: 'HANDLER_MISSING', errorMessage: `Nenhum executor conectado para a ação "${node.type}".`, retryable: false, resumeNodeId: node.id, startedAt, finishedAt: clock(now).toISOString(), wait: null }
    try {
      const result = await handler(action, { ...context, step: { key: node.id, index: sequence, action }, attempts })
      steps.push({ key: node.id, index: sequence, actionType: node.type, status: 'succeeded', result: result && typeof result === 'object' ? result : { ok: true }, startedAt: stepStartedAt, finishedAt: clock(now).toISOString() })
      nodeId = nextGraphNode(graph, node.id)
      sequence += 1
    } catch (error) {
      const classified = classifyActionError(error)
      steps.push({ key: node.id, index: sequence, actionType: node.type, status: 'failed', errorCode: classified.code, errorMessage: classified.message, result: classified.provider_message ? { provider_message: classified.provider_message } : {}, startedAt: stepStartedAt, finishedAt: clock(now).toISOString() })
      return { status: 'failed', steps, errorCode: classified.code, errorMessage: classified.message, retryable: classified.retryable, resumeNodeId: node.id, startedAt, finishedAt: clock(now).toISOString(), wait: null }
    }
  }
  if (sequence > graph.nodes.length) return { status: 'failed', steps, errorCode: 'GRAPH_CYCLE_DETECTED', errorMessage: 'O grafo entrou em um ciclo inválido.', retryable: false, startedAt, finishedAt: clock(now).toISOString() }
  return { status: 'succeeded', steps, startedAt, finishedAt: clock(now).toISOString(), wait: null }
}

export function graphFlowTrigger(definition) {
  return isGraphDefinition(definition) ? graphTrigger(definition) : null
}

export { TERMINAL_ACTIONS }
