/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'
import {
  ACTION_CATALOG,
  CONDITION_OPERATORS,
  RUN_STATUS_LABELS,
  STATUS_LABELS,
  TRIGGER_CATALOG,
  describeAction,
  describeTrigger,
} from '../services/whatsapp/automationFlow'
import {
  createAutomationFlow,
  duplicateAutomationFlow,
  listAutomationFlows,
  listAutomationRuns,
  saveAutomationFlowDefinition,
  setAutomationFlowStatus,
  validateFlowDefinition,
} from '../services/data/automationsRepository'

const OPERATOR_LABELS = {
  eq: 'igual a', neq: 'diferente de', gt: 'maior que', gte: 'maior ou igual',
  lt: 'menor que', lte: 'menor ou igual', in: 'está em (lista)', contains: 'contém',
  exists: 'preenchido', not_exists: 'vazio',
}

const CONTEXT_FIELD_HINTS = [
  'client.status', 'client.segment', 'client.lead_source',
  'installment.amount', 'installment.days_overdue', 'installment.status',
  'event.event_name', 'event.subject_type',
]

const emptyDraft = () => ({
  id: null,
  name: '',
  definition: { trigger: { type: '', config: {} }, conditions: [], actions: [] },
})

const fromFlow = (flow) => ({
  id: flow.id,
  name: flow.name,
  definition: {
    trigger: { type: flow.triggerType, config: flow.triggerConfig || {} },
    conditions: flow.definition?.conditions || [],
    actions: flow.definition?.actions || [],
  },
})

