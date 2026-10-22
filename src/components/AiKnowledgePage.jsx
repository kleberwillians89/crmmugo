/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { Bot, Plus, Save, Trash2 } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../services/data/provider'
import { KNOWLEDGE_CATEGORIES, deleteKnowledge, getCommercialSettings, listKnowledge, saveKnowledge } from '../services/data/growthRepository'

const MODES = [
  ['disabled', 'Desligada', 'A IA não responde. Todo atendimento é humano.'],
  ['copilot', 'Copiloto', 'A IA escreve a resposta e alguém aprova no CRM antes de sair. Recomendado para começar.'],
  ['controlled_auto', 'Automática', 'A IA responde sozinha o primeiro atendimento e passa para o time quando o lead está qualificado.'],
]
const EXAMPLES = {
  empresa: 'Ex.: A Mugô é uma agência de marketing digital de São Paulo. Atendemos e-commerce, gestoras de investimento e talentos…',
  servicos: 'Ex.: Tráfego pago (Meta e Google Ads): planejamento, criação de campanhas, otimização semanal e relatório mensal…',
  precos: 'Ex.: Social media a partir de R$ X/mês. Só informar faixa; valor fechado sempre com o time.',
  cases: 'Ex.: Roove (athleisure): páginas de coleção e campanha de lançamento — resultado…',
  faq: 'Ex.: Vocês atendem fora de SP? Sim, 100% remoto…',
  regras: 'Ex.: Nunca prometer resultado em prazo. Não falar de concorrentes. Não dar desconto.',
  tom: 'Ex.: Leve, direto, sem emoji, tratando por "você".',
}
const empty = { category: 'servicos', title: '', content: '', active: true, sort_order: 0 }

