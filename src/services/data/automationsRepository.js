import {
  compileFlowDefinition,
  describeTrigger,
  nextStatusFor,
  normalizeFlowDefinition,
  validateFlowDefinition,
} from '../whatsapp/automationFlow.js'

const unwrap = ({ data, error }) => {
  if (error) throw error
  return data
}

// Injeção opcional de cliente/organização para testes de comportamento;
// o provider real só é carregado quando nada foi injetado.
async function context(options = {}) {
  let client = options.client
  let organizationId = options.organizationId
  if (!client || !organizationId) {
    const provider = await import('./provider.js')
    client = client || provider.db()
    organizationId = organizationId || (await provider.organizationId())
  }
  if (!client) throw new Error('Supabase indisponível para automações.')
  if (!organizationId) throw new Error('Organização não identificada.')
  return { client, organizationId }
}

const FLOW_COLUMNS =
  'id,organization_id,name,description,trigger_type,trigger_config,status,active_version_id,run_count,last_run_at,archived_at,created_at,updated_at'

// ---- helpers puros (testáveis isoladamente) -------------------------------------------

export function toFlowSummary(row = {}, version = null) {
  const definition = version?.definition
    ? compileFlowDefinition(version.definition)
    : compileFlowDefinition({ trigger: { type: row.trigger_type, config: row.trigger_config } })
  return {
    id: row.id,
    name: row.name || 'Fluxo sem nome',
    description: row.description || '',
    triggerType: row.trigger_type || definition.trigger.type || '',
    triggerLabel: describeTrigger(row.trigger_type || definition.trigger.type)?.label || row.trigger_type || '—',
    triggerConfig: row.trigger_config || definition.trigger.config || {},
    status: row.status || 'draft',
    activeVersionId: row.active_version_id || version?.id || null,
    activeVersion: version?.version ?? null,
    runCount: Number(row.run_count || 0),
    lastRunAt: row.last_run_at || null,
    definition,
    actionCount: definition.actions.length,
    conditionCount: definition.conditions.length,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export function nextVersionNumber(existing = []) {
  return existing.reduce((max, row) => Math.max(max, Number(row?.version || 0)), 0) + 1
}

export function buildFlowRow({ organizationId, name, definition, createdBy = null }) {
  const compiled = compileFlowDefinition(definition)
  return {
    organization_id: organizationId,
    name: String(name || '').trim(),
    trigger_type: compiled.trigger.type,
    trigger_config: compiled.trigger.config,
    status: 'draft',
    run_count: 0,
    created_by: createdBy,
    updated_by: createdBy,
  }
}

export function buildVersionRow({ organizationId, flowId, version, definition, createdBy = null, note = null }) {
  return {
    organization_id: organizationId,
    flow_id: flowId,
    version,
    definition: compileFlowDefinition(definition),
    created_by: createdBy,
    note,
  }
}

export function toRunView(run = {}, steps = []) {
  return {
    id: run.id,
    flowId: run.flow_id,
    versionId: run.version_id,
    status: run.status || 'pending',
    triggerType: run.trigger_type || '',
    idempotencyKey: run.idempotency_key || '',
    errorCode: run.error_code || '',
    errorMessage: run.error_message || '',
    startedAt: run.started_at || null,
    finishedAt: run.finished_at || null,
    createdAt: run.created_at || null,
    attempts: Number(run.attempts || 0),
    steps: steps
      .slice()
      .sort((a, b) => Number(a.run_index || 0) - Number(b.run_index || 0))
      .map((step) => ({
        key: step.step_key,
        actionType: step.action_type,
        status: step.status,
        errorCode: step.error_code || '',
        errorMessage: step.error_message || '',
        result: step.sanitized_result || {},
        startedAt: step.started_at || null,
        finishedAt: step.finished_at || null,
      })),
  }
}

// ---- operações ----------------------------------------------------------------------

export async function listAutomationFlows(options = {}) {
  const { client, organizationId } = await context(options)
  const flows = unwrap(
    await client
      .from('automation_flows')
      .select(FLOW_COLUMNS)
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false }),
  )
  const versionIds = flows.map((row) => row.active_version_id).filter(Boolean)
  let versions = []
  if (versionIds.length) {
    versions = unwrap(
      await client.from('automation_versions').select('id,version,definition').in('id', versionIds),
    )
  }
  const byId = new Map(versions.map((row) => [row.id, row]))
  return flows.map((row) => toFlowSummary(row, byId.get(row.active_version_id) || null))
}

export async function getAutomationFlow(id, options = {}) {
  const { client, organizationId } = await context(options)
  const flow = unwrap(
    await client
      .from('automation_flows')
      .select(FLOW_COLUMNS)
      .eq('organization_id', organizationId)
      .eq('id', id)
      .single(),
  )
  let version = null
  if (flow.active_version_id) {
    version = unwrap(
      await client
        .from('automation_versions')
        .select('id,version,definition,created_at')
        .eq('id', flow.active_version_id)
        .maybeSingle(),
    )
  }
  return toFlowSummary(flow, version)
}

