// Contrato de fluxos de automação do WhatsApp — puro, sem I/O.
// Fonte única da verdade compartilhada entre editor (frontend), repositório e executor.

// Gatilhos que a arquitetura atual consegue realmente originar. Cada um declara como é
// produzido para que a interface não ofereça algo sem suporte real.
export const TRIGGER_CATALOG = Object.freeze([
  {
    type: 'manual_event',
    label: 'Evento manual',
    description: 'Disparado por uma pessoa a partir de um botão no CRM.',
    origin: 'crm_button',
    available: true,
    configFields: [],
  },
  {
    type: 'crm_event',
    label: 'Evento de CRM',
    description: 'Disparado quando o CRM registra um evento comercial e o encaminha para a fila.',
    origin: 'crm_enqueue',
    available: true,
    configFields: [
      { key: 'event_name', label: 'Nome do evento comercial', type: 'text', required: true, placeholder: 'ex.: proposal_accepted' },
    ],
  },
  {
    type: 'lead_created',
    label: 'Lead criado',
    description: 'Disparado quando um cliente é cadastrado como lead ou oportunidade.',
    origin: 'db_trigger',
    available: true,
    configFields: [],
  },
  {
    type: 'invoice_overdue',
    label: 'Cobrança vencida',
    description: 'Disparado quando uma parcela passa para o estado vencido.',
    origin: 'db_trigger',
    available: true,
    configFields: [
      { key: 'min_amount', label: 'Valor mínimo (R$)', type: 'number', required: false },
    ],
  },
  {
    type: 'client_inactive',
    label: 'Cliente inativo',
    description: 'Disparado por varredura agendada de clientes sem interação recente.',
    origin: 'scheduled_scan',
    available: false,
    unavailableReason: 'Requer o agendador do executor (bloqueio externo de infraestrutura).',
    configFields: [
      { key: 'inactive_days', label: 'Dias sem interação', type: 'number', required: true },
    ],
  },
  {
    type: 'whatsapp_message_received',
    label: 'Mensagem recebida',
    description: 'Disparado quando um contato responde no WhatsApp.',
    origin: 'provider_webhook',
    available: false,
    unavailableReason: 'Requer o webhook do MugoZap encaminhando eventos ao Supabase (bloqueio externo).',
    configFields: [],
  },
])

export const ACTION_CATALOG = Object.freeze([
  {
    type: 'send_template',
    label: 'Enviar template',
    description: 'Envia um template aprovado pela Meta.',
    configFields: [
      { key: 'template_name', label: 'Nome do template', type: 'text', required: true },
      { key: 'language', label: 'Idioma', type: 'text', required: true, default: 'pt_BR' },
      { key: 'body_parameters', label: 'Parâmetros do corpo (um por linha)', type: 'textarea', required: false },
    ],
  },
  {
    type: 'send_message',
    label: 'Enviar mensagem livre',
    description: 'Envia texto livre. Só funciona dentro da janela de atendimento de 24h.',
    configFields: [
      { key: 'text', label: 'Texto da mensagem', type: 'textarea', required: true },
    ],
  },
  {
    type: 'add_note',
    label: 'Registrar informação',
    description: 'Adiciona um evento comercial ao histórico do cliente.',
    configFields: [
      { key: 'title', label: 'Título', type: 'text', required: true },
      { key: 'text', label: 'Descrição', type: 'textarea', required: false },
    ],
  },
  {
    type: 'create_task',
    label: 'Criar tarefa',
    description: 'Cria uma tarefa operacional no CRM.',
    configFields: [
      { key: 'title', label: 'Título da tarefa', type: 'text', required: true },
      { key: 'priority', label: 'Prioridade', type: 'select', required: false, options: ['low', 'medium', 'high', 'critical'], default: 'medium' },
      { key: 'due_in_days', label: 'Prazo (dias a partir de hoje)', type: 'number', required: false },
    ],
  },
  {
    type: 'wait',
    label: 'Aguardar',
    description: 'Pausa o fluxo por um período antes da próxima ação.',
    configFields: [
      { key: 'minutes', label: 'Minutos de espera', type: 'number', required: true },
    ],
  },
  {
    type: 'handoff_to_human',
    label: 'Transferir para humano',
    description: 'Pausa o bot e sinaliza a conversa para atendimento humano.',
    configFields: [
      { key: 'note', label: 'Observação para o atendente', type: 'text', required: false },
    ],
  },
  {
    type: 'end_flow',
    label: 'Finalizar fluxo',
    description: 'Encerra a execução de forma explícita.',
    configFields: [],
  },
])