export function WhatsAppAutomationPanel({ canWrite = false }) {
  const [flows, setFlows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [draft, setDraft] = useState(null)
  const [runsFlow, setRunsFlow] = useState(null)
  const [runs, setRuns] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setFlows(await listAutomationFlows())
      setError('')
    } catch (cause) {
      setError(cause.message || 'Não foi possível carregar as automações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = useCallback(async (id, operation, success) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(id)
    setError('')
    setFeedback('')
    try {
      await operation()
      if (success) setFeedback(success)
      await load()
      return true
    } catch (cause) {
      setError(cause.message || 'A operação falhou.')
      return false
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }, [load])

  async function openRuns(flow) {
    setRunsFlow(flow)
    setRunsLoading(true)
    setRuns([])
    try {
      setRuns(await listAutomationRuns(flow.id, { limit: 30 }))
    } catch (cause) {
      setError(cause.message || 'Não foi possível carregar o histórico.')
    } finally {
      setRunsLoading(false)
    }
  }

  async function saveDraft(next) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('editor')
    setError('')
    try {
      if (next.id) {
        await saveAutomationFlowDefinition(next.id, { name: next.name, definition: next.definition })
        setFeedback('Fluxo atualizado. Uma nova versão foi registrada.')
      } else {
        await createAutomationFlow({ name: next.name, definition: next.definition })
        setFeedback('Fluxo criado como rascunho.')
      }
      setDraft(null)
      await load()
    } catch (cause) {
      setError(cause.message || 'Não foi possível salvar o fluxo.')
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  if (draft) {
    return (
      <FlowEditor
        draft={draft}
        canWrite={canWrite}
        saving={busy === 'editor'}
        onChange={setDraft}
        onCancel={() => { setDraft(null); setError('') }}
        onSave={saveDraft}
        error={error}
      />
    )
  }

  return (
    <section className="dashboard-panel automation-panel">
      <header className="templates-header">
        <div>
          <span>Automações do WhatsApp</span>
          <h2>Fluxos</h2>
          <p>Gatilho → condições opcionais → ações. Persistido no Supabase e executado pelo worker de automações.</p>
        </div>
        <button
          className="button"
          disabled={!canWrite || loading}
          title={!canWrite ? 'Seu perfil possui acesso somente para leitura.' : undefined}
          onClick={() => { setDraft(emptyDraft()); setError('') }}
        >
          Nova automação
        </button>
      </header>

      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      {feedback && <FeedbackMessage type="success">{feedback}</FeedbackMessage>}

      {loading ? (
        <div className="whatsapp-empty">Carregando automações…</div>
      ) : !flows.length ? (
        <div className="whatsapp-empty">
          Nenhuma automação criada. Use "Nova automação" para começar.
        </div>
      ) : (
        <div className="automation-list">
          {flows.map((flow) => (
            <article key={flow.id} className={`automation-row status-${flow.status}`}>
              <div className="automation-row-main">
                <strong>{flow.name}</strong>
                <small>
                  {flow.triggerLabel} · {STATUS_LABELS[flow.status] || flow.status} ·{' '}
                  {flow.actionCount} ação(ões){flow.conditionCount ? ` · ${flow.conditionCount} condição(ões)` : ''} ·{' '}
                  {flow.runCount} execução(ões)
                </small>
              </div>
              <div className="automation-row-actions">
                <button
                  disabled={busy === flow.id}
                  onClick={() => { setDraft(fromFlow(flow)); setError('') }}
                >
                  {canWrite ? 'Editar' : 'Ver'}
                </button>
                {canWrite && flow.status !== 'archived' && (
                  <button
                    disabled={busy === flow.id}
                    onClick={() =>
                      run(
                        flow.id,
                        () => setAutomationFlowStatus(flow.id, flow.status === 'active' ? 'pause' : 'activate'),
                        flow.status === 'active' ? 'Fluxo pausado.' : 'Fluxo ativado.',
                      )
                    }
                  >
                    {flow.status === 'active' ? 'Pausar' : 'Ativar'}
                  </button>
                )}
                {canWrite && (
                  <button
                    disabled={busy === flow.id}
                    onClick={() => run(flow.id, () => duplicateAutomationFlow(flow.id), 'Fluxo duplicado como rascunho.')}
                  >
                    Duplicar
                  </button>
                )}
                {canWrite && flow.status !== 'archived' && (
                  <button
                    disabled={busy === flow.id}
                    onClick={() => run(flow.id, () => setAutomationFlowStatus(flow.id, 'archive'), 'Fluxo arquivado.')}
                  >
                    Arquivar
                  </button>
                )}
                {canWrite && flow.status === 'archived' && (
                  <button
                    disabled={busy === flow.id}
                    onClick={() => run(flow.id, () => setAutomationFlowStatus(flow.id, 'restore'), 'Fluxo restaurado como rascunho.')}
                  >
                    Restaurar
                  </button>
                )}
                <button disabled={busy === flow.id} onClick={() => openRuns(flow)}>Execuções</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {runsFlow && (
        <RunHistory
          flow={runsFlow}
          runs={runs}
          loading={runsLoading}
          onClose={() => { setRunsFlow(null); setRuns([]) }}
        />
      )}
    </section>
  )
}

function FlowEditor({ draft, canWrite = false, saving, onChange, onCancel, onSave, error }) {
  const [attempted, setAttempted] = useState(false)
  const trigger = describeTrigger(draft.definition.trigger.type)
  const validation = useMemo(
    () => validateFlowDefinition(draft.definition, { name: draft.name }),
    [draft],
  )
  const errorsByPath = useMemo(() => {
    const map = {}
    for (const item of validation.errors) map[item.path] = item.message
    return map
  }, [validation])

  const patch = (mutator) => {
    const next = structuredClone(draft)
    mutator(next)
    onChange(next)
  }

  const setTrigger = (type) =>
    patch((next) => {
      next.definition.trigger = { type, config: {} }
    })

  const setTriggerConfig = (key, value) =>
    patch((next) => {
      next.definition.trigger.config = { ...next.definition.trigger.config, [key]: value }
    })

  const addCondition = () =>
    patch((next) => {
      next.definition.conditions.push({ field: '', operator: 'eq', value: '' })
    })

  const updateCondition = (index, key, value) =>
    patch((next) => {
      next.definition.conditions[index] = { ...next.definition.conditions[index], [key]: value }
    })

  const removeCondition = (index) =>
    patch((next) => {
      next.definition.conditions.splice(index, 1)
    })

  const addAction = (type) =>
    patch((next) => {
      const key = `step_${next.definition.actions.length + 1}`
      next.definition.actions.push({ key, type, config: {} })
    })

  const updateActionConfig = (index, key, value) =>
    patch((next) => {
      next.definition.actions[index].config = { ...next.definition.actions[index].config, [key]: value }
    })

  const moveAction = (index, direction) =>
    patch((next) => {
      const target = index + direction
      if (target < 0 || target >= next.definition.actions.length) return
      const [item] = next.definition.actions.splice(index, 1)
      next.definition.actions.splice(target, 0, item)
    })

  const removeAction = (index) =>
    patch((next) => {
      next.definition.actions.splice(index, 1)
    })

  const submit = () => {
    setAttempted(true)
    if (!validation.valid) return
    onSave(draft)
  }

  return (
    <section className="dashboard-panel automation-panel automation-editor">
      <header className="templates-header">
        <div>
          <span>{draft.id ? 'Editar fluxo' : 'Nova automação'}</span>
          <h2>{draft.name || 'Fluxo sem nome'}</h2>
          <p>Defina o gatilho, condições opcionais e a sequência de ações.</p>
        </div>
        <div className="automation-editor-header-actions">
          <button className="button secondary" onClick={onCancel} disabled={saving}>{canWrite ? 'Cancelar' : 'Voltar'}</button>
          <button
            className="button"
            onClick={submit}
            disabled={!canWrite || saving || (attempted && !validation.valid)}
            title={!canWrite ? 'Seu perfil possui acesso somente para leitura.' : undefined}
          >
            {saving ? 'Salvando…' : 'Salvar fluxo'}
          </button>
        </div>
      </header>

      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      {attempted && !validation.valid && (
        <FeedbackMessage type="warning">
          Revise os campos destacados antes de salvar.
        </FeedbackMessage>
      )}

      <div className="automation-editor-body">
        <label className="automation-field">
          <span>Nome do fluxo</span>
          <input
            value={draft.name}
            maxLength={120}
            onChange={(e) => patch((next) => { next.name = e.target.value })}
            placeholder="ex.: Reativação após 30 dias"
          />
          {attempted && errorsByPath.name && <small className="automation-error">{errorsByPath.name}</small>}
        </label>

        <fieldset className="automation-block">
          <legend>Gatilho</legend>
          <select value={draft.definition.trigger.type} onChange={(e) => setTrigger(e.target.value)}>
            <option value="">Selecione um gatilho</option>
            {TRIGGER_CATALOG.map((item) => (
              <option key={item.type} value={item.type} disabled={!item.available}>
                {item.label}{item.available ? '' : ' — indisponível'}
              </option>
            ))}
          </select>
          {trigger && <p className="automation-hint">{trigger.description}</p>}
          {trigger && !trigger.available && (
            <FeedbackMessage type="warning">{trigger.unavailableReason}</FeedbackMessage>
          )}
          {attempted && errorsByPath['trigger.type'] && (
            <small className="automation-error">{errorsByPath['trigger.type']}</small>
          )}
          {trigger?.configFields?.map((field) => (
            <label key={field.key} className="automation-field">
              <span>{field.label}{field.required ? ' *' : ''}</span>
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={draft.definition.trigger.config[field.key] ?? ''}
                placeholder={field.placeholder || ''}
                onChange={(e) => setTriggerConfig(field.key, e.target.value)}
              />
              {attempted && errorsByPath[`trigger.config.${field.key}`] && (
                <small className="automation-error">{errorsByPath[`trigger.config.${field.key}`]}</small>
              )}
            </label>
          ))}
        </fieldset>

        <fieldset className="automation-block">
          <legend>Condições (opcional)</legend>
          {!draft.definition.conditions.length && (
            <p className="automation-hint">Sem condições: toda ocorrência do gatilho executa o fluxo.</p>
          )}
          <datalist id="automation-condition-fields">
            {CONTEXT_FIELD_HINTS.map((hint) => <option key={hint} value={hint} />)}
          </datalist>
          {draft.definition.conditions.map((condition, index) => (
            <div key={index} className="automation-condition-row">
              <input
                list="automation-condition-fields"
                value={condition.field}
                placeholder="campo (ex.: installment.days_overdue)"
                onChange={(e) => updateCondition(index, 'field', e.target.value)}
              />
              <select value={condition.operator} onChange={(e) => updateCondition(index, 'operator', e.target.value)}>
                {CONDITION_OPERATORS.map((op) => (
                  <option key={op} value={op}>{OPERATOR_LABELS[op] || op}</option>
                ))}
              </select>
              {!['exists', 'not_exists'].includes(condition.operator) && (
                <input
                  value={condition.value ?? ''}
                  placeholder="valor"
                  onChange={(e) => updateCondition(index, 'value', e.target.value)}
                />
              )}
              <button type="button" className="automation-icon-button" onClick={() => removeCondition(index)}>Remover</button>
            </div>
          ))}
          <button type="button" className="button secondary" onClick={addCondition}>Adicionar condição</button>
        </fieldset>

        <fieldset className="automation-block">
          <legend>Ações</legend>
          {attempted && errorsByPath.actions && (
            <small className="automation-error">{errorsByPath.actions}</small>
          )}
          {draft.definition.actions.map((action, index) => {
            const spec = describeAction(action.type)
            return (
              <div key={action.key || index} className="automation-action-card">
                <header>
                  <strong>{index + 1}. {spec?.label || action.type}</strong>
                  <div>
                    <button type="button" className="automation-icon-button" disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button>
                    <button type="button" className="automation-icon-button" disabled={index === draft.definition.actions.length - 1} onClick={() => moveAction(index, 1)}>↓</button>
                    <button type="button" className="automation-icon-button" onClick={() => removeAction(index)}>Remover</button>
                  </div>
                </header>
                {spec && <p className="automation-hint">{spec.description}</p>}
                {spec?.configFields?.map((field) => {
                  const value = action.config[field.key] ?? field.default ?? ''
                  const errorKey = `actions.${index}.config.${field.key}`
                  return (
                    <label key={field.key} className="automation-field">
                      <span>{field.label}{field.required ? ' *' : ''}</span>
                      {field.type === 'textarea' ? (
                        <textarea
                          rows={3}
                          value={value}
                          onChange={(e) => updateActionConfig(index, field.key, e.target.value)}
                        />
                      ) : field.type === 'select' ? (
                        <select value={value} onChange={(e) => updateActionConfig(index, field.key, e.target.value)}>
                          {(field.options || []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={value}
                          onChange={(e) => updateActionConfig(index, field.key, e.target.value)}
                        />
                      )}
                      {attempted && errorsByPath[errorKey] && (
                        <small className="automation-error">{errorsByPath[errorKey]}</small>
                      )}
                    </label>
                  )
                })}
              </div>
            )
          })}
          <div className="automation-add-action">
            <select
              value=""
              onChange={(e) => { if (e.target.value) addAction(e.target.value) }}
            >
              <option value="">Adicionar ação…</option>
              {ACTION_CATALOG.map((item) => (
                <option key={item.type} value={item.type}>{item.label}</option>
              ))}
            </select>
          </div>
        </fieldset>
      </div>
    </section>
  )
}

function RunHistory({ flow, runs, loading, onClose }) {
  const [openRun, setOpenRun] = useState('')
  return (
    <>
      <button className="template-context-backdrop" aria-label="Fechar histórico" onClick={onClose} />
      <aside className="conversation-template-drawer automation-runs-drawer" role="dialog" aria-modal="true">
        <header>
          <div>
            <small>Histórico de execuções</small>
            <h2>{flow.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        {loading ? (
          <div className="whatsapp-empty">Carregando execuções…</div>
        ) : !runs.length ? (
          <div className="whatsapp-empty">
            Nenhuma execução registrada ainda. As execuções aparecem aqui quando o worker de automações processa um evento correspondente.
          </div>
        ) : (
          <div className="automation-run-list">
            {runs.map((run) => (
              <article key={run.id} className={`automation-run status-${run.status}`}>
                <button type="button" className="automation-run-summary" onClick={() => setOpenRun(openRun === run.id ? '' : run.id)}>
                  <strong>{RUN_STATUS_LABELS[run.status] || run.status}</strong>
                  <small>
                    {run.triggerType || '—'} ·{' '}
                    {run.createdAt ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(run.createdAt)) : '—'}
                    {run.attempts > 1 ? ` · ${run.attempts} tentativas` : ''}
                  </small>
                  {run.errorMessage && <span className="automation-run-error">{run.errorCode}: {run.errorMessage}</span>}
                </button>
                {openRun === run.id && (
                  <ol className="automation-step-list">
                    {run.steps.length ? run.steps.map((step, index) => (
                      <li key={index} className={`status-${step.status}`}>
                        <span>{describeAction(step.actionType)?.label || step.actionType}</span>
                        <em>{step.status}</em>
                        {step.errorMessage && <small>{step.errorCode}: {step.errorMessage}</small>}
                      </li>
                    )) : <li>Sem passos registrados.</li>}
                  </ol>
                )}
              </article>
            ))}
          </div>
        )}
      </aside>
    </>
  )
}