export function AiKnowledgePage() {
  const { canWrite, profile } = useAuth()
  const [entries, setEntries] = useState([]), [settings, setSettings] = useState(null)
  const [editing, setEditing] = useState(null), [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [feedback, setFeedback] = useState('')

  async function load() {
    setLoading(true); setError('')
    try { const [rows, config] = await Promise.all([listKnowledge(), getCommercialSettings()]); setEntries(rows); setSettings(config || { ai_mode: 'disabled', followup_enabled: true, followup_after_minutes: 240, debounce_seconds: 8 }) }
    catch (cause) { setError(cause.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const counts = useMemo(() => Object.fromEntries(KNOWLEDGE_CATEGORIES.map(([id]) => [id, entries.filter((entry) => entry.category === id && entry.active).length])), [entries])
  const visible = filter === 'all' ? entries : entries.filter((entry) => entry.category === filter)

  async function submitEntry(event) {
    event.preventDefault(); setError('')
    try { await saveKnowledge(editing); setEditing(null); setFeedback('Base da IA atualizada.'); await load() } catch (cause) { setError(cause.message) }
  }
  async function remove(entry) {
    if (!window.confirm(`Excluir “${entry.title}” da base?`)) return
    try { await deleteKnowledge(entry.id); await load() } catch (cause) { setError(cause.message) }
  }
  async function saveSettings(event) {
    event.preventDefault(); setError('')
    const patch = {
      ai_mode: settings.ai_mode, meeting_link: settings.meeting_link?.trim() || null, voice_tone: settings.voice_tone?.trim() || null,
      triage_cta_url: settings.triage_cta_url?.trim() || null, triage_cta_label: settings.triage_cta_label?.trim() || null, triage_cta_url_2: settings.triage_cta_url_2?.trim() || null, triage_cta_label_2: settings.triage_cta_label_2?.trim() || null, followup_enabled: Boolean(settings.followup_enabled), followup_after_minutes: Number(settings.followup_after_minutes || 240), debounce_seconds: Number(settings.debounce_seconds ?? 8),
    }
    try {
      const organizationId = settings.organization_id || profile?.organization_id
      const result = settings.organization_id
        ? await db().from('commercial_settings').update(patch).eq('organization_id', organizationId).select().single()
        : await db().from('commercial_settings').insert({ organization_id: organizationId, ...patch }).select().single()
      if (result.error) throw result.error
      setSettings(result.data); setFeedback('Configurações do atendimento salvas.')
    } catch (cause) { setError(cause.message) }
  }

  if (loading) return <div className="dashboard-panel page-skeleton">Carregando…</div>
  const set = (key) => (event) => setSettings({ ...settings, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
  const missing = KNOWLEDGE_CATEGORIES.filter(([id]) => ['empresa', 'servicos', 'regras'].includes(id) && !counts[id])

  return <div className="g-page">
    <PageHeader eyebrow="Configurações" title="Base da IA" description="Tudo o que a IA pode usar para atender no WhatsApp e escrever a prospecção. Se não está aqui, ela não afirma." actions={canWrite && <button className="button" onClick={() => setEditing({ ...empty })}><Plus size={15} /> Novo item</button>} />
    {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
    {feedback && <FeedbackMessage type="success">{feedback}</FeedbackMessage>}
    {missing.length > 0 && <FeedbackMessage type="info">Para a IA atender bem, preencha pelo menos: {missing.map(([, label]) => label).join(', ')}.</FeedbackMessage>}

    <form className="dashboard-panel g-settings" onSubmit={saveSettings}>
      <header><Bot size={18} /><div><strong>Atendimento no WhatsApp</strong><small>Como a IA se comporta com leads novos.</small></div></header>
      <fieldset className="g-mode" disabled={!canWrite}>
        {MODES.map(([id, label, help]) => <label key={id} className={settings.ai_mode === id ? 'active' : ''}>
          <input type="radio" name="ai_mode" value={id} checked={settings.ai_mode === id} onChange={set('ai_mode')} />
          <span><b>{label}</b><small>{help}</small></span>
        </label>)}
      </fieldset>
      <div className="form-grid">
        <label>Link de agenda para reuniões<input type="url" placeholder="https://calendar.app.google/…" value={settings.meeting_link || ''} onChange={set('meeting_link')} disabled={!canWrite} /></label>
        <label>Esperar antes de responder (segundos)<input type="number" min="0" max="30" value={settings.debounce_seconds ?? 8} onChange={set('debounce_seconds')} disabled={!canWrite} /><small>Junta mensagens seguidas do lead numa resposta só.</small></label>
        <label className="g-check"><input type="checkbox" checked={Boolean(settings.followup_enabled)} onChange={set('followup_enabled')} disabled={!canWrite} /> Retomar lead que parou de responder (uma vez, só no modo automático)</label>
        <label>Retomar depois de (minutos)<input type="number" min="30" max="1380" value={settings.followup_after_minutes ?? 240} onChange={set('followup_after_minutes')} disabled={!canWrite || !settings.followup_enabled} /></label>
        <label>Botão da triagem — link do WhatsApp da equipe<input type="url" placeholder="https://wa.me/5511999999999" value={settings.triage_cta_url || ''} onChange={set('triage_cta_url')} disabled={!canWrite} /><small>Quando a IA passa o atendimento para o time, a mensagem sai com um botão que abre este WhatsApp, já com o assunto escrito.</small></label>
        <label>Texto do botão (até 20 letras)<input maxLength="20" placeholder="Falar com a equipe" value={settings.triage_cta_label || ''} onChange={set('triage_cta_label')} disabled={!canWrite} /></label>
        <label>2º WhatsApp da equipe (opcional)<input type="url" placeholder="https://wa.me/5511988888888" value={settings.triage_cta_url_2 || ''} onChange={set('triage_cta_url_2')} disabled={!canWrite} /><small>Vai numa segunda mensagem, logo depois, com o próprio botão.</small></label>
        <label>Texto do 2º botão (até 20 letras)<input maxLength="20" placeholder="Outro atendente" value={settings.triage_cta_label_2 || ''} onChange={set('triage_cta_label_2')} disabled={!canWrite} /></label>
        <label className="g-wide">Tom de voz (opcional)<textarea rows="2" placeholder={EXAMPLES.tom} value={settings.voice_tone || ''} onChange={set('voice_tone')} disabled={!canWrite} /></label>
      </div>
      {canWrite && <div className="row-actions"><button className="button" type="submit"><Save size={15} /> Salvar atendimento</button></div>}
    </form>

    <nav className="section-tabs" aria-label="Categorias da base">
      <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tudo ({entries.length})</button>
      {KNOWLEDGE_CATEGORIES.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label} ({counts[id] || 0})</button>)}
    </nav>
    <section className="g-cards">
      {visible.map((entry) => <article key={entry.id} className={`dashboard-panel g-card${entry.active ? '' : ' inactive'}`}>
        <header><small>{KNOWLEDGE_CATEGORIES.find(([id]) => id === entry.category)?.[1]}</small>{!entry.active && <span className="g-badge">Inativo</span>}</header>
        <h3>{entry.title}</h3>
        <p className="g-pre">{entry.content}</p>
        {canWrite && <div className="row-actions"><button className="button secondary small" onClick={() => setEditing(entry)}>Editar</button><button className="button secondary small" onClick={() => remove(entry)} aria-label="Excluir"><Trash2 size={14} /></button></div>}
      </article>)}
      {!visible.length && <p className="empty-state">Nada aqui ainda. Comece por “Sobre a Mugô”, “Serviços” e “O que a IA não pode dizer”.</p>}
    </section>

    {editing && <div className="modal-overlay"><form className="dashboard-panel g-modal" onSubmit={submitEntry} role="dialog" aria-modal="true">
      <h2>{editing.id ? 'Editar item' : 'Novo item da base'}</h2>
      <label>Categoria<select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })}>{KNOWLEDGE_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Título<input required maxLength="200" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
      <label>Conteúdo<textarea required rows="8" maxLength="6000" placeholder={EXAMPLES[editing.category]} value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /></label>
      <label className="g-check"><input type="checkbox" checked={editing.active !== false} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} /> Ativo (a IA usa este item)</label>
      <div className="row-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancelar</button><button className="button" type="submit">Salvar</button></div>
    </form></div>}
  </div>
}