export const CONDITION_OPERATORS = Object.freeze([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'exists', 'not_exists',
])

export const TRIGGER_TYPES = Object.freeze(TRIGGER_CATALOG.map((item) => item.type))
export const ACTION_TYPES = Object.freeze(ACTION_CATALOG.map((item) => item.type))
export const TERMINAL_ACTIONS = Object.freeze(['end_flow'])

const triggerByType = new Map(TRIGGER_CATALOG.map((item) => [item.type, item]))
const actionByType = new Map(ACTION_CATALOG.map((item) => [item.type, item]))

export const describeTrigger = (type) => triggerByType.get(type) || null
export const describeAction = (type) => actionByType.get(type) || null
export const isTriggerAvailable = (type) => Boolean(triggerByType.get(type)?.available)

const asText = (value) => String(value ?? '').trim()
const asLines = (value) =>
  asText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

// Estrutura canônica de um fluxo, tolerante a entradas parciais do editor.
export function normalizeFlowDefinition(input = {}) {
  const trigger = input.trigger && typeof input.trigger === 'object' ? input.trigger : {}
  const conditions = Array.isArray(input.conditions) ? input.conditions : []
  const actions = Array.isArray(input.actions) ? input.actions : []
  return {
    trigger: {
      type: asText(trigger.type) || asText(input.trigger_type),
      config: trigger.config && typeof trigger.config === 'object' ? trigger.config : {},
    },
    conditions: conditions
      .map((condition) => ({
        field: asText(condition?.field),
        operator: asText(condition?.operator) || 'eq',
        value: condition?.value ?? '',
      }))
      .filter((condition) => condition.field),
    actions: actions
      .map((action, index) => ({
        key: asText(action?.key) || `step_${index + 1}`,
        type: asText(action?.type),
        // Aceita tanto a forma do editor ({ type, config }) quanto uma ação já
        // compilada ({ type, template_name, ... }), tornando compileFlowDefinition idempotente.
        config:
          action?.config && typeof action.config === 'object'
            ? action.config
            : action && typeof action === 'object'
              ? action
              : {},
      }))
      .filter((action) => action.type),
  }
}

// Converte a definição do editor em envelope de ação normalizado para o executor.
export function compileAction(action) {
  const type = asText(action?.type)
  const config = action?.config && typeof action.config === 'object' ? action.config : {}
  switch (type) {
    case 'send_template':
      return {
        type,
        template_name: asText(config.template_name),
        language: asText(config.language) || 'pt_BR',
        body_parameters: Array.isArray(config.body_parameters)
          ? config.body_parameters.map(asText).filter(Boolean)
          : asLines(config.body_parameters),
      }
    case 'send_message':
      return { type, text: asText(config.text) }
    case 'add_note':
      return { type, title: asText(config.title), text: asText(config.text) }
    case 'create_task':
      return {
        type,
        title: asText(config.title),
        priority: ['low', 'medium', 'high', 'critical'].includes(asText(config.priority))
          ? asText(config.priority)
          : 'medium',
        due_in_days:
          config.due_in_days === null || config.due_in_days === undefined || config.due_in_days === '' || !Number.isFinite(Number(config.due_in_days))
            ? null
            : Math.max(0, Math.trunc(Number(config.due_in_days))),
      }
    case 'wait':
      return { type, minutes: Math.max(1, Math.trunc(Number(config.minutes) || 0)) }
    case 'handoff_to_human':
      return { type, note: asText(config.note) }
    case 'end_flow':
      return { type }
    default:
      return { type, config }
  }
}

