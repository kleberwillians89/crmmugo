import { useMemo, useState } from 'react'
import { Check, ExternalLink, Search, Sparkles, X } from 'lucide-react'
import { whenBr } from '../lib/whenBr'

const MIN = 3, MAX = 8

/**
 * Notícias da semana em cards: o time marca as que quer e a IA escreve a edição só com elas.
 * Notícias que já saíram em edições anteriores não aparecem.
 */
export function NewsPicker({ news, categories, edition, busy, now, onGenerate }) {
  const labels = useMemo(() => Object.fromEntries(categories), [categories])
  const inEdition = useMemo(() => new Set((edition?.items || []).map((item) => item.news_id || item.url)), [edition])
  const pool = useMemo(() => news.filter((item) => !item.edition_id || item.edition_id === edition?.id), [news, edition])
  const [selected, setSelected] = useState(() => new Set(pool.filter((item) => inEdition.has(item.id) || inEdition.has(item.url)).map((item) => item.id)))
  const [theme, setTheme] = useState(''), [query, setQuery] = useState(''), [warning, setWarning] = useState('')

  const counts = useMemo(() => pool.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {}), [pool])
  const q = query.trim().toLowerCase()
  const visible = pool.filter((item) => (!theme || item.category === theme) && (!q || `${item.title} ${item.excerpt || ''} ${item.source_name}`.toLowerCase().includes(q)))
  const picked = pool.filter((item) => selected.has(item.id))

  const toggle = (id) => {
    setWarning('')
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else if (next.size >= MAX) { setWarning(`Máximo de ${MAX} notícias por edição. Tire uma para escolher outra.`); return }
    else next.add(id)
    setSelected(next)
  }

  return <section className="dashboard-panel np" aria-label="Escolher notícias da semana">
    <header className="np-head">
      <div><strong>Notícias da semana</strong><small>Marque de {MIN} a {MAX}. A IA escreve título, resumo e “na prática” só das escolhidas.</small></div>
      <label className="np-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por palavra ou fonte" aria-label="Buscar notícia" /></label>
    </header>

    <div className="np-filters" role="tablist" aria-label="Filtrar por tema">
      <button type="button" role="tab" aria-selected={!theme} className={!theme ? 'active' : ''} onClick={() => setTheme('')}>Todas <small>{pool.length}</small></button>
      {categories.filter(([id]) => counts[id]).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={theme === id} className={theme === id ? 'active' : ''} onClick={() => setTheme(id)}>{label} <small>{counts[id]}</small></button>)}
    </div>

    {visible.length ? <div className="np-grid">
      {visible.slice(0, 120).map((item) => {
        const on = selected.has(item.id)
        return <article key={item.id} className={`np-card${on ? ' on' : ''}`} onClick={() => toggle(item.id)}>
          <div className="np-meta">
            <span className="np-tag">{labels[item.category] || item.category}</span>
            <span>{item.source_name} · {whenBr(item.published_at, now)}</span>
            <button type="button" className="np-check" aria-pressed={on} aria-label={on ? 'Tirar da edição' : 'Escolher para a edição'} onClick={(e) => { e.stopPropagation(); toggle(item.id) }}>{on && <Check size={14} />}</button>
          </div>
          <h3>{item.title}</h3>
          {item.excerpt && <p>{item.excerpt}</p>}
          <footer>
            <a href={item.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink size={12} /> Ler na fonte</a>
            {(inEdition.has(item.id) || inEdition.has(item.url)) && <span className="np-badge">Na edição atual</span>}
          </footer>
        </article>
      })}
    </div> : <p className="empty-state">Nenhuma notícia {theme ? 'nesse tema' : ''}{q ? ' com essa busca' : ''} nos últimos dias.</p>}

    <div className="np-bar" aria-live="polite">
      <div className="np-picked">
        <strong>{picked.length} de {MAX}</strong>
        <div className="np-pills">{picked.map((item) => <span key={item.id} title={item.title}><em>{item.title}</em><button type="button" aria-label="Tirar" onClick={() => toggle(item.id)}><X size={11} /></button></span>)}</div>
        {warning && <small className="np-warn">{warning}</small>}
      </div>
      <div className="np-actions">
        {picked.length > 0 && <button type="button" className="button secondary small" onClick={() => setSelected(new Set())}>Limpar</button>}
        <button type="button" className="button" disabled={picked.length < MIN || Boolean(busy)} onClick={() => onGenerate(picked.map((item) => item.id))}><Sparkles size={14} /> {busy === 'compose' ? 'Escrevendo…' : picked.length < MIN ? `Escolha mais ${MIN - picked.length}` : `Escrever edição com ${picked.length}`}</button>
      </div>
    </div>
  </section>
}
