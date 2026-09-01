import { useMemo, useRef, useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'
import {
  ACTION_CATALOG,
  CONDITION_OPERATORS,
  TRIGGER_CATALOG,
  describeAction,
  describeTrigger,
} from '../services/whatsapp/automationFlow'
import { normalizeGraph, validateGraph } from '../services/whatsapp/automationGraph'

const OPERATOR_LABELS = {
  eq: 'igual a', neq: 'diferente de', gt: 'maior que', gte: 'maior ou igual',
  lt: 'menor que', lte: 'menor ou igual', in: 'está em (lista)', contains: 'contém',
  exists: 'preenchido', not_exists: 'vazio',
}

const FIELD_HINTS = [
  'client.status', 'client.segment', 'client.lead_source',
  'installment.amount', 'installment.days_overdue', 'installment.status',
  'event.event_name', 'event.subject_type', 'message.text',
]

const NODE_LABELS = { trigger: 'Início', condition: 'Condição' }
const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

function fieldControl(field, value, onChange, disabled = false) {
  if (field.type === 'textarea') return <textarea rows={4} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} />
  if (field.type === 'select') {
    return <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
  }
  return <input disabled={disabled} type={field.type === 'number' ? 'number' : 'text'} value={value} placeholder={field.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
}

export function AutomationFlowBuilder({ draft, canWrite, saving, onChange, onCancel, onSave, error, approvedTemplates = [] }) {
  const [selectedId, setSelectedId] = useState(draft.definition.nodes[0]?.id || '')
  const [connecting, setConnecting] = useState(null)
  const [attempted, setAttempted] = useState(false)
  const [view, setView] = useState({ x: 30, y: 40, zoom: 1 })
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const graph = normalizeGraph(draft.definition)
  const selected = graph.nodes.find((node) => node.id === selectedId) || null
  const validation = useMemo(() => validateGraph(draft.definition), [draft.definition])
  const nameValid = draft.name.trim().length >= 2
  const nodeErrors = useMemo(() => {
    const map = new Map()
    validation.errors.forEach((item) => {
      if (!item.nodeId) return
      map.set(item.nodeId, [...(map.get(item.nodeId) || []), item.message])
    })
    return map
  }, [validation])

  const update = (mutator) => {
    const next = structuredClone(draft)
    next.definition = normalizeGraph(next.definition)
    mutator(next)
    onChange(next)
  }

  const patchNode = (nodeId, mutator) => update((next) => {
    const node = next.definition.nodes.find((item) => item.id === nodeId)
    if (node) mutator(node)
  })

  const addNode = (type) => {
    if (!canWrite) return
    const nodeId = makeId(type)
    update((next) => {
      next.definition.nodes.push({
        id: nodeId,
        type,
        position: { x: 320 + (next.definition.nodes.length % 3) * 250, y: 100 + Math.floor(next.definition.nodes.length / 3) * 190 },
        config: type === 'condition' ? { field: '', operator: 'eq', value: '' } : {},
      })
    })
    setSelectedId(nodeId)
  }

  const beginConnect = (source, branch = 'always') => setConnecting({ source, branch })
  const finishConnect = (target) => {
    if (!connecting || connecting.source === target || !canWrite) return
    update((next) => {
      const sourceNode = next.definition.nodes.find((node) => node.id === connecting.source)
      if (!sourceNode) return
      if (sourceNode.type === 'condition') {
        next.definition.edges = next.definition.edges.filter((edge) => !(edge.source === connecting.source && edge.branch === connecting.branch))
      } else {
        next.definition.edges = next.definition.edges.filter((edge) => edge.source !== connecting.source)
      }
      next.definition.edges.push({ id: makeId('edge'), source: connecting.source, target, branch: connecting.branch })
    })
    setConnecting(null)
  }

  const removeNode = (nodeId) => {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!canWrite || node?.type === 'trigger') return
    update((next) => {
      next.definition.nodes = next.definition.nodes.filter((item) => item.id !== nodeId)
      next.definition.edges = next.definition.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    })
    setSelectedId(graph.nodes.find((item) => item.type === 'trigger')?.id || '')
  }

  const pointerDown = (event, node) => {
    if (!canWrite || event.button !== 0) return
    event.stopPropagation()
    dragRef.current = { kind: 'node', id: node.id, startX: event.clientX, startY: event.clientY, x: node.position.x, y: node.position.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const canvasPointerDown = (event) => {
    if (event.target.closest?.('.flow-node')) return
    dragRef.current = { kind: 'canvas', startX: event.clientX, startY: event.clientY, x: view.x, y: view.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === 'canvas') {
      setView((current) => ({ ...current, x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY }))
      return
    }
    patchNode(drag.id, (node) => {
      node.position.x = Math.max(0, drag.x + (event.clientX - drag.startX) / view.zoom)
      node.position.y = Math.max(0, drag.y + (event.clientY - drag.startY) / view.zoom)
    })
  }

  const submit = () => {
    setAttempted(true)
    if (!validation.valid || !nameValid) return
    onSave({ ...draft, name: draft.name.trim(), definition: validation.graph })
  }

  const fitView = () => {
    const box = canvasRef.current?.getBoundingClientRect()
    if (!box || !graph.nodes.length) return setView({ x: 30, y: 40, zoom: 1 })
    const minX = Math.min(...graph.nodes.map((node) => node.position.x))
    const minY = Math.min(...graph.nodes.map((node) => node.position.y))
    const maxX = Math.max(...graph.nodes.map((node) => node.position.x + 190))
    const maxY = Math.max(...graph.nodes.map((node) => node.position.y + 120))
    const zoom = Math.min(1.25, Math.max(.55, Math.min((box.width - 70) / Math.max(190, maxX - minX), (box.height - 90) / Math.max(120, maxY - minY))))
    setView({ x: (box.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (box.height - (maxY - minY) * zoom) / 2 - minY * zoom, zoom })
  }

  return (
    <section className="dashboard-panel automation-panel automation-editor graph-editor">
      <header className="templates-header">
        <div>
          <span>{draft.id ? 'Editar fluxo' : 'Nova automação'}</span>
          <h2>{draft.name || 'Fluxo sem nome'}</h2>
          <p>Arraste os blocos, conecte os caminhos e configure cada etapa sem editar JSON.</p>
        </div>
        <div className="automation-editor-header-actions">
          <button className="button secondary" onClick={onCancel} disabled={saving}>{canWrite ? 'Cancelar' : 'Voltar'}</button>
          <button className="button" onClick={submit} disabled={!canWrite || saving}>{saving ? 'Salvando…' : 'Salvar fluxo'}</button>
        </div>
      </header>

      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      {attempted && (!validation.valid || !nameValid) && <FeedbackMessage type="warning">Corrija os blocos destacados e conecte todos os caminhos antes de salvar.</FeedbackMessage>}

      <label className="automation-field graph-name-field">
        <span>Nome do fluxo</span>
        <input disabled={!canWrite} value={draft.name} maxLength={120} onChange={(event) => update((next) => { next.name = event.target.value })} placeholder="ex.: Reativação após 30 dias" />
        {attempted && !nameValid && <small className="automation-error">Informe um nome com pelo menos 2 caracteres.</small>}
      </label>

      <div className="flow-builder-shell">
        <aside className="flow-palette">
          <strong>Blocos</strong>
          <button type="button" disabled>● Início (único)</button>
          <button type="button" disabled={!canWrite} onClick={() => addNode('condition')}>◇ Condição</button>
          {ACTION_CATALOG.map((action) => <button type="button" disabled={!canWrite} key={action.type} onClick={() => addNode(action.type)}>＋ {action.label}</button>)}
          <small>Clique em uma saída e depois no bloco de destino. Condições exigem caminhos SIM e NÃO.</small>
        </aside>

        <div className="flow-canvas-wrap">
          <div className="flow-toolbar">
            <button type="button" onClick={() => setView((current) => ({ ...current, zoom: Math.max(.55, current.zoom - .1) }))}>−</button>
            <span>{Math.round(view.zoom * 100)}%</span>
            <button type="button" onClick={() => setView((current) => ({ ...current, zoom: Math.min(1.5, current.zoom + .1) }))}>＋</button>
            <button type="button" onClick={fitView}>Ajustar</button>
            {connecting && <button type="button" className="active" onClick={() => setConnecting(null)}>Cancelar conexão</button>}
          </div>
          <div ref={canvasRef} className="flow-canvas" onPointerDown={canvasPointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragRef.current = null }}>
            <div className="flow-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
              <svg className="flow-edges" width="1800" height="1100" aria-hidden="true">
                <defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
                {graph.edges.map((edge) => {
                  const source = graph.nodes.find((node) => node.id === edge.source)
                  const target = graph.nodes.find((node) => node.id === edge.target)
                  if (!source || !target) return null
                  const x1 = source.position.x + 190, y1 = source.position.y + 54
                  const x2 = target.position.x, y2 = target.position.y + 54
                  const bend = Math.max(55, Math.abs(x2 - x1) / 2)
                  return <g key={edge.id}><path d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} markerEnd="url(#flow-arrow)" /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7}>{edge.branch === 'yes' ? 'SIM' : edge.branch === 'no' ? 'NÃO' : ''}</text></g>
                })}
              </svg>
              {graph.nodes.map((node) => {
                const spec = node.type === 'trigger' ? describeTrigger(node.config.trigger_type) : describeAction(node.type)
                const issues = nodeErrors.get(node.id) || []
                return (
                  <article
                    key={node.id}
                    className={`flow-node type-${node.type} ${selectedId === node.id ? 'selected' : ''} ${attempted && issues.length ? 'invalid' : ''} ${connecting ? 'connection-target' : ''}`}
                    style={{ left: node.position.x, top: node.position.y }}
                    onPointerDown={(event) => pointerDown(event, node)}
                    onClick={(event) => { event.stopPropagation(); if (connecting) finishConnect(node.id); else setSelectedId(node.id) }}
                  >
                    <small>{NODE_LABELS[node.type] || 'Ação'}</small>
                    <strong>{spec?.label || NODE_LABELS[node.type] || node.type}</strong>
                    <span>{node.type === 'condition' ? `${node.config.field || 'Campo'} ${OPERATOR_LABELS[node.config.operator] || ''}` : spec?.description}</span>
                    <footer>
                      {node.type === 'condition' ? <><button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); beginConnect(node.id, 'yes') }}>＋ SIM</button><button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); beginConnect(node.id, 'no') }}>＋ NÃO</button></> : node.type !== 'end_flow' && <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); beginConnect(node.id) }}>＋ Conectar</button>}
                    </footer>
                    {attempted && issues[0] && <em>{issues[0]}</em>}
                  </article>
                )
              })}
            </div>
          </div>
        </div>

        <aside className="flow-inspector">
          {!selected ? <p>Selecione um bloco para configurá-lo.</p> : <NodeInspector node={selected} canWrite={canWrite} patchNode={patchNode} removeNode={removeNode} approvedTemplates={approvedTemplates} />}
        </aside>
      </div>
    </section>
  )
}