export async function createAutomationFlow({ name, definition }, options = {}) {
  const { client, organizationId } = await context(options)
  const check = validateFlowDefinition(definition, { name })
  if (!check.valid) {
    const error = new Error(check.errors[0]?.message || 'Fluxo inválido.')
    error.validation = check.errors
    throw error
  }
  const createdBy = options.userId || null
  const flow = unwrap(
    await client
      .from('automation_flows')
      .insert(buildFlowRow({ organizationId, name, definition: check.definition, createdBy }))
      .select(FLOW_COLUMNS)
      .single(),
  )
  const version = unwrap(
    await client
      .from('automation_versions')
      .insert(buildVersionRow({ organizationId, flowId: flow.id, version: 1, definition: check.definition, createdBy }))
      .select('id,version,definition')
      .single(),
  )
  const updated = unwrap(
    await client
      .from('automation_flows')
      .update({ active_version_id: version.id })
      .eq('id', flow.id)
      .select(FLOW_COLUMNS)
      .single(),
  )
  return toFlowSummary(updated, version)
}

export async function saveAutomationFlowDefinition(id, { name, definition }, options = {}) {
  const { client, organizationId } = await context(options)
  const check = validateFlowDefinition(definition, { name })
  if (!check.valid) {
    const error = new Error(check.errors[0]?.message || 'Fluxo inválido.')
    error.validation = check.errors
    throw error
  }
  const createdBy = options.userId || null
  const existingVersions = unwrap(
    await client.from('automation_versions').select('version').eq('flow_id', id),
  )
  const version = nextVersionNumber(existingVersions)
  const inserted = unwrap(
    await client
      .from('automation_versions')
      .insert(buildVersionRow({ organizationId, flowId: id, version, definition: check.definition, createdBy, note: options.note || null }))
      .select('id,version,definition')
      .single(),
  )
  const compiled = check.definition
  const updated = unwrap(
    await client
      .from('automation_flows')
      .update({
        name: String(name || '').trim(),
        trigger_type: compiled.trigger.type,
        trigger_config: compiled.trigger.config,
        active_version_id: inserted.id,
        updated_by: createdBy,
      })
      .eq('organization_id', organizationId)
      .eq('id', id)
      .select(FLOW_COLUMNS)
      .single(),
  )
  return toFlowSummary(updated, inserted)
}

export async function setAutomationFlowStatus(id, action, options = {}) {
  const { client, organizationId } = await context(options)
  const current = unwrap(
    await client
      .from('automation_flows')
      .select('id,status,active_version_id,name,trigger_type,trigger_config')
      .eq('organization_id', organizationId)
      .eq('id', id)
      .single(),
  )
  const target = nextStatusFor(action, current.status)
  if (!target) throw new Error(`Transição "${action}" não permitida a partir de "${current.status}".`)
  if (target === 'active') {
    if (!current.active_version_id) throw new Error('Salve o fluxo antes de ativá-lo.')
    if (!describeTrigger(current.trigger_type)?.available) {
      throw new Error('O gatilho deste fluxo ainda não pode ser executado nesta infraestrutura.')
    }
  }
  const patch = { status: target, updated_by: options.userId || null }
  patch.archived_at = target === 'archived' ? new Date().toISOString() : null
  const updated = unwrap(
    await client
      .from('automation_flows')
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('id', id)
      .select(FLOW_COLUMNS)
      .single(),
  )
  return toFlowSummary(updated)
}

export async function duplicateAutomationFlow(id, options = {}) {
  const { client, organizationId } = await context(options)
  const source = unwrap(
    await client
      .from('automation_flows')
      .select('id,name,active_version_id,trigger_type,trigger_config')
      .eq('organization_id', organizationId)
      .eq('id', id)
      .single(),
  )
  let definition = compileFlowDefinition({ trigger: { type: source.trigger_type, config: source.trigger_config } })
  if (source.active_version_id) {
    const version = unwrap(
      await client.from('automation_versions').select('definition').eq('id', source.active_version_id).maybeSingle(),
    )
    if (version?.definition) definition = compileFlowDefinition(version.definition)
  }
  return createAutomationFlow({ name: `${source.name} (cópia)`.slice(0, 120), definition }, options)
}

export async function listAutomationRuns(flowId, { limit = 25 } = {}, options = {}) {
  const { client, organizationId } = await context(options)
  const runs = unwrap(
    await client
      .from('automation_runs')
      .select('id,flow_id,version_id,status,trigger_type,idempotency_key,error_code,error_message,started_at,finished_at,created_at,attempts')
      .eq('organization_id', organizationId)
      .eq('flow_id', flowId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 25, 1), 100)),
  )
  if (!runs.length) return []
  const steps = unwrap(
    await client
      .from('automation_run_steps')
      .select('run_id,step_key,action_type,status,run_index,error_code,error_message,sanitized_result,started_at,finished_at')
      .in('run_id', runs.map((row) => row.id)),
  )
  const stepsByRun = new Map()
  for (const step of steps) {
    if (!stepsByRun.has(step.run_id)) stepsByRun.set(step.run_id, [])
    stepsByRun.get(step.run_id).push(step)
  }
  return runs.map((run) => toRunView(run, stepsByRun.get(run.id) || []))
}

export async function enqueueManualAutomationEvent({ eventType, subjectId = null, payload = {}, dedupeKey = null }, options = {}) {
  const { client } = await context(options)
  return unwrap(
    await client.rpc('enqueue_automation_event', {
      p_event_type: eventType,
      p_subject_id: subjectId,
      p_payload: payload,
      p_dedupe_key: dedupeKey,
    }),
  )
}

export { normalizeFlowDefinition, validateFlowDefinition, compileFlowDefinition }
