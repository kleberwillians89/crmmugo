/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, FileUp, BriefcaseBusiness as Linkedin, Mail, Plus, RefreshCw, Search, Send, Settings2, Sparkles, X } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'
import { useAuth } from '../contexts/AuthContext'
import { normalizeProspectRow, parseCsv } from '../lib/prospectCsv'
import {
  PROSPECT_STATUSES, approveProspectEmails, convertProspect, createProspect, createProspectList, getOutreachSettings, importProspects,
  listProspectActivities, listProspectLists, listProspectQueue, listProspects, logProspectActivity, researchProspects, saveOutreachSettings,
  sendProspectTest, stopProspectSequence, updateProspect,
} from '../services/data/growthRepository'

const statusLabel = Object.fromEntries(PROSPECT_STATUSES)
const linkedinLabel = { pending: 'A enviar', connection_sent: 'Convite enviado', connected: 'Conectou', messaged: 'Mensagem enviada', skipped: 'Pulado' }
const emailLabel = { pending: 'Não aprovado', approved: 'Aprovado', sequence: 'Em sequência', replied: 'Respondeu', bounced: 'Não entregue', stopped: 'Parado', skipped: 'Pulado' }
const dateTime = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '—'
const scoreClass = (score) => score == null ? '' : score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low'
const linkedinSearch = (prospect) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([prospect.contact_name, prospect.company_name].filter(Boolean).join(' '))}`
const DEFAULT_TEMPLATE = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2933;max-width:560px">\n  {{corpo}}\n  {{assinatura}}\n</div>'
const emptyProspect = { company_name: '', website: '', instagram: '', contact_name: '', contact_role: '', contact_email: '', contact_linkedin_url: '', segment: '', city: '', notes: '' }

function copy(text, done) { navigator.clipboard?.writeText(text || '').then(done, () => window.prompt('Copie o texto:', text || '')) }

export function ProspectingPage({ onNavigate }) {
  const { canOperate, canWrite } = useAuth()
  const [tab, setTab] = useState('today')
  const [prospects, setProspects] = useState([]), [lists, setLists] = useState([]), [settings, setSettings] = useState(null)
  const [selectedId, setSelectedId] = useState(null), [checked, setChecked] = useState(new Set())
  const [filters, setFilters] = useState({ q: '', status: 'all', list: 'all' })
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [feedback, setFeedback] = useState('')
  const [importing, setImporting] = useState(null), [creating, setCreating] = useState(null)

  async function load() {
    setError('')
    try { const [rows, listRows, config] = await Promise.all([listProspects(), listProspectLists(), getOutreachSettings()]); setProspects(rows); setLists(listRows); setSettings(config) }
    catch (cause) { setError(cause.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const selected = prospects.find((item) => item.id === selectedId) || null
  const replace = (row) => setProspects((current) => current.map((item) => item.id === row.id ? row : item))
  const run = async (label, action, success) => {
    setBusy(label); setError(''); setFeedback('')
    try { const result = await action(); if (success) setFeedback(typeof success === 'function' ? success(result) : success); return result }
    catch (cause) { setError(cause.message) } finally { setBusy('') }
  }

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return prospects.filter((item) => (filters.status === 'all' || item.status === filters.status) && (filters.list === 'all' || item.list_id === filters.list)
      && (!q || [item.company_name, item.contact_name, item.contact_email, item.segment, item.city].some((value) => String(value || '').toLowerCase().includes(q))))
  }, [prospects, filters])

  const today = useMemo(() => {
    const active = prospects.filter((item) => !['replied', 'converted', 'disqualified', 'do_not_contact'].includes(item.status))
    const target = Number(settings?.daily_linkedin_target || 20)
    return {
      toResearch: prospects.filter((item) => item.status === 'new' && ['idle', 'failed'].includes(item.research_status)),
      researching: prospects.filter((item) => ['queued', 'running'].includes(item.research_status)),
      linkedin: active.filter((item) => item.research_status === 'done' && item.linkedin_state === 'pending' && item.linkedin_note).sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0)).slice(0, target),
      linkedinFollow: active.filter((item) => item.linkedin_state === 'connected' && item.linkedin_message),
      emails: active.filter((item) => item.research_status === 'done' && item.email_state === 'pending' && item.contact_email && item.email_body).sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0)),
      replied: prospects.filter((item) => item.status === 'replied'),
      metrics: {
        total: prospects.length,
        contacted: prospects.filter((item) => ['contacted', 'replied', 'meeting', 'converted'].includes(item.status)).length,
        replied: prospects.filter((item) => ['replied', 'meeting', 'converted'].includes(item.status)).length,
        meetings: prospects.filter((item) => ['meeting', 'converted'].includes(item.status)).length,
      },
    }
  }, [prospects, settings])

  const toggle = (id) => setChecked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const research = (ids) => run('research', async () => { const result = await researchProspects(ids); await load(); return result }, (r) => `Pesquisa iniciada para ${r.queued}. ${r.done ? `${r.done} já prontos; ` : ''}o resto fica pronto em alguns minutos.`)
  const approve = (ids) => run('approve', async () => { const result = await approveProspectEmails(ids); await load(); return result }, (r) => {
    const ok = r.filter((item) => item.ok).length, failed = r.filter((item) => !item.ok)
    return `${ok} sequência(s) aprovada(s).${failed.length ? ` ${failed.length} com pendência: ${failed[0].reason}` : ''}`
  })
  async function markLinkedin(prospect, state) {
    const patch = { linkedin_state: state, last_contact_at: new Date().toISOString() }
    if (['new', 'ready'].includes(prospect.status) && state !== 'skipped') patch.status = 'contacted'
    await run('linkedin', async () => { replace(await updateProspect(prospect.id, patch)); await logProspectActivity(prospect.id, 'linkedin', `linkedin_${state}`) }, state === 'skipped' ? 'Pulado.' : 'Registrado.')
  }
  async function convert(prospect, channel) {
    const note = window.prompt('O que a pessoa respondeu? (opcional — vai para a oportunidade)') ?? null
    if (note === null) return
    await run('convert', async () => { await convertProspect(prospect.id, channel, note); await load() }, 'Virou lead no funil Comercial, com tarefa para o responsável.')
  }

  if (loading) return <div className="dashboard-panel page-skeleton">Carregando prospecção…</div>
  if (!canOperate) return <FeedbackMessage type="error">A prospecção é restrita ao time comercial.</FeedbackMessage>

  return <div className="g-page prospecting-page">
    <PageHeader eyebrow="Comercial" title="Prospecção" description="Leads novos com pesquisa e mensagem prontas. LinkedIn é enviado por você; e-mail sai da caixa do domínio de prospecção."
      actions={<>
        <button className="button secondary" onClick={() => setCreating({ ...emptyProspect })}><Plus size={15} /> Prospect</button>
        <button className="button" onClick={() => setImporting({ rows: [], listName: '', listId: '' })}><FileUp size={15} /> Importar CSV</button>
      </>} />
    {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
    {feedback && <FeedbackMessage type="success">{feedback}</FeedbackMessage>}
    {settings?.email_enabled !== true && <FeedbackMessage type="info">Envio de e-mail desligado. Ligue em Configuração depois do aquecimento do domínio (2–3 semanas). Até lá, use a fila do LinkedIn.</FeedbackMessage>}

    <section className="g-metrics">
      <article><b>{today.metrics.total}</b><span>na base</span></article>
      <article><b>{today.metrics.contacted}</b><span>abordados</span></article>
      <article><b>{today.metrics.replied}</b><span>responderam</span></article>
      <article><b>{today.metrics.meetings}</b><span>reuniões</span></article>
      <article><b>{today.metrics.contacted ? Math.round(today.metrics.replied / today.metrics.contacted * 100) : 0}%</b><span>taxa de resposta</span></article>
    </section>

    <nav className="section-tabs" aria-label="Prospecção">
      {[['today', 'Fila de hoje'], ['all', `Todos (${prospects.length})`], ['settings', 'Configuração']].map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </nav>

    {tab === 'today' && <div className="g-today">
      {today.replied.length > 0 && <section className="dashboard-panel g-alert"><CheckCircle2 size={18} /><div><strong>{today.replied.length} responderam</strong><small>Já estão no funil Comercial com tarefa para o responsável.</small></div><button className="button secondary small" onClick={() => onNavigate('commercial')}>Abrir funil</button></section>}
      {(today.toResearch.length > 0 || today.researching.length > 0) && <section className="dashboard-panel g-alert"><Sparkles size={18} /><div><strong>{today.toResearch.length} sem pesquisa{today.researching.length ? ` · ${today.researching.length} pesquisando` : ''}</strong><small>A IA lê o site, busca o decisor e escreve as mensagens.</small></div>
        {today.toResearch.length > 0 && <button className="button small" disabled={Boolean(busy)} onClick={() => research(today.toResearch.slice(0, 25).map((item) => item.id))}>{busy === 'research' ? 'Pesquisando…' : `Pesquisar ${Math.min(25, today.toResearch.length)}`}</button>}
        <button className="button secondary small" onClick={load} aria-label="Atualizar"><RefreshCw size={14} /></button></section>}

      <div className="g-columns">
        <section className="dashboard-panel g-queue">
          <header><Linkedin size={18} /><div><strong>LinkedIn — convites de hoje</strong><small>{today.linkedin.length} de {settings?.daily_linkedin_target || 20} sugeridos. Abra, cole a nota e marque.</small></div></header>
          {today.linkedin.map((prospect) => <article key={prospect.id} className="g-queue-item">
            <button type="button" className="g-link" onClick={() => setSelectedId(prospect.id)}><b>{prospect.contact_name || 'Decisor a confirmar'}</b><small>{prospect.contact_role ? `${prospect.contact_role} · ` : ''}{prospect.company_name}</small></button>
            <span className={`g-score ${scoreClass(prospect.fit_score)}`}>{prospect.fit_score ?? '—'}</span>
            <p>{prospect.linkedin_note}</p>
            <div className="row-actions">
              <a className="button secondary small" href={prospect.contact_linkedin_url || linkedinSearch(prospect)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {prospect.contact_linkedin_url ? 'Abrir perfil' : 'Buscar no LinkedIn'}</a>
              <button className="button secondary small" onClick={() => copy(prospect.linkedin_note, () => setFeedback('Nota copiada.'))}><Copy size={13} /> Copiar nota</button>
              <button className="button small" disabled={Boolean(busy)} onClick={() => markLinkedin(prospect, 'connection_sent')}>Convite enviado</button>
              <button className="button secondary small" disabled={Boolean(busy)} onClick={() => markLinkedin(prospect, 'skipped')}>Pular</button>
            </div>
          </article>)}
          {!today.linkedin.length && <p className="empty-state">Nenhum convite pendente. Importe ou pesquise novos prospects.</p>}
          {today.linkedinFollow.length > 0 && <>
            <h4>Conectaram — mandar mensagem</h4>
            {today.linkedinFollow.map((prospect) => <article key={prospect.id} className="g-queue-item compact">
              <button type="button" className="g-link" onClick={() => setSelectedId(prospect.id)}><b>{prospect.contact_name || prospect.company_name}</b><small>{prospect.company_name}</small></button>
              <div className="row-actions">
                <button className="button secondary small" onClick={() => copy(prospect.linkedin_message, () => setFeedback('Mensagem copiada.'))}><Copy size={13} /> Copiar mensagem</button>
                <button className="button small" onClick={() => markLinkedin(prospect, 'messaged')}>Mensagem enviada</button>
              </div>
            </article>)}
          </>}
        </section>

        <section className="dashboard-panel g-queue">
          <header><Mail size={18} /><div><strong>E-mails para aprovar</strong><small>Revise e aprove; o envio respeita o limite diário ({settings?.daily_email_limit || 30}/dia) e horário comercial.</small></div></header>
          {today.emails.slice(0, 30).map((prospect) => <article key={prospect.id} className="g-queue-item">
            <button type="button" className="g-link" onClick={() => setSelectedId(prospect.id)}><b>{prospect.email_subject}</b><small>{prospect.contact_name || prospect.company_name} · {prospect.contact_email}</small></button>
            <span className={`g-score ${scoreClass(prospect.fit_score)}`}>{prospect.fit_score ?? '—'}</span>
            <p className="g-clamp">{prospect.email_body}</p>
            <div className="row-actions">
              <button className="button secondary small" onClick={() => setSelectedId(prospect.id)}>Revisar</button>
              <button className="button small" disabled={Boolean(busy)} onClick={() => approve([prospect.id])}><Send size={13} /> Aprovar sequência</button>
            </div>
          </article>)}
          {today.emails.length > 1 && <button className="button secondary" disabled={Boolean(busy)} onClick={() => window.confirm(`Aprovar ${Math.min(30, today.emails.length)} sequências sem revisar uma a uma?`) && approve(today.emails.slice(0, 30).map((item) => item.id))}>Aprovar todos os {Math.min(30, today.emails.length)}</button>}
          {!today.emails.length && <p className="empty-state">Nada para aprovar. Prospects precisam de e-mail do contato e pesquisa concluída.</p>}
        </section>
      </div>
    </div>}

    {tab === 'all' && <section className="dashboard-panel">
      <div className="g-toolbar">
        <label className="g-search"><Search size={15} /><input placeholder="Buscar empresa, contato, e-mail…" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></label>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">Todos os status</option>{PROSPECT_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <select value={filters.list} onChange={(event) => setFilters({ ...filters, list: event.target.value })}><option value="all">Todas as listas</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
        {checked.size > 0 && <>
          <button className="button small" disabled={Boolean(busy)} onClick={() => research([...checked])}><Sparkles size={13} /> Pesquisar {checked.size}</button>
          <button className="button secondary small" disabled={Boolean(busy)} onClick={() => approve([...checked])}><Send size={13} /> Aprovar e-mails</button>
          <button className="button secondary small" onClick={() => setChecked(new Set())}>Limpar seleção</button>
        </>}
      </div>
      <div className="g-table-wrap"><table className="g-table">
        <thead><tr><th><input type="checkbox" aria-label="Selecionar todos" checked={filtered.length > 0 && filtered.every((item) => checked.has(item.id))} onChange={(event) => setChecked(event.target.checked ? new Set(filtered.map((item) => item.id)) : new Set())} /></th><th>Empresa / contato</th><th>Nota</th><th>Status</th><th>LinkedIn</th><th>E-mail</th><th>Atualizado</th></tr></thead>
        <tbody>{filtered.slice(0, 300).map((item) => <tr key={item.id} onClick={() => setSelectedId(item.id)}>
          <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Selecionar ${item.company_name}`} checked={checked.has(item.id)} onChange={() => toggle(item.id)} /></td>
          <td><b>{item.company_name}</b><small>{[item.contact_name, item.contact_role].filter(Boolean).join(' · ') || '—'}</small></td>
          <td><span className={`g-score ${scoreClass(item.fit_score)}`}>{item.research_status === 'running' || item.research_status === 'queued' ? '…' : item.fit_score ?? '—'}</span></td>
          <td>{statusLabel[item.status]}</td><td>{linkedinLabel[item.linkedin_state]}</td><td>{emailLabel[item.email_state]}</td><td>{dateTime(item.updated_at)}</td>
        </tr>)}</tbody>
      </table></div>
      {filtered.length > 300 && <p className="data-note">Mostrando 300 de {filtered.length}. Use os filtros.</p>}
      {!filtered.length && <p className="empty-state">Nenhum prospect com esses filtros.</p>}
    </section>}

    {tab === 'settings' && settings !== undefined && <OutreachSettings settings={settings} canWrite={canWrite} onSaved={(row) => { setSettings(row); setFeedback('Configuração salva.') }} onError={setError} />}

    {selected && <ProspectDrawer key={selected.id} prospect={selected} busy={busy} onClose={() => setSelectedId(null)} onChange={replace} run={run} onLinkedin={markLinkedin} onConvert={convert} onApprove={(id) => approve([id])} onResearch={(id) => research([id])} reload={load} />}
    {importing && <ImportModal state={importing} setState={setImporting} lists={lists} onDone={async (message) => { setImporting(null); setFeedback(message); await load() }} onError={setError} />}
    {creating && <div className="modal-overlay"><form className="dashboard-panel g-modal" onSubmit={(event) => { event.preventDefault(); run('create', async () => { await createProspect(Object.fromEntries(Object.entries(creating).map(([key, value]) => [key, String(value).trim() || null]))); setCreating(null); await load() }, 'Prospect criado. Clique em Pesquisar para a IA preparar as mensagens.') }}>
      <h2>Novo prospect</h2>
      <div className="form-grid">
        {[['company_name', 'Empresa *'], ['website', 'Site'], ['instagram', 'Instagram'], ['segment', 'Segmento'], ['city', 'Cidade'], ['contact_name', 'Contato'], ['contact_role', 'Cargo'], ['contact_email', 'E-mail'], ['contact_linkedin_url', 'LinkedIn do contato']].map(([key, label]) =>
          <label key={key}>{label}<input required={key === 'company_name'} type={key === 'contact_email' ? 'email' : 'text'} value={creating[key]} onChange={(event) => setCreating({ ...creating, [key]: event.target.value })} /></label>)}
        <label className="g-wide">Observações para a IA<textarea rows="2" value={creating.notes} onChange={(event) => setCreating({ ...creating, notes: event.target.value })} placeholder="Ex.: indicação do fulano; viu nosso post sobre tráfego…" /></label>
      </div>
      <div className="row-actions"><button type="button" className="button secondary" onClick={() => setCreating(null)}>Cancelar</button><button className="button" type="submit" disabled={Boolean(busy)}>Criar</button></div>
    </form></div>}
  </div>
}