export function compileFlowDefinition(input = {}) {
  const normalized = normalizeFlowDefinition(input)
  return {
    trigger: normalized.trigger,
    conditions: normalized.conditions,
    actions: normalized.actions.map((action, index) => ({
      key: action.key || `step_${index + 1}`,
      ...compileAction(action),
    })),
  }
}

// Validação usada tanto pelo editor quanto pelo repositório antes de persistir.
export function validateFlowDefinition(input = {}, { name } = {}) {
  const errors = []
  const definition = normalizeFlowDefinition(input)
  const trimmedName = asText(name)

  if (name !== undefined && (trimmedName.length < 2 || trimmedName.length > 120)) {
    errors.push({ path: 'name', message: 'O nome do fluxo deve ter entre 2 e 120 caracteres.' })
  }

  const trigger = describeTrigger(definition.trigger.type)
  if (!trigger) {
    errors.push({ path: 'trigger.type', message: 'Selecione um gatilho válido.' })
  } else {
    if (!trigger.available) {
      errors.push({ path: 'trigger.type', message: trigger.unavailableReason || 'Este gatilho ainda não está disponível.' })
    }
    for (const field of trigger.configFields) {
      if (field.required && !asText(definition.trigger.config[field.key])) {
        errors.push({ path: `trigger.config.${field.key}`, message: `Preencha "${field.label}".` })
      }
    }
  }

  for (const [index, condition] of definition.conditions.entries()) {
    if (!CONDITION_OPERATORS.includes(condition.operator)) {
      errors.push({ path: `conditions.${index}.operator`, message: `Operador inválido em "${condition.field}".` })
    }
    if (
      !['exists', 'not_exists'].includes(condition.operator) &&
      (condition.value === '' || condition.value === null || condition.value === undefined)
    ) {
      errors.push({ path: `conditions.${index}.value`, message: `Informe o valor da condição "${condition.field}".` })
    }
  }

  if (!definition.actions.length) {
    errors.push({ path: 'actions', message: 'Adicione ao menos uma ação.' })
  }
  for (const [index, action] of definition.actions.entries()) {
    const spec = describeAction(action.type)
    if (!spec) {
      errors.push({ path: `actions.${index}.type`, message: 'Ação não reconhecida.' })
      continue
    }
    const compiled = compileAction(action)
    for (const field of spec.configFields) {
      if (!field.required) continue
      const value = compiled[field.key] ?? action.config[field.key]
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && !value.trim()) ||
        (Array.isArray(value) && !value.length)
      if (empty) errors.push({ path: `actions.${index}.config.${field.key}`, message: `Preencha "${field.label}" na ação "${spec.label}".` })
    }
    if (action.type === 'wait' && compiled.minutes < 1) {
      errors.push({ path: `actions.${index}.config.minutes`, message: 'A espera deve ser de pelo menos 1 minuto.' })
    }
    if (action.type === 'end_flow' && index !== definition.actions.length - 1) {
      errors.push({ path: `actions.${index}`, message: '"Finalizar fluxo" precisa ser a última ação.' })
    }
  }

  return { valid: errors.length === 0, errors, definition: compileFlowDefinition(input) }
}

export const STATUS_LABELS = Object.freeze({
  draft: 'Rascunho',
  active: 'Ativo',
  paused: 'Pausado',
  archived: 'Arquivado',
})

export const RUN_STATUS_LABELS = Object.freeze({
  pending: 'Na fila',
  running: 'Executando',
  succeeded: 'Concluída',
  failed: 'Falhou',
  skipped: 'Ignorada',
  dead_letter: 'Falha definitiva',
  waiting: 'Aguardando',
})

// Transições de status permitidas a partir do editor.
export function nextStatusFor(action, current) {
  const map = {
    activate: 'active',
    pause: 'paused',
    archive: 'archived',
    restore: 'draft',
  }
  const target = map[action]
  if (!target) return null
  if (current === 'archived' && action !== 'restore') return null
  if (target === current) return null
  return target
}