function NodeInspector({ node, canWrite, patchNode, removeNode, approvedTemplates }) {
  if (node.type === 'trigger') {
    const trigger = describeTrigger(node.config.trigger_type)
    return <><strong>Gatilho</strong><label className="automation-field"><span>Evento</span><select disabled={!canWrite} value={node.config.trigger_type || ''} onChange={(event) => patchNode(node.id, (item) => { item.config = { trigger_type: event.target.value } })}>{TRIGGER_CATALOG.map((item) => <option key={item.type} value={item.type} disabled={!item.available}>{item.label}{item.available ? '' : ' — indisponível'}</option>)}</select></label>{trigger?.configFields?.map((field) => <label key={field.key} className="automation-field"><span>{field.label}{field.required ? ' *' : ''}</span>{fieldControl(field, node.config[field.key] ?? field.default ?? '', (value) => patchNode(node.id, (item) => { item.config[field.key] = value }), !canWrite)}</label>)}{trigger && <p>{trigger.description}</p>}</>
  }
  if (node.type === 'condition') {
    return <><strong>Condição</strong><datalist id="automation-graph-fields">{FIELD_HINTS.map((field) => <option key={field} value={field} />)}</datalist><label className="automation-field"><span>Campo</span><input list="automation-graph-fields" disabled={!canWrite} value={node.config.field || ''} onChange={(event) => patchNode(node.id, (item) => { item.config.field = event.target.value })} /></label><label className="automation-field"><span>Operador</span><select disabled={!canWrite} value={node.config.operator || 'eq'} onChange={(event) => patchNode(node.id, (item) => { item.config.operator = event.target.value })}>{CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{OPERATOR_LABELS[operator]}</option>)}</select></label>{!['exists', 'not_exists'].includes(node.config.operator) && <label className="automation-field"><span>Valor</span><input disabled={!canWrite} value={node.config.value ?? ''} onChange={(event) => patchNode(node.id, (item) => { item.config.value = event.target.value })} /></label>}<button type="button" className="flow-remove" disabled={!canWrite} onClick={() => removeNode(node.id)}>Remover bloco</button></>
  }
  if (node.type === 'send_template') {
    const selectedValue = node.config.template_name ? `${node.config.template_name}:${node.config.language || 'pt_BR'}` : ''
    return <><strong>Enviar template</strong><p>Escolha um template aprovado e ativo já sincronizado com a Meta.</p><label className="automation-field"><span>Template *</span><select disabled={!canWrite} value={selectedValue} onChange={(event) => { const template=approvedTemplates.find((item)=>`${item.name}:${item.language||'pt_BR'}`===event.target.value);patchNode(node.id,(item)=>{item.config.template_name=template?.name||'';item.config.language=template?.language||'pt_BR'}) }}><option value="">Selecione um template aprovado</option>{approvedTemplates.map((template)=><option key={`${template.name}:${template.language}`} value={`${template.name}:${template.language||'pt_BR'}`}>{template.display||template.name} / {template.name} · {template.language||'pt_BR'}</option>)}</select></label><label className="automation-field"><span>Idioma</span><input disabled value={node.config.language||'pt_BR'}/></label><label className="automation-field"><span>Parâmetros do corpo (um por linha)</span><textarea rows={4} disabled={!canWrite} value={node.config.body_parameters||''} onChange={(event)=>patchNode(node.id,(item)=>{item.config.body_parameters=event.target.value})}/></label>{!approvedTemplates.length&&<small className="automation-error">Nenhum template APPROVED e ativo foi encontrado. Sincronize os templates na aba Modelos.</small>}<button type="button" className="flow-remove" disabled={!canWrite} onClick={() => removeNode(node.id)}>Remover bloco</button></>
  }
  if (node.type === 'wait') return <WaitInspector key={node.id} node={node} canWrite={canWrite} patchNode={patchNode} removeNode={removeNode}/>
  const action = describeAction(node.type)
  return <><strong>{action?.label || node.type}</strong><p>{action?.description}</p>{action?.configFields?.map((field) => <label key={field.key} className="automation-field"><span>{field.label}{field.required ? ' *' : ''}</span>{fieldControl(field, node.config[field.key] ?? field.default ?? '', (value) => patchNode(node.id, (item) => { item.config[field.key] = value }), !canWrite)}</label>)}<button type="button" className="flow-remove" disabled={!canWrite} onClick={() => removeNode(node.id)}>Remover bloco</button></>
}

