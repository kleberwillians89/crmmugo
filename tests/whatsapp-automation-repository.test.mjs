import assert from 'node:assert/strict'
import {
  buildFlowRow,
  buildVersionRow,
  createAutomationFlow,
  duplicateAutomationFlow,
  listAutomationFlows,
  listAutomationRuns,
  nextVersionNumber,
  saveAutomationFlowDefinition,
  setAutomationFlowStatus,
  toFlowSummary,
  toRunView,
} from '../src/services/data/automationsRepository.js'

// ---- helpers puros --------------------------------------------------------------
assert.equal(nextVersionNumber([]), 1)
assert.equal(nextVersionNumber([{ version: 1 }, { version: 3 }, { version: 2 }]), 4)

const flowRow = buildFlowRow({
  organizationId: 'org-1',
  name: '  Régua  ',
  definition: { trigger: { type: 'manual_event' }, actions: [{ type: 'end_flow' }] },
  createdBy: 'user-1',
})
assert.equal(flowRow.name, 'Régua')
assert.equal(flowRow.trigger_type, 'manual_event')
assert.equal(flowRow.status, 'draft')

const versionRow = buildVersionRow({ organizationId: 'org-1', flowId: 'flow-1', version: 2, definition: { trigger: { type: 'manual_event' }, actions: [{ type: 'end_flow' }] } })
assert.equal(versionRow.version, 2)
assert.equal(versionRow.definition.actions.length, 1)

const summary = toFlowSummary(
  { id: 'f1', name: 'X', trigger_type: 'lead_created', status: 'active', active_version_id: 'v1', run_count: 4 },
  { id: 'v1', version: 3, definition: { trigger: { type: 'lead_created' }, conditions: [{ field: 'a', operator: 'eq', value: '1' }], actions: [{ type: 'add_note', config: { title: 'x' } }, { type: 'end_flow' }] } },
)
assert.equal(summary.actionCount, 2)
assert.equal(summary.conditionCount, 1)
assert.equal(summary.activeVersion, 3)
assert.equal(summary.triggerLabel, 'Lead criado')

const runView = toRunView(
  { id: 'r1', flow_id: 'f1', status: 'failed', trigger_type: 'lead_created', error_code: 'X', error_message: 'boom', attempts: 2 },
  [
    { step_key: 's2', run_index: 1, action_type: 'end_flow', status: 'skipped' },
    { step_key: 's1', run_index: 0, action_type: 'add_note', status: 'failed', error_code: 'E', error_message: 'nope' },
  ],
)
assert.equal(runView.status, 'failed')
assert.equal(runView.steps[0].key, 's1')
assert.equal(runView.steps[1].key, 's2')

// ---- fake supabase client (registra operações e devolve respostas) -------------
function makeClient(seed = {}) {
  const store = { automation_flows: [], automation_versions: [], automation_runs: [], automation_run_steps: [], ...structuredClone(seed) }
  const log = []
  let seq = 0
  const nextId = (p) => `${p}-${++seq}`
  const match = (rows, filters) =>
    rows.filter((row) => filters.every(([k, v, op]) => (op === 'in' ? v.includes(row[k]) : row[k] === v)))

  function builder(table, op, payload) {
    const state = { table, op, payload, filters: [], cols: null, single: null }
    const run = async () => {
      log.push({ table, op, payload, filters: state.filters })
      let rows = store[table] || (store[table] = [])
      if (op === 'select') {
        let result = match(rows, state.filters)
        if (state.single === 'single') {
          if (!result.length) return { data: null, error: { message: 'not found', code: 'PGRST116' } }
          return { data: result[0], error: null }
        }
        if (state.single === 'maybe') return { data: result[0] || null, error: null }
        return { data: result, error: null }
      }
      if (op === 'insert') {
        const record = { id: nextId(table), ...payload }
        rows.push(record)
        return state.single ? { data: record, error: null } : { data: [record], error: null }
      }
      if (op === 'update') {
        const targets = match(rows, state.filters)
        targets.forEach((row) => Object.assign(row, payload))
        return state.single ? { data: targets[0] || null, error: targets[0] ? null : { message: 'not found' } } : { data: targets, error: null }
      }
      return { data: null, error: { message: `op ${op} não suportada` } }
    }
    const chain = {
      select(cols) { state.cols = cols; if (op !== 'select') { state.pendingSelect = true } return chain },
      eq(k, v) { state.filters.push([k, v]); return chain },
      in(k, v) { state.filters.push([k, v, 'in']); return chain },
      order() { return chain },
      limit() { return chain },
      single() { state.single = 'single'; return run() },
      maybeSingle() { state.single = 'maybe'; return run() },
      then(res, rej) { return run().then(res, rej) },
    }
    return chain
  }

  return {
    __store: store,
    __log: log,
    from(table) {
      return {
        select: (cols) => builder(table, 'select').select(cols),
        insert: (payload) => builder(table, 'insert', payload),
        update: (payload) => builder(table, 'update', payload),
      }
    },
    async rpc(name, args) {
      log.push({ rpc: name, args })
      if (name === 'enqueue_automation_event') return { data: nextId('event'), error: null }
      return { data: null, error: { message: `rpc ${name} não suportada` } }
    },
  }
}

const opts = (client) => ({ client, organizationId: 'org-1' })