function ProspectDrawer({ prospect, busy, onClose, onChange, run, onLinkedin, onConvert, onApprove, onResearch, reload }) {
  const [draft, setDraft] = useState({ linkedin_note: prospect.linkedin_note || '', linkedin_message: prospect.linkedin_message || '', email_subject: prospect.email_subject || '', email_body: prospect.email_body || '', email_followups: prospect.email_followups || [], contact_email: prospect.contact_email || '', contact_name: prospect.contact_name || '', contact_linkedin_url: prospect.contact_linkedin_url || '', notes: prospect.notes || '' })
  const [activities, setActivities] = useState([]), [queue, setQueue] = useState([])
  useEffect(() => { let active = true; Promise.all([listProspectActivities(prospect.id), listProspectQueue(prospect.id)]).then(([rows, steps]) => { if (active) { setActivities(rows); setQueue(steps) } }).catch(() => null); return () => { active = false } }, [prospect.id, prospect.updated_at])
  const research = prospect.research || {}
  const dirty = Object.keys(draft).some((key) => JSON.stringify(draft[key] ?? '') !== JSON.stringify(prospect[key] ?? (key === 'email_followups' ? [] : '')))
  const save = () => run('save', async () => onChange(await updateProspect(prospect.id, { ...draft, contact_email: draft.contact_email.trim().toLowerCase() || null, email_followups: draft.email_followups.filter((item) => item.trim()) })), 'Salvo.')
  const setStatus = (status) => run('status', async () => { onChange(await updateProspect(prospect.id, { status })); if (['disqualified', 'do_not_contact'].includes(status) && ['approved', 'sequence'].includes(prospect.email_state)) await stopProspectSequence(prospect.id) }, 'Status atualizado.')
  const noteLength = draft.linkedin_note.length

  return <><button className="drawer-backdrop" aria-label="Fechar" onClick={onClose} /><aside className="g-drawer" aria-label={`Prospect ${prospect.company_name}`}>
    <header><div><small>{prospect.prospect_lists?.name || 'Sem lista'} · {statusLabel[prospect.status]}</small><h2>{prospect.company_name}</h2>
      <p>{[prospect.website && <a key="w" href={/^https?:/.test(prospect.website) ? prospect.website : `https://${prospect.website}`} target="_blank" rel="noreferrer">{prospect.website}</a>, prospect.instagram, prospect.city].filter(Boolean).map((item, index) => <span key={index}>{item}</span>)}</p></div>
      <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>

    <section className="g-block">
      <div className="g-block-head"><strong>Pesquisa da IA</strong><span className={`g-score ${scoreClass(prospect.fit_score)}`}>{prospect.fit_score ?? '—'}</span>
        <button className="button secondary small" disabled={Boolean(busy) || ['queued', 'running'].includes(prospect.research_status)} onClick={() => onResearch(prospect.id)}><Sparkles size={13} /> {prospect.research_status === 'done' ? 'Refazer' : ['queued', 'running'].includes(prospect.research_status) ? 'Pesquisando…' : 'Pesquisar'}</button></div>
      {prospect.research_error && <FeedbackMessage type="error">{prospect.research_error}</FeedbackMessage>}
      {prospect.fit_reason && <p><b>Encaixe:</b> {prospect.fit_reason}</p>}
      {research.summary && <p>{research.summary}</p>}
      {prospect.hook && <p className="g-hook"><b>Gancho:</b> {prospect.hook}</p>}
      {research.signals?.length > 0 && <ul className="g-signals">{research.signals.map((signal) => <li key={signal}>{signal}</li>)}</ul>}
      {research.site && !research.site.error && <p className="data-note">Site: {research.site.platform || 'plataforma não identificada'} · Pixel Meta {research.site.meta_pixel ? 'sim' : 'não'} · GA {research.site.google_analytics ? 'sim' : 'não'}{research.site.response_ms ? ` · ${(research.site.response_ms / 1000).toFixed(1)}s` : ''}</p>}
    </section>

    <section className="g-block">
      <div className="g-block-head"><strong>Contato</strong></div>
      <div className="form-grid">
        <label>Nome<input value={draft.contact_name} onChange={(event) => setDraft({ ...draft, contact_name: event.target.value })} /></label>
        <label>E-mail<input type="email" value={draft.contact_email} onChange={(event) => setDraft({ ...draft, contact_email: event.target.value })} /></label>
        <label className="g-wide">LinkedIn<input value={draft.contact_linkedin_url} onChange={(event) => setDraft({ ...draft, contact_linkedin_url: event.target.value })} placeholder="https://www.linkedin.com/in/…" /></label>
      </div>
    </section>

    <section className="g-block">
      <div className="g-block-head"><Linkedin size={16} /><strong>LinkedIn</strong><span className="g-badge">{linkedinLabel[prospect.linkedin_state]}</span></div>
      <label>Nota do convite <small className={noteLength > 300 ? 'g-over' : ''}>{noteLength}/300</small><textarea rows="4" value={draft.linkedin_note} onChange={(event) => setDraft({ ...draft, linkedin_note: event.target.value })} /></label>
      <label>Mensagem depois de conectar<textarea rows="4" value={draft.linkedin_message} onChange={(event) => setDraft({ ...draft, linkedin_message: event.target.value })} /></label>
      <div className="row-actions">
        <a className="button secondary small" href={draft.contact_linkedin_url || linkedinSearch(prospect)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {draft.contact_linkedin_url ? 'Abrir perfil' : 'Buscar'}</a>
        <button className="button secondary small" onClick={() => copy(draft.linkedin_note)}><Copy size={13} /> Nota</button>
        <button className="button secondary small" onClick={() => copy(draft.linkedin_message)}><Copy size={13} /> Mensagem</button>
        {prospect.linkedin_state === 'pending' && <button className="button small" onClick={() => onLinkedin(prospect, 'connection_sent')}>Convite enviado</button>}
        {prospect.linkedin_state === 'connection_sent' && <button className="button small" onClick={() => onLinkedin(prospect, 'connected')}>Conectou</button>}
        {prospect.linkedin_state === 'connected' && <button className="button small" onClick={() => onLinkedin(prospect, 'messaged')}>Mensagem enviada</button>}
        <button className="button secondary small" onClick={() => onConvert(prospect, 'linkedin')}>Respondeu no LinkedIn</button>
      </div>
    </section>

    <section className="g-block">
      <div className="g-block-head"><Mail size={16} /><strong>E-mail</strong><span className="g-badge">{emailLabel[prospect.email_state]}</span></div>
      <label>Assunto<input value={draft.email_subject} onChange={(event) => setDraft({ ...draft, email_subject: event.target.value })} /></label>
      <label>Corpo (texto; o HTML e a assinatura são aplicados no envio)<textarea rows="8" value={draft.email_body} onChange={(event) => setDraft({ ...draft, email_body: event.target.value })} /></label>
      {[0, 1].map((index) => <label key={index}>Follow-up {index + 1}<textarea rows="3" value={draft.email_followups[index] || ''} onChange={(event) => { const next = [...draft.email_followups]; next[index] = event.target.value; setDraft({ ...draft, email_followups: next }) }} /></label>)}
      {queue.length > 0 && <ol className="g-steps">{queue.map((step) => <li key={step.id}><b>{step.step === 0 ? 'E-mail 1' : `Follow-up ${step.step}`}</b> — {step.status === 'sent' ? `enviado ${dateTime(step.sent_at)}` : step.status === 'cancelled' ? 'cancelado' : step.status === 'failed' ? `falhou: ${step.error_message}` : `agendado ${dateTime(step.scheduled_for)}`}</li>)}</ol>}
      <div className="row-actions">
        <button className="button secondary small" disabled={Boolean(busy) || dirty} title={dirty ? 'Salve antes' : ''} onClick={() => run('test', () => sendProspectTest(prospect.id), (r) => `Teste enviado para ${r.sent_to}.`)}>Enviar teste para mim</button>
        {['pending', 'stopped'].includes(prospect.email_state) && <button className="button small" disabled={Boolean(busy) || dirty} onClick={() => onApprove(prospect.id)}><Send size={13} /> Aprovar sequência</button>}
        {['approved', 'sequence'].includes(prospect.email_state) && <button className="button secondary small" onClick={() => run('stop', async () => { await stopProspectSequence(prospect.id); await reload() }, 'Sequência parada.')}>Parar sequência</button>}
      </div>
    </section>

    <section className="g-block">
      <div className="g-block-head"><strong>Status e notas</strong></div>
      <label>Status<select value={prospect.status} onChange={(event) => setStatus(event.target.value)}>{PROSPECT_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Observações<textarea rows="3" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      {activities.length > 0 && <ul className="g-activity">{activities.map((item) => <li key={item.id}><small>{dateTime(item.created_at)}</small> {item.activity_type.replaceAll('_', ' ')}{item.content ? ` — ${item.content}` : ''}</li>)}</ul>}
    </section>
    <footer><button className="button" disabled={!dirty || Boolean(busy)} onClick={save}>Salvar alterações</button></footer>
  </aside></>
}

function ImportModal({ state, setState, lists, onDone, onError }) {
  const [saving, setSaving] = useState(false)
  async function readFile(file) {
    if (!file) return
    const rows = parseCsv(await file.text()).map(normalizeProspectRow).filter(Boolean)
    setState({ ...state, rows, fileName: file.name, listName: state.listName || file.name.replace(/\.[^.]+$/, '') })
  }
  async function submit(event) {
    event.preventDefault(); setSaving(true)
    try {
      let listId = state.listId
      if (!listId) listId = (await createProspectList({ name: state.listName || 'Importação', segment: state.segment || null, source: 'csv' })).id
      const result = await importProspects(state.rows, listId)
      onDone(`${result.inserted} prospects importados${result.duplicates ? ` (${result.duplicates} já existiam)` : ''}. Agora é só pesquisar.`)
    } catch (cause) { onError(cause.message) } finally { setSaving(false) }
  }
  return <div className="modal-overlay"><form className="dashboard-panel g-modal" onSubmit={submit}>
    <h2>Importar prospects</h2>
    <p className="data-note">Aceita CSV do Apollo, da Casa dos Dados (base de CNPJ) ou planilha própria. Colunas reconhecidas: empresa, site, instagram, CNPJ, cidade, UF, nome, cargo, e-mail, LinkedIn, telefone.</p>
    <label>Arquivo CSV<input type="file" accept=".csv,text/csv" onChange={(event) => readFile(event.target.files?.[0])} /></label>
    <label>Lista<select value={state.listId} onChange={(event) => setState({ ...state, listId: event.target.value })}><option value="">Criar lista nova</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
    {!state.listId && <div className="form-grid"><label>Nome da lista<input required value={state.listName} onChange={(event) => setState({ ...state, listName: event.target.value })} /></label><label>Segmento<input value={state.segment || ''} onChange={(event) => setState({ ...state, segment: event.target.value })} placeholder="Ex.: e-commerce de moda" /></label></div>}
    {state.rows.length > 0 && <div className="g-preview"><b>{state.rows.length} prospects encontrados</b>{state.rows.slice(0, 5).map((row, index) => <small key={index}>{row.company_name}{row.contact_name ? ` — ${row.contact_name}` : ''}{row.contact_email ? ` · ${row.contact_email}` : ''}</small>)}</div>}
    {state.fileName && !state.rows.length && <FeedbackMessage type="error">Não encontrei linhas com nome de empresa nesse arquivo.</FeedbackMessage>}
    <div className="row-actions"><button type="button" className="button secondary" onClick={() => setState(null)}>Cancelar</button><button className="button" type="submit" disabled={!state.rows.length || saving}>{saving ? 'Importando…' : 'Importar'}</button></div>
  </form></div>
}

function OutreachSettings({ settings, canWrite, onSaved, onError }) {
  const [form, setForm] = useState(() => ({ icp: '', offer: '', sender_name: '', sender_email: '', daily_email_limit: 30, daily_linkedin_target: 20, send_window_start: '08:30', send_window_end: '18:00', followup_days: '3, 7', email_template_html: DEFAULT_TEMPLATE, signature_html: '', email_enabled: false, ...(settings || {}), ...(settings?.followup_days ? { followup_days: settings.followup_days.join(', ') } : {}) }))
  const [saving, setSaving] = useState(false)
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
  const preview = String(form.email_template_html || DEFAULT_TEMPLATE).replaceAll('{{corpo}}', '<p style="margin:0 0 12px">Oi Ana, vi que a Loja X ainda não tem o pixel da Meta no site…</p><p style="margin:0 0 12px">Faz sentido eu te mandar 3 pontos rápidos?</p>').replaceAll('{{assinatura}}', form.signature_html || '').replaceAll('{{nome}}', 'Ana').replaceAll('{{empresa}}', 'Loja X')
  async function submit(event) {
    event.preventDefault(); setSaving(true)
    try {
      const days = String(form.followup_days).split(/[,;\s]+/).map(Number).filter((day) => day > 0 && day < 60).slice(0, 3)
      const values = { icp: form.icp || null, offer: form.offer || null, sender_name: form.sender_name || null, sender_email: form.sender_email || null, daily_email_limit: Number(form.daily_email_limit), daily_linkedin_target: Number(form.daily_linkedin_target), send_window_start: form.send_window_start, send_window_end: form.send_window_end, followup_days: days.length ? days : [3, 7], email_template_html: form.email_template_html || null, signature_html: form.signature_html || null, email_enabled: Boolean(form.email_enabled) }
      onSaved(await saveOutreachSettings(values))
    } catch (cause) { onError(cause.message) } finally { setSaving(false) }
  }
  return <form className="dashboard-panel g-settings" onSubmit={submit}>
    <header><Settings2 size={18} /><div><strong>Como a IA aborda</strong><small>Usado na pesquisa e nas mensagens.</small></div></header>
    <div className="form-grid">
      <label className="g-wide">Cliente ideal (ICP)<textarea rows="3" value={form.icp || ''} onChange={set('icp')} disabled={!canWrite} placeholder="Ex.: e-commerce de moda/beleza em Shopify ou Nuvemshop, faturando 100k–2M/mês, com Instagram ativo e pouco investimento em tráfego." /></label>
      <label className="g-wide">Oferta da abordagem<textarea rows="2" value={form.offer || ''} onChange={set('offer')} disabled={!canWrite} placeholder="Ex.: diagnóstico gratuito de 20 min com 3 melhorias de tráfego e conversão." /></label>
      <label>Meta de convites LinkedIn/dia<input type="number" min="1" max="100" value={form.daily_linkedin_target} onChange={set('daily_linkedin_target')} disabled={!canWrite} /></label>
    </div>
    <header><Mail size={18} /><div><strong>E-mail de prospecção</strong><small>Sai da caixa do domínio secundário (Google Workspace). Nunca pelo Resend.</small></div></header>
    <div className="form-grid">
      <label>Nome do remetente<input value={form.sender_name || ''} onChange={set('sender_name')} disabled={!canWrite} placeholder="Kleber | Mugô" /></label>
      <label>E-mail do remetente<input type="email" value={form.sender_email || ''} onChange={set('sender_email')} disabled={!canWrite} placeholder="kleber@seudominio2.com.br" /><small>Precisa ser o mesmo do secret GMAIL_SENDER.</small></label>
      <label>Limite de e-mails/dia<input type="number" min="1" max="200" value={form.daily_email_limit} onChange={set('daily_email_limit')} disabled={!canWrite} /><small>Comece com 10–15 e suba aos poucos.</small></label>
      <label>Follow-ups depois de (dias)<input value={form.followup_days} onChange={set('followup_days')} disabled={!canWrite} placeholder="3, 7" /></label>
      <label>Enviar a partir de<input type="time" value={String(form.send_window_start).slice(0, 5)} onChange={set('send_window_start')} disabled={!canWrite} /></label>
      <label>Até<input type="time" value={String(form.send_window_end).slice(0, 5)} onChange={set('send_window_end')} disabled={!canWrite} /></label>
      <label className="g-wide">HTML leve do e-mail — use {'{{corpo}}'} e {'{{assinatura}}'} (opcionais: {'{{nome}}'}, {'{{empresa}}'})<textarea rows="6" className="g-code" value={form.email_template_html || ''} onChange={set('email_template_html')} disabled={!canWrite} /></label>
      <label className="g-wide">Assinatura (HTML)<textarea rows="4" className="g-code" value={form.signature_html || ''} onChange={set('signature_html')} disabled={!canWrite} placeholder={'<p style="margin:16px 0 0">Kleber<br>Mugô · mugoagencia.com.br</p>'} /></label>
      <div className="g-wide"><small>Pré-visualização</small><iframe title="Pré-visualização do e-mail" className="g-iframe" sandbox="" srcDoc={preview} /></div>
      <label className="g-check g-wide"><input type="checkbox" checked={Boolean(form.email_enabled)} onChange={set('email_enabled')} disabled={!canWrite} /> Envio de e-mail ligado (só depois do aquecimento do domínio)</label>
    </div>
    {canWrite && <div className="row-actions"><button className="button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar configuração'}</button></div>}
  </form>
}