function WaitInspector({node,canWrite,patchNode,removeNode}){
  const initialMinutes=Math.max(1,Number(node.config.minutes)||1)
  const initialUnit=initialMinutes%1440===0?'days':initialMinutes%60===0?'hours':'minutes'
  const [unit,setUnit]=useState(initialUnit)
  const [amount,setAmount]=useState(initialMinutes/(initialUnit==='days'?1440:initialUnit==='hours'?60:1))
  const persist=(nextAmount,nextUnit=unit)=>{const nextMultiplier=nextUnit==='days'?1440:nextUnit==='hours'?60:1;patchNode(node.id,(item)=>{item.config.minutes=Math.max(1,Math.trunc(Number(nextAmount)||0)*nextMultiplier)})}
  return <><strong>Aguardar</strong><p>Pausa o fluxo pelo período definido. O executor continuará recebendo o total normalizado em minutos.</p><label className="automation-field"><span>Período *</span><input type="number" min="1" step="1" disabled={!canWrite} value={amount} onChange={(event)=>{const next=event.target.value;setAmount(next);persist(next)}}/></label><label className="automation-field"><span>Unidade</span><select disabled={!canWrite} value={unit} onChange={(event)=>{const nextUnit=event.target.value;setUnit(nextUnit);persist(amount,nextUnit)}}><option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option></select></label><small>{initialMinutes} minuto(s) serão persistidos.</small><button type="button" className="flow-remove" disabled={!canWrite} onClick={()=>removeNode(node.id)}>Remover bloco</button></>
}