// ---- createAutomationFlow: cria fluxo + versão 1 + aponta a versão ativa -------
{
  const client = makeClient()
  const created = await createAutomationFlow(
    {
      name: 'Boas-vindas a leads',
      definition: {
        trigger: { type: 'lead_created' },
        actions: [{ type: 'add_note', config: { title: 'Novo lead' } }, { type: 'end_flow' }],
      },
    },
    opts(client),
  )
  assert.equal(client.__store.automation_flows.length, 1)
  assert.equal(client.__store.automation_versions.length, 1)
  assert.equal(client.__store.automation_versions[0].version, 1)
  assert.equal(client.__store.automation_flows[0].active_version_id, client.__store.automation_versions[0].id)
  assert.equal(created.status, 'draft')
  assert.equal(created.actionCount, 2)
}

// ---- createAutomationFlow rejeita definição inválida antes de tocar o banco ----
{
  const client = makeClient()
  await assert.rejects(
    () => createAutomationFlow({ name: 'x', definition: { trigger: { type: 'lead_created' }, actions: [] } }, opts(client)),
    /ao menos uma ação|entre 2 e 120/,
  )
  assert.equal(client.__store.automation_flows.length, 0)
}

// ---- saveAutomationFlowDefinition cria uma nova versão incremental ------------
{
  const client = makeClient({
    automation_flows: [{ id: 'flow-1', organization_id: 'org-1', name: 'Antigo', trigger_type: 'manual_event', status: 'draft', active_version_id: 'v-1' }],
    automation_versions: [{ id: 'v-1', organization_id: 'org-1', flow_id: 'flow-1', version: 1, definition: { trigger: { type: 'manual_event' }, actions: [{ type: 'end_flow' }] } }],
  })
  const saved = await saveAutomationFlowDefinition(
    'flow-1',
    {
      name: 'Novo nome',
      definition: { trigger: { type: 'manual_event' }, actions: [{ type: 'add_note', config: { title: 'oi' } }, { type: 'end_flow' }] },
    },
    opts(client),
  )
  assert.equal(client.__store.automation_versions.length, 2)
  assert.equal(client.__store.automation_versions[1].version, 2)
  assert.equal(client.__store.automation_flows[0].name, 'Novo nome')
  assert.equal(client.__store.automation_flows[0].active_version_id, client.__store.automation_versions[1].id)
  assert.equal(saved.name, 'Novo nome')
}

// ---- setAutomationFlowStatus: transições e bloqueios --------------------------
{
  const client = makeClient({
    automation_flows: [{ id: 'flow-1', organization_id: 'org-1', name: 'F', trigger_type: 'manual_event', status: 'draft', active_version_id: 'v-1' }],
  })
  const activated = await setAutomationFlowStatus('flow-1', 'activate', opts(client))
  assert.equal(activated.status, 'active')
  const paused = await setAutomationFlowStatus('flow-1', 'pause', opts(client))
  assert.equal(paused.status, 'paused')
  await assert.rejects(() => setAutomationFlowStatus('flow-1', 'pause', opts(client)), /não permitida/)
}

// ---- ativar exige versão salva e gatilho disponível --------------------------
{
  const client = makeClient({
    automation_flows: [{ id: 'flow-2', organization_id: 'org-1', name: 'Sem versão', trigger_type: 'manual_event', status: 'draft', active_version_id: null }],
  })
  await assert.rejects(() => setAutomationFlowStatus('flow-2', 'activate', opts(client)), /Salve o fluxo/)
}
{
  const client = makeClient({
    automation_flows: [{ id: 'flow-3', organization_id: 'org-1', name: 'Gatilho externo', trigger_type: 'whatsapp_message_received', status: 'draft', active_version_id: 'v-9' }],
  })
  await assert.rejects(() => setAutomationFlowStatus('flow-3', 'activate', opts(client)), /não pode ser executado/)
}

// ---- duplicateAutomationFlow gera rascunho independente ----------------------
{
  const client = makeClient({
    automation_flows: [{ id: 'flow-1', organization_id: 'org-1', name: 'Original', trigger_type: 'lead_created', status: 'active', active_version_id: 'v-1' }],
    automation_versions: [{ id: 'v-1', organization_id: 'org-1', flow_id: 'flow-1', version: 1, definition: { trigger: { type: 'lead_created' }, actions: [{ type: 'end_flow' }] } }],
  })
  const copy = await duplicateAutomationFlow('flow-1', opts(client))
  assert.equal(copy.name, 'Original (cópia)')
  assert.equal(copy.status, 'draft')
  assert.equal(client.__store.automation_flows.length, 2)
}

// ---- listAutomationFlows junta a definição da versão ativa -------------------
{
  const client = makeClient({
    automation_flows: [{ id: 'flow-1', organization_id: 'org-1', name: 'F1', trigger_type: 'manual_event', status: 'active', active_version_id: 'v-1', run_count: 7 }],
    automation_versions: [{ id: 'v-1', version: 2, definition: { trigger: { type: 'manual_event' }, actions: [{ type: 'end_flow' }] } }],
  })
  const list = await listAutomationFlows(opts(client))
  assert.equal(list.length, 1)
  assert.equal(list[0].runCount, 7)
  assert.equal(list[0].actionCount, 1)
}

// ---- listAutomationRuns junta passos por run --------------------------------
{
  const client = makeClient({
    automation_runs: [{ id: 'r1', organization_id: 'org-1', flow_id: 'flow-1', status: 'succeeded', created_at: '2026-01-01' }],
    automation_run_steps: [{ run_id: 'r1', step_key: 's1', run_index: 0, action_type: 'add_note', status: 'succeeded' }],
  })
  const runs = await listAutomationRuns('flow-1', { limit: 10 }, opts(client))
  assert.equal(runs.length, 1)
  assert.equal(runs[0].steps.length, 1)
}

console.log('WhatsApp automation repository contracts: ok')
