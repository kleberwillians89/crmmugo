import { useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Search } from 'lucide-react'
import { APOLLO_PRESETS, MAX_IMPORT } from '../../supabase/functions/_shared/apolloCore.js'
import { apolloImport, apolloSearch } from '../services/data/growthRepository'

const EMPLOYEES = [['1,10', '1–10'], ['11,20', '11–20'], ['21,50', '21–50'], ['51,100', '51–100'], ['101,200', '101–200'], ['201,500', '201–500']]
const join = (items) => (items || []).join(', ')
const fromPreset = (id) => {
  const preset = APOLLO_PRESETS[id]
  return { preset: id, titles: join(preset.titles), keywords: join(preset.keywords), locations: 'São Paulo, Brazil', employees: preset.employees, technologies: join(preset.technologies), page: 1 }
}

/** Busca no Apollo dentro do CRM: filtra, escolhe e traz para a fila (com a pesquisa da IA já rodando). */
export function ApolloSearchPanel({ canOperate, onImported, onError }) {
  const [form, setForm] = useState(() => fromPreset('moda_beleza'))
  const [result, setResult] = useState(null), [picked, setPicked] = useState(new Set())
  const [busy, setBusy] = useState(''), [listName, setListName] = useState(''), [problem, setProblem] = useState('')
  const fail = (cause) => { setProblem(cause.message); onError(cause.message) }
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  const toggleRange = (range) => setForm({ ...form, employees: form.employees.includes(range) ? form.employees.filter((r) => r !== range) : [...form.employees, range] })

  async function search(page = 1) {
    setBusy('search'); onError(''); setProblem('')
    try {
      const data = await apolloSearch({ ...form, page })
      setResult(data); setForm((current) => ({ ...current, page }))
      setPicked(new Set())
    } catch (cause) { fail(cause) } finally { setBusy('') }
  }

  function toggle(id) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else if (next.size < MAX_IMPORT) next.add(id)
    setPicked(next)
  }

  async function bring() {
    if (!picked.size) return
    if (!window.confirm(`Trazer ${picked.size} pessoa${picked.size === 1 ? '' : 's'} para o CRM? A IA já começa a pesquisar as empresas.`)) return
    setBusy('import'); onError(''); setProblem('')
    try {
      const name = listName.trim() || `${APOLLO_PRESETS[form.preset]?.label || 'Apollo'} — ${new Date().toLocaleDateString('pt-BR')}`
      const data = await apolloImport(people.filter((row) => picked.has(row.apollo_id)), name)
      setPicked(new Set())
      await onImported(data)
    } catch (cause) { fail(cause) } finally { setBusy('') }
  }

  const people = result?.people || []
  return <div className="g-page">
    <form className="dashboard-panel g-settings" onSubmit={(event) => { event.preventDefault(); search(1) }}>
      <header><Search size={18} /><div><strong>Buscar no Apollo</strong><small>A busca não gasta crédito. No plano grátis o sobrenome vem mascarado: depois de trazer, o botão “Buscar no LinkedIn” acha a pessoa pelo nome e pela empresa.</small></div></header>
      <div className="g-chips">{Object.entries(APOLLO_PRESETS).map(([id, preset]) => <button key={id} type="button" className={`g-chip${form.preset === id ? ' active' : ''}`} onClick={() => setForm(fromPreset(id))}>{preset.label}</button>)}</div>
      <div className="form-grid">
        <label className="g-wide">Cargos<input value={form.titles} onChange={set('titles')} placeholder="Founder, CEO, Sócio, Head of Marketing" /></label>
        <label className="g-wide">Palavras-chave da empresa<input value={form.keywords} onChange={set('keywords')} placeholder="loja online, moda feminina, skincare" /></label>
        <label>Onde fica a empresa<input value={form.locations} onChange={set('locations')} placeholder="São Paulo, Brazil" /></label>
        <label>Tecnologia do site (opcional)<input value={form.technologies} onChange={set('technologies')} placeholder="shopify, vtex, nuvemshop" /></label>
        <div className="g-wide"><span className="g-label">Funcionários</span><div className="g-chips">{EMPLOYEES.map(([range, label]) => <label key={range} className={`g-chip${form.employees.includes(range) ? ' active' : ''}`}><input type="checkbox" checked={form.employees.includes(range)} onChange={() => toggleRange(range)} /> {label}</label>)}</div></div>
      </div>
      {problem && <p className="feedback-message error" role="alert">{problem}</p>}
      <div className="row-actions"><button className="button" type="submit" disabled={Boolean(busy) || !canOperate}><Search size={14} /> {busy === 'search' ? 'Buscando…' : 'Buscar'}</button></div>
    </form>

    {result && <section className="dashboard-panel">
      <div className="g-toolbar">
        <strong style={{ flex: 1 }}>{result.total ? `${result.total.toLocaleString('pt-BR')} pessoas encontradas` : `${people.length} pessoas`} · página {result.page}</strong>
        <button className="button secondary small" disabled={Boolean(busy) || result.page <= 1} onClick={() => search(result.page - 1)} aria-label="Página anterior"><ArrowLeft size={13} /></button>
        <button className="button secondary small" disabled={Boolean(busy) || people.length < 25} onClick={() => search(result.page + 1)} aria-label="Próxima página"><ArrowRight size={13} /></button>
      </div>
      <div className="g-table-wrap"><table className="g-table">
        <thead><tr><th /><th>Pessoa</th><th>Cargo</th><th>Empresa</th><th>Cidade</th><th /></tr></thead>
        <tbody>{people.map((row) => <tr key={row.apollo_id} className={row.already ? 'g-muted' : ''}>
          <td><input type="checkbox" checked={picked.has(row.apollo_id)} disabled={row.already || (!picked.has(row.apollo_id) && picked.size >= MAX_IMPORT)} onChange={() => toggle(row.apollo_id)} aria-label={`Escolher ${row.first_name}`} /></td>
          <td>{row.first_name} {row.last_name}</td>
          <td>{row.title || '—'}</td>
          <td><b>{row.company}</b>{row.website && <small className="g-sub"> · <a href={`https://${row.website}`} target="_blank" rel="noreferrer">{row.website}</a></small>}</td>
          <td>{[row.city, row.state].filter(Boolean).join(', ') || '—'}</td>
          <td>{row.already ? <span className="tag">Já no CRM</span> : row.maybe_agency ? <span className="tag warn">Parece agência</span> : null}</td>
        </tr>)}</tbody>
      </table></div>
      {!people.length && <p className="empty-state">Nada com esses filtros. Tire a tecnologia ou alguma palavra-chave.</p>}
      <div className="g-toolbar" style={{ marginTop: 12 }}>
        <label style={{ flex: 1 }}>Nome da lista<input value={listName} onChange={(event) => setListName(event.target.value)} placeholder={`${APOLLO_PRESETS[form.preset]?.label || 'Apollo'} — ${new Date().toLocaleDateString('pt-BR')}`} /></label>
        <button className="button" disabled={!picked.size || Boolean(busy)} onClick={bring}><Download size={14} /> {busy === 'import' ? 'Trazendo e pesquisando…' : `Trazer ${picked.size || ''} para o CRM`}</button>
      </div>
      <p className="data-note">Até {MAX_IMPORT} por vez. Empresas que já estão no CRM ficam de fora.</p>
    </section>}
  </div>
}
