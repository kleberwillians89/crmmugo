import { ACTION_TYPES, CONDITION_OPERATORS, TERMINAL_ACTIONS, TRIGGER_TYPES, compileAction, describeTrigger } from './automationFlow.js'

export const GRAPH_SCHEMA_VERSION = 2
export const GRAPH_NODE_TYPES = Object.freeze(['trigger', ...ACTION_TYPES, 'condition'])

const id = (prefix, index) => `${prefix}_${index + 1}`
const text = value => String(value ?? '').trim()

export function isGraphDefinition(definition) {
  return Number(definition?.schema_version) === GRAPH_SCHEMA_VERSION && Array.isArray(definition?.nodes) && Array.isArray(definition?.edges)
}

export function createEmptyGraph(triggerType = 'manual_event') {
  return {
    schema_version: GRAPH_SCHEMA_VERSION,
    nodes: [{ id: 'trigger_1', type: 'trigger', position: { x: 80, y: 180 }, config: { trigger_type: triggerType } }],
    edges: [],
  }
}

export function legacyDefinitionToGraph(definition = {}) {
  if (isGraphDefinition(definition)) return normalizeGraph(definition)
  const trigger = definition.trigger || { type: definition.trigger_type || 'manual_event', config: {} }
  const conditions = Array.isArray(definition.conditions) ? definition.conditions.filter(item => text(item?.field)) : []
  const actions = Array.isArray(definition.actions) ? definition.actions : []
  const nodes = [{ id: 'trigger_1', type: 'trigger', position: { x: 80, y: 180 }, config: { trigger_type: trigger.type || 'manual_event', ...(trigger.config || {}) } }]
  const edges = []
  let previous = nodes[0].id
  conditions.forEach((condition, index) => {
    const nodeId = id('condition', index)
    nodes.push({ id: nodeId, type: 'condition', position: { x: 340 + index * 260, y: 180 }, config: { field: text(condition.field), operator: text(condition.operator) || 'eq', value: condition.value ?? '' } })
    edges.push({ id: `edge_${previous}_${nodeId}`, source: previous, target: nodeId, branch: previous.startsWith('condition_') ? 'yes' : 'always' })
    previous = nodeId
  })
  actions.forEach((action, index) => {
    const nodeId = text(action.key) || id('step', index)
    const config = { ...action }
    delete config.key
    delete config.type
    nodes.push({ id: nodeId, type: action.type, position: { x: 340 + (conditions.length + index) * 260, y: 180 }, config })
    edges.push({ id: `edge_${previous}_${nodeId}`, source: previous, target: nodeId, branch: conditions.length && previous.startsWith('condition_') ? 'yes' : 'always' })
    previous = nodeId
  })
  if (conditions.length) {
    const skipId = 'legacy_conditions_not_met'
    nodes.push({ id: skipId, type: 'end_flow', position: { x: 340 + conditions.length * 260, y: 390 }, config: {} })
    conditions.forEach((_condition, index) => {
      const source = id('condition', index)
      edges.push({ id: `edge_${source}_no_${skipId}`, source, target: skipId, branch: 'no' })
    })
  }
  return normalizeGraph({ schema_version: GRAPH_SCHEMA_VERSION, nodes, edges })
}

export function normalizeGraph(input = {}) {
  return {
    schema_version: GRAPH_SCHEMA_VERSION,
    nodes: (Array.isArray(input.nodes) ? input.nodes : []).map((node, index) => ({
      id: text(node?.id) || id('node', index),
      type: text(node?.type),
      position: {
        x: Number.isFinite(Number(node?.position?.x)) ? Number(node.position.x) : 80 + index * 260,
        y: Number.isFinite(Number(node?.position?.y)) ? Number(node.position.y) : 180,
      },
      config: node?.config && typeof node.config === 'object' ? { ...node.config } : {},
    })),
    edges: (Array.isArray(input.edges) ? input.edges : []).map((edge, index) => ({
      id: text(edge?.id) || id('edge', index),
      source: text(edge?.source),
      target: text(edge?.target),
      branch: ['yes', 'no', 'always'].includes(text(edge?.branch)) ? text(edge.branch) : 'always',
    })),
  }
}

export function graphTrigger(graph) {
  const node = normalizeGraph(graph).nodes.find(item => item.type === 'trigger')
  if (!node) return { type: '', config: {} }
  const { trigger_type, ...config } = node.config
  return { type: text(trigger_type), config }
}

const actionError = node => {
  if (!ACTION_TYPES.includes(node.type)) return null
  const compiled = compileAction({ type: node.type, config: node.config })
  if (node.type === 'send_template' && !compiled.template_name) return 'Selecione um template.'
  if (node.type === 'send_template' && !/^[a-z0-9_]{1,100}$/.test(compiled.template_name)) return 'Nome de template inválido.'
  if (node.type === 'send_message' && !compiled.text) return 'Informe a mensagem.'
  if (node.type === 'wait' && Number(compiled.minutes) < 1) return 'A espera deve ser positiva.'
  if (node.type === 'create_task' && !compiled.title) return 'Informe o título da tarefa.'
  if (node.type === 'add_note' && !compiled.title) return 'Informe o título da nota.'
  return null
}

