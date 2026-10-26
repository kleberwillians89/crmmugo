import { useMemo, useState } from 'react'
import { PROSPECT_COLUMNS, columnFor, daysSince } from '../lib/prospectBoard'

const ago = (days) => days == null ? '' : days === 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`

/** Quadro da prospecção: arraste o cartão para a etapa certa. "Respondeu" leva o prospect para o funil Comercial. */
export function ProspectBoard({ prospects, now, busy, onMove, onOpen }) {
  const [over, setOver] = useState(''), [dragging, setDragging] = useState('')
  const columns = useMemo(() => {
    const map = Object.fromEntries(PROSPECT_COLUMNS.map((col) => [col.id, []]))
    for (const prospect of prospects) { const col = columnFor(prospect); if (col) map[col].push(prospect) }
    for (const col of Object.keys(map)) map[col].sort((a, b) => col === 'ready' ? (b.fit_score || 0) - (a.fit_score || 0) : Date.parse(b.last_contact_at || b.updated_at || 0) - Date.parse(a.last_contact_at || a.updated_at || 0))
    return map
  }, [prospects])
  const waiting = prospects.filter((p) => !columnFor(p)).length

  const drop = (column) => (event) => {
    event.preventDefault(); setOver('')
    const id = event.dataTransfer.getData('text/plain') || dragging
    const prospect = prospects.find((p) => p.id === id)
    if (prospect && columnFor(prospect) !== column) onMove(prospect, column)
    setDragging('')
  }

  return <section className="pb" aria-label="Quadro da prospecção">
    {waiting > 0 && <p className="data-note">{waiting} prospect{waiting === 1 ? '' : 's'} ainda sem pesquisa (entram no quadro quando a IA terminar).</p>}
    <div className="pb-board">
      {PROSPECT_COLUMNS.map((col) => <div key={col.id} className={`pb-col${over === col.id ? ' over' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setOver(col.id) }} onDragLeave={() => setOver('')} onDrop={drop(col.id)}>
        <header><strong>{col.label}</strong><span>{columns[col.id].length}</span><small>{col.hint}</small></header>
        {columns[col.id].map((prospect) => {
          const days = daysSince(prospect.last_contact_at, now)
          return <article key={prospect.id} className={`pb-card${dragging === prospect.id ? ' dragging' : ''}`} draggable={!busy}
            onDragStart={(event) => { event.dataTransfer.setData('text/plain', prospect.id); setDragging(prospect.id) }} onDragEnd={() => setDragging('')}
            onClick={() => onOpen(prospect.id)}>
            <div className="pb-top">{prospect.fit_score != null && <span className={`pb-score ${prospect.fit_score >= 70 ? 'high' : prospect.fit_score >= 40 ? 'mid' : 'low'}`}>{prospect.fit_score}</span>}<span className="pb-list">{prospect.prospect_lists?.name || ''}</span></div>
            <h4>{prospect.contact_name || 'Decisor a confirmar'}</h4>
            <p>{[prospect.contact_role, prospect.company_name].filter(Boolean).join(' · ')}</p>
            {['invited', 'connected', 'messaged'].includes(col.id) && days != null && <small className={days >= 7 ? 'late' : ''}>{col.id === 'invited' ? 'convite' : col.id === 'connected' ? 'aceitou' : 'mensagem'} {ago(days)}</small>}
            <select className="pb-move" value={col.id} onClick={(event) => event.stopPropagation()} onChange={(event) => onMove(prospect, event.target.value)} aria-label={`Mover ${prospect.contact_name || prospect.company_name}`}>
              {PROSPECT_COLUMNS.map((target) => <option key={target.id} value={target.id}>{target.id === col.id ? 'Mover para…' : target.label}</option>)}
            </select>
          </article>
        })}
        {!columns[col.id].length && <p className="pb-empty">Arraste para cá</p>}
      </div>)}
    </div>
  </section>
}