export function validateGraph(input = {}) {
  const graph = normalizeGraph(input)
  const errors = []
  const nodeIds = new Set()
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) errors.push({ nodeId: node.id, code: 'DUPLICATE_NODE', message: 'Identificador de node duplicado.' })
    nodeIds.add(node.id)
    if (!GRAPH_NODE_TYPES.includes(node.type)) errors.push({ nodeId: node.id, code: 'UNKNOWN_NODE', message: `Node desconhecido: ${node.type || 'vazio'}.` })
    const incomplete = actionError(node)
    if (incomplete) errors.push({ nodeId: node.id, code: 'INCOMPLETE_ACTION', message: incomplete })
    if (node.type === 'condition') {
      if (!text(node.config.field)) errors.push({ nodeId: node.id, code: 'CONDITION_FIELD_MISSING', message: 'Informe o campo da condição.' })
      if (!CONDITION_OPERATORS.includes(text(node.config.operator) || 'eq')) errors.push({ nodeId: node.id, code: 'CONDITION_OPERATOR_INVALID', message: 'Operador de condição inválido.' })
      if (!['exists','not_exists'].includes(text(node.config.operator) || 'eq') && !text(node.config.value)) errors.push({ nodeId: node.id, code: 'CONDITION_VALUE_MISSING', message: 'Informe o valor da condição.' })
    }
  }
  const starts = graph.nodes.filter(node => node.type === 'trigger')
  if (starts.length !== 1) errors.push({ code: 'SINGLE_START_REQUIRED', message: 'O fluxo precisa ter exatamente um início.' })
  if (starts[0] && !TRIGGER_TYPES.includes(text(starts[0].config.trigger_type))) errors.push({ nodeId: starts[0].id, code: 'TRIGGER_INVALID', message: 'Gatilho inválido.' })
  if (starts[0]) {
    const trigger = describeTrigger(text(starts[0].config.trigger_type))
    if(trigger&&!trigger.available)errors.push({nodeId:starts[0].id,code:'TRIGGER_UNAVAILABLE',message:trigger.unavailableReason||'Este gatilho ainda não está disponível.'})
    for (const field of trigger?.configFields || []) if (field.required && !text(starts[0].config[field.key])) errors.push({ nodeId: starts[0].id, code: 'TRIGGER_CONFIG_MISSING', message: `Informe: ${field.label}.` })
  }

  const outgoing = new Map(graph.nodes.map(node => [node.id, []]))
  const incoming = new Map(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push({ edgeId: edge.id, code: 'EDGE_ENDPOINT_INVALID', message: 'Conexão aponta para um node inexistente.' })
      continue
    }
    outgoing.get(edge.source).push(edge)
    incoming.get(edge.target).push(edge)
  }
  for (const node of graph.nodes) {
    const branches = outgoing.get(node.id) || []
    if (node.type === 'condition') {
      if (branches.filter(edge => edge.branch === 'yes').length !== 1 || branches.filter(edge => edge.branch === 'no').length !== 1) {
        errors.push({ nodeId: node.id, code: 'CONDITION_BRANCHES_REQUIRED', message: 'Condição precisa de uma saída SIM e uma saída NÃO.' })
      }
    } else if (branches.length > 1) errors.push({ nodeId: node.id, code: 'MULTIPLE_OUTPUTS', message: 'Somente condições podem ter mais de uma saída.' })
    if (node.type !== 'condition' && branches.some(edge => edge.branch !== 'always')) errors.push({ nodeId: node.id, code: 'INVALID_BRANCH', message: 'Somente condições usam saídas SIM/NÃO.' })
    if (TERMINAL_ACTIONS.includes(node.type) && branches.length) errors.push({ nodeId: node.id, code: 'TERMINAL_HAS_OUTPUT', message: 'Um node de encerramento não pode ter saída.' })
    if (node.type !== 'trigger' && !(incoming.get(node.id) || []).length) errors.push({ nodeId: node.id, code: 'DISCONNECTED_NODE', message: 'Node desconectado do fluxo.' })
  }

  if (starts[0]) {
    const visiting = new Set(), visited = new Set()
    const visit = nodeId => {
      if (visiting.has(nodeId)) { errors.push({ nodeId, code: 'INVALID_CYCLE', message: 'Ciclos ainda não são permitidos.' }); return }
      if (visited.has(nodeId)) return
      visiting.add(nodeId)
      for (const edge of outgoing.get(nodeId) || []) visit(edge.target)
      visiting.delete(nodeId);visited.add(nodeId)
    }
    visit(starts[0].id)
    for (const node of graph.nodes) if (!visited.has(node.id)) errors.push({ nodeId: node.id, code: 'UNREACHABLE_NODE', message: 'Node não alcançável a partir do início.' })
  }
  return { valid: errors.length === 0, errors, graph }
}

export function nextGraphNode(graph, nodeId, branch = 'always') {
  const edges = normalizeGraph(graph).edges.filter(edge => edge.source === nodeId)
  return (edges.find(edge => edge.branch === branch) || edges.find(edge => edge.branch === 'always'))?.target || null
}

export function graphNodeAction(node) {
  return compileAction({ type: node.type, config: node.config })
}
