/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Copy, Download, Link2, Newspaper, Plus, RefreshCw, Save, Send, Settings2, SkipForward, Sparkles, Trash2, Zap } from 'lucide-react'
import { toPng } from 'html-to-image'
import { FeedbackMessage } from './FeedbackMessage'
import { whenBr } from '../lib/whenBr'
import { NewsPicker } from './NewsPicker'
import { composeLinkedinPost, renderLinkedinSlides, renderNewsletterHtml } from '../../supabase/functions/_shared/newsletterCore.js'
import {
  NEWS_CATEGORIES, addNewsletterSource, deleteNewsletterSource, getNewsletterSettings, listEditions, listNewsletterSources,
  listRecentNews, newsletterAction, newsletterFlash, saveNewsletterSettings, updateEdition, updateNewsletterSource,
} from '../services/data/growthRepository'

const SIGNUP_URL = 'https://crm.mugoagencia.com.br/news'
const AD_URL = `${SIGNUP_URL}?utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}`
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const statusLabel = { draft: 'Aguardando aprovação', approved: 'Aprovada — agendada', sent: 'Enviada', skipped: 'Pulada', failed: 'Falhou' }
const dateBr = (iso) => String(iso || '').split('-').reverse().join('/')
const DEFAULTS = { enabled: false, auto_send: false, generate_weekday: 1, generate_time: '07:00', send_weekday: 2, send_time: '07:45', items_count: 5, focus: '', themes: [], template_html: '', item_template_html: '', from_name: 'Mugô', from_email: '', reply_to: 'mugo.agencia@gmail.com', linkedin_cover_html: '', linkedin_slide_html: '', linkedin_hashtags: '#marketingdigital #trafegopago #ecommerce' }

function copy(text, done) { navigator.clipboard?.writeText(text || '').then(done, () => window.prompt('Copie o texto:', text || '')) }

export function NewsletterPanel() {
  const [settings, setSettings] = useState(null), [sources, setSources] = useState([]), [editions, setEditions] = useState([]), [news, setNews] = useState([])
  const [view, setView] = useState('edition'), [selectedId, setSelectedId] = useState(null), [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [feedback, setFeedback] = useState('')
  const [loadedAt, setLoadedAt] = useState(0)
  const [weekThemes, setWeekThemes] = useState(null), [weekFocus, setWeekFocus] = useState('')

  async function load(keepSelection = true) {
    setError('')
    try {
      const [config, sourceRows, editionRows, newsRows] = await Promise.all([getNewsletterSettings(), listNewsletterSources(), listEditions(), listRecentNews()])
      setSettings({ ...DEFAULTS, ...(config || {}) }); setSources(sourceRows); setEditions(editionRows); setNews(newsRows); setLoadedAt(Date.now())
      const current = keepSelection && selectedId ? editionRows.find((row) => row.id === selectedId) : editionRows[0]
      setSelectedId(current?.id || null); setDraft(current ? structuredClone(current) : null)
    } catch (cause) { setError(cause.message) }
  }
  useEffect(() => { load(false) }, [])

  const run = async (label, action, success) => {
    setBusy(label); setError(''); setFeedback('')
    try { const result = await action(); if (success) setFeedback(typeof success === 'function' ? success(result) : success); return result }
    catch (cause) { setError(cause.message) } finally { setBusy('') }
  }
  const selected = editions.find((row) => row.id === selectedId) || null
  const dirty = Boolean(selected && draft && JSON.stringify(['subject', 'preheader', 'intro', 'items', 'linkedin_post'].map((k) => draft[k])) !== JSON.stringify(['subject', 'preheader', 'intro', 'items', 'linkedin_post'].map((k) => selected[k])))
  const editable = draft && ['draft', 'failed'].includes(draft.status)
  const themes = weekThemes ?? (draft?.themes?.length ? draft.themes : settings?.themes || [])
  const newsCountByTheme = useMemo(() => news.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {}), [news])
  const freshness = useMemo(() => {
    const active = sources.filter((source) => source.active)
    const fetched = active.map((source) => Date.parse(source.last_fetched_at || '')).filter(Number.isFinite)
    const generatedAt = selected ? (selected.generated_at || selected.created_at) : null
    const generatedMs = Date.parse(generatedAt || '')
    return {
      fetchedAt: fetched.length ? new Date(Math.max(...fetched)).toISOString() : null,
      sources: active.length,
      failing: active.filter((source) => source.last_error).length,
      generatedAt,
      newSince: Number.isFinite(generatedMs) ? news.filter((item) => Date.parse(item.created_at || '') > generatedMs).length : 0,
    }
  }, [sources, news, selected])
  const toggleTheme = (id) => setWeekThemes(themes.includes(id) ? themes.filter((t) => t !== id) : [...themes, id])

  if (!settings) return <div className="dashboard-panel page-skeleton">Carregando newsletter…</div>
  const setItem = (index, patch) => setDraft({ ...draft, items: draft.items.map((item, i) => i === index ? { ...item, ...patch } : item) })
  const saveDraft = () => run('save', async () => { const saved = await updateEdition(draft.id, { subject: draft.subject, preheader: draft.preheader, intro: draft.intro, items: draft.items, linkedin_post: draft.linkedin_post }); setEditions((rows) => rows.map((row) => row.id === saved.id ? saved : row)); setDraft(structuredClone(saved)); await newsletterAction('rerender', saved.id) }, 'Edição salva.')

  return <div className="g-page">
    {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
    {feedback && <FeedbackMessage type="success">{feedback}</FeedbackMessage>}
    {!settings.enabled && <FeedbackMessage type="info">Geração automática desligada. Ligue em Configuração — ou gere a edição desta semana manualmente para testar.</FeedbackMessage>}

    <nav className="section-tabs" aria-label="Newsletter">
      {[['edition', 'Edição da semana'], ['flash', 'Edição extra (LinkedIn)'], ['sources', `Fontes (${sources.filter((s) => s.active).length})`], ['settings', 'Configuração e layouts']].map(([id, label]) => <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}
    </nav>

    {view === 'edition' && <>
      <section className="dashboard-panel g-alert">
        <Newspaper size={18} />
        <div><strong>{selected ? `Semana de ${dateBr(selected.week_start)} · ${statusLabel[selected.status]}` : 'Nenhuma edição ainda'}</strong><small>Gerada {WEEKDAYS[settings.generate_weekday].toLowerCase()} às {String(settings.generate_time).slice(0, 5)}; enviada {WEEKDAYS[settings.send_weekday].toLowerCase()} às {String(settings.send_time).slice(0, 5)} depois de aprovada.</small></div>
        {editions.length > 1 && <select value={selectedId || ''} onChange={(event) => { const row = editions.find((item) => item.id === event.target.value); setSelectedId(row.id); setDraft(structuredClone(row)) }}>{editions.map((row) => <option key={row.id} value={row.id}>{dateBr(row.week_start)} — {statusLabel[row.status]}</option>)}</select>}
        <button className="button small" disabled={Boolean(busy)} onClick={() => (!selected || window.confirm('Gerar de novo a edição desta semana? As edições manuais serão substituídas.')) && run('generate', async () => { await newsletterAction('generate_now', null, { themes, focus: weekFocus.trim() || null }); setWeekThemes(null); await load(false) }, 'Edição gerada. Revise as notícias abaixo.')}><Sparkles size={13} /> {busy === 'generate' ? 'Gerando…' : selected ? 'Gerar de novo' : 'Gerar edição agora'}</button>
      </section>
      <section className="dashboard-panel g-freshness" aria-label="Última atualização">
        <div><small>Notícias buscadas</small><strong>{whenBr(freshness.fetchedAt, loadedAt)}</strong><span>{freshness.sources} fontes{freshness.failing ? ` · ${freshness.failing} com erro` : ''}</span></div>
        <div><small>Edição gerada</small><strong>{selected ? whenBr(freshness.generatedAt, loadedAt) : 'ainda não'}</strong><span>{selected && freshness.newSince > 0 ? `${freshness.newSince} notícias novas chegaram depois` : selected ? 'nada novo desde então' : '—'}</span></div>
        <button className="button secondary small" disabled={Boolean(busy)} onClick={() => run('feeds', async () => { const r = await newsletterAction('refresh_feeds'); await load(); return r }, (r) => `${r.added} notícias novas coletadas.`)}><RefreshCw size={13} /> {busy === 'feeds' ? 'Buscando…' : 'Buscar notícias agora'}</button>
      </section>
      {editable || !selected ? <NewsPicker key={`${selected?.id || 'nova'}-${selected?.generated_at || selected?.updated_at || ''}`} news={news} categories={NEWS_CATEGORIES} edition={selected} busy={busy} now={loadedAt}
        onGenerate={(ids) => (!selected || window.confirm(`Escrever a edição com as ${ids.length} notícias escolhidas? O texto atual da edição será substituído.`)) && run('compose', async () => { await newsletterAction('generate_now', null, { news_ids: ids, focus: weekFocus.trim() || null }); await load(false) }, 'Edição escrita com as notícias escolhidas. Revise o texto abaixo.')} /> : null}
      <section className="dashboard-panel g-settings g-themes">
        <header><Sparkles size={18} /><div><strong>Ou deixe a IA escolher</strong><small>Marque os temas da semana e clique em “{selected ? 'Gerar de novo' : 'Gerar edição agora'}” lá em cima. Nenhum marcado = marketing e negócios + uma dica cultural de SP.</small></div></header>
        <div className="g-chips">{NEWS_CATEGORIES.map(([id, label]) => <label key={id} className={`g-chip${themes.includes(id) ? ' active' : ''}`}><input type="checkbox" checked={themes.includes(id)} onChange={() => toggleTheme(id)} /> {label} <small>{newsCountByTheme[id] || 0}</small></label>)}</div>
        <label>Foco da semana (opcional)<input value={weekFocus} onChange={(e) => setWeekFocus(e.target.value)} placeholder="Ex.: agenda cultural do feriado em SP + novidades de IA para anúncios" /></label>
        <small>Os temas e o foco valem ao clicar em “{selected ? 'Gerar de novo' : 'Gerar edição agora'}”. O padrão da geração automática fica em Configuração.</small>
      </section>
      {draft?.error_message && <FeedbackMessage type="error">{draft.error_message}</FeedbackMessage>}

      {draft && draft.items?.length > 0 && <div className="g-columns g-newsletter">
        <section className="dashboard-panel g-settings">
          <header><CheckCircle2 size={18} /><div><strong>Validar notícias</strong><small>Tire, troque ou edite. Nada sai antes de você aprovar.</small></div></header>
          <label>Assunto<input value={draft.subject || ''} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} disabled={!editable} /></label>
          <label>Linha de apoio (preheader)<input value={draft.preheader || ''} onChange={(e) => setDraft({ ...draft, preheader: e.target.value })} disabled={!editable} /></label>
          <label>Abertura<textarea rows="3" value={draft.intro || ''} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} disabled={!editable} /></label>
          {draft.items.map((item, index) => <article key={item.url} className="g-news-item">
            <header><small>{String(index + 1).padStart(2, '0')} · {item.source_name}</small><a href={item.url} target="_blank" rel="noreferrer">fonte</a>{editable && <button type="button" className="button secondary small" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })} aria-label="Remover notícia"><Trash2 size={13} /></button>}</header>
            <label>Título<input value={item.title_pt} onChange={(e) => setItem(index, { title_pt: e.target.value })} disabled={!editable} /></label>
            <label>Resumo<textarea rows="3" value={item.summary_pt} onChange={(e) => setItem(index, { summary_pt: e.target.value })} disabled={!editable} /></label>
            <label>Na prática<textarea rows="2" value={item.impact_pt} onChange={(e) => setItem(index, { impact_pt: e.target.value })} disabled={!editable} /></label>
          </article>)}
          <div className="row-actions">
            {editable && <button className="button secondary" disabled={!dirty || Boolean(busy)} onClick={saveDraft}><Save size={14} /> Salvar</button>}
            {editable && <button className="button" disabled={dirty || draft.items.length < 3 || Boolean(busy)} title={dirty ? 'Salve antes de aprovar' : ''} onClick={() => window.confirm(`Aprovar e agendar o envio para ${WEEKDAYS[settings.send_weekday].toLowerCase()} às ${String(settings.send_time).slice(0, 5)}?`) && run('approve', async () => { const r = await newsletterAction('approve', draft.id); await load(); return r }, (r) => `Aprovada. Envio agendado para ${new Date(r.scheduled_for).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`)}><CheckCircle2 size={14} /> Aprovar newsletter</button>}
            {editable && <button className="button secondary" disabled={dirty || draft.items.length < 3 || Boolean(busy)} onClick={() => window.confirm('Aprovar e ENVIAR AGORA para toda a base?') && run('now', async () => { await newsletterAction('approve_now', draft.id); await load() }, 'Aprovada e enviando agora. As métricas aparecem em Campanhas.')}><Send size={14} /> Aprovar e enviar agora</button>}
            {editable && <button className="button secondary" disabled={Boolean(busy)} onClick={() => window.confirm('Pular a newsletter desta semana?') && run('skip', async () => { await newsletterAction('skip', draft.id); await load() }, 'Semana pulada.')}><SkipForward size={14} /> Pular semana</button>}
          </div>
        </section>
        <section className="dashboard-panel g-settings">
          <header><Newspaper size={18} /><div><strong>Como fica o e-mail</strong><small>Layout atual: {settings.template_html ? 'o seu HTML' : 'provisório'}.</small></div></header>
          <iframe title="Pré-visualização da newsletter" className="g-iframe tall" sandbox="" srcDoc={renderNewsletterHtml({ template: settings.template_html, itemTemplate: settings.item_template_html, edition: draft }).replaceAll('{{nome}}', 'Ana').replaceAll('{{descadastro}}', '#')} />
        </section>
      </div>}

      {draft && draft.items?.length > 0 && <LinkedinBlock draft={draft} setDraft={setDraft} editable={editable} settings={settings} onCopied={() => setFeedback('Post copiado.')} onError={setError} />}
    </>}

    {view === 'flash' && <FlashBlock news={news} settings={settings} run={run} busy={busy} onCopied={() => setFeedback('Post copiado.')} onError={setError} />}
    {view === 'sources' && <SourcesBlock sources={sources} run={run} reload={() => load()} busy={busy} />}
    {view === 'settings' && <SettingsBlock settings={settings} run={run} onSaved={(row) => setSettings({ ...DEFAULTS, ...row })} busy={busy} />}
  </div>
}

function LinkedinBlock({ draft, setDraft, editable, settings, onCopied, onError, skipCover = false, title = 'LinkedIn — página da Mugô' }) {
  const allSlides = renderLinkedinSlides({ coverTemplate: settings.linkedin_cover_html, slideTemplate: settings.linkedin_slide_html, edition: draft })
  const slides = skipCover ? allSlides.slice(1) : allSlides
  const holder = useRef(null)
  const [exporting, setExporting] = useState(false)
  async function download() {
    setExporting(true)
    try {
      for (const [index, html] of slides.entries()) {
        const node = document.createElement('div')
        node.style.cssText = 'position:fixed;left:-20000px;top:0;width:1080px;height:1350px;overflow:hidden'
        node.innerHTML = html
        holder.current.appendChild(node)
        const url = await toPng(node.firstElementChild || node, { width: 1080, height: 1350, pixelRatio: 1, cacheBust: true })
        node.remove()
        const link = document.createElement('a'); link.href = url; link.download = `mugo-newsletter-${draft.week_start}-${String(index + 1).padStart(2, '0')}.png`; link.click()
      }
    } catch (cause) { onError(`Não consegui gerar as imagens: ${cause.message}`) } finally { setExporting(false) }
  }
  return <section className="dashboard-panel g-settings">
    <header><Download size={18} /><div><strong>{title}</strong><small>Post pronto + {slides.length} {slides.length === 1 ? 'imagem' : 'imagens (capa + 1 por notícia). Publique como post com várias imagens'}.</small></div></header>
    <label>Texto do post<textarea rows="10" value={draft.linkedin_post || ''} onChange={(e) => setDraft({ ...draft, linkedin_post: e.target.value })} disabled={!editable} /></label>
    <div className="row-actions">
      <button className="button secondary" onClick={() => copy(composeLinkedinPost(draft, settings.linkedin_hashtags), onCopied)}><Copy size={14} /> Copiar post com hashtags</button>
      <button className="button" disabled={exporting} onClick={download}><Download size={14} /> {exporting ? 'Gerando imagens…' : 'Baixar imagens (PNG)'}</button>
    </div>
    <div className="g-slides" ref={holder}>
      {slides.map((html, index) => <div key={index} className="g-slide"><iframe title={`Slide ${index + 1}`} sandbox="" srcDoc={`<!doctype html><html><body style="margin:0">${html}</body></html>`} /></div>)}
    </div>
  </section>
}

function SourcesBlock({ sources, run, reload, busy }) {
  const [form, setForm] = useState({ name: '', url: '', category: 'marketing', language: 'pt' })
  return <section className="dashboard-panel">
    <div className="g-toolbar"><strong style={{ flex: 1 }}>Fontes de notícias (RSS)</strong><button className="button secondary small" disabled={Boolean(busy)} onClick={() => run('feeds', async () => { const r = await newsletterAction('refresh_feeds'); await reload(); return r }, (r) => `${r.added} notícias novas coletadas.`)}><RefreshCw size={13} /> Buscar notícias agora</button></div>
    <div className="g-table-wrap"><table className="g-table">
      <thead><tr><th>Fonte</th><th>Tema</th><th>Idioma</th><th>Última leitura</th><th>Ativa</th><th /></tr></thead>
      <tbody>{sources.map((source) => <tr key={source.id}>
        <td><b>{source.name}</b><small>{source.url}</small>{source.last_error && <small className="g-over">Erro: {source.last_error}</small>}</td>
        <td>{NEWS_CATEGORIES.find(([id]) => id === source.category)?.[1]}</td><td>{source.language.toUpperCase()}</td>
        <td>{source.last_fetched_at ? new Date(source.last_fetched_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
        <td><input type="checkbox" checked={source.active} onChange={(e) => run('toggle', async () => { await updateNewsletterSource(source.id, { active: e.target.checked }); await reload() })} aria-label={`Ativar ${source.name}`} /></td>
        <td><button className="button secondary small" onClick={() => window.confirm(`Remover ${source.name}?`) && run('del', async () => { await deleteNewsletterSource(source.id); await reload() })} aria-label="Remover"><Trash2 size={13} /></button></td>
      </tr>)}</tbody>
    </table></div>
    <form className="form-grid g-source-form" onSubmit={(e) => { e.preventDefault(); run('add', async () => { await addNewsletterSource(form); setForm({ name: '', url: '', category: 'marketing', language: 'pt' }); await reload() }, 'Fonte adicionada.') }}>
      <label>Nome<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Think with Google" /></label>
      <label>Endereço do RSS<input required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/feed" /></label>
      <label>Tema<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{NEWS_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Idioma<select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="pt">Português</option><option value="en">Inglês</option><option value="es">Espanhol</option></select></label>
      <div className="row-actions g-wide"><button className="button" type="submit"><Plus size={14} /> Adicionar fonte</button></div>
    </form>
  </section>
}

function SettingsBlock({ settings, run, onSaved, busy }) {
  const [form, setForm] = useState(() => ({ ...settings, generate_time: String(settings.generate_time).slice(0, 5), send_time: String(settings.send_time).slice(0, 5), tags: (settings.audience?.tags || []).join(', ') }))
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const onlySignups = form.tags.split(',').map((t) => t.trim().toLowerCase()).includes('newsletter')
  const submit = (e) => { e.preventDefault(); run('settings', async () => {
    const values = { themes: form.themes || [], enabled: form.enabled, auto_send: form.auto_send, generate_weekday: Number(form.generate_weekday), generate_time: form.generate_time, send_weekday: Number(form.send_weekday), send_time: form.send_time, items_count: Number(form.items_count), focus: form.focus || null, template_html: form.template_html || null, item_template_html: form.item_template_html || null, from_name: form.from_name || null, from_email: form.from_email || null, reply_to: form.reply_to || null, audience: { tags: form.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean), sources: [] }, linkedin_cover_html: form.linkedin_cover_html || null, linkedin_slide_html: form.linkedin_slide_html || null, linkedin_hashtags: form.linkedin_hashtags || null, signup_enabled: form.signup_enabled !== false, meta_pixel_id: String(form.meta_pixel_id || '').replace(/\D/g, '') || null }
    onSaved(await saveNewsletterSettings(values))
  }, 'Configuração salva.') }
  return <form className="dashboard-panel g-settings" onSubmit={submit}>
    <header><Settings2 size={18} /><div><strong>Agenda e público</strong><small>A edição é gerada sozinha; o envio só acontece depois da aprovação.</small></div></header>
    <div className="form-grid">
      <label className="g-check g-wide"><input type="checkbox" checked={Boolean(form.enabled)} onChange={set('enabled')} /> Gerar a edição automaticamente toda semana</label>
      <label>Gerar na<select value={form.generate_weekday} onChange={set('generate_weekday')}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
      <label>Às<input type="time" value={form.generate_time} onChange={set('generate_time')} /></label>
      <label>Enviar na<select value={form.send_weekday} onChange={set('send_weekday')}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
      <label>Às<input type="time" value={form.send_time} onChange={set('send_time')} /></label>
      <label>Notícias por edição<input type="number" min="3" max="8" value={form.items_count} onChange={set('items_count')} /></label>
      <label>Público (tags, vazio = todos)<input value={form.tags} onChange={set('tags')} placeholder="newsletter" /></label>
      <label className="g-check g-wide"><input type="checkbox" checked={onlySignups} onChange={() => setForm({ ...form, tags: onlySignups ? form.tags.split(',').map((t) => t.trim()).filter((t) => t && t !== 'newsletter').join(', ') : [...form.tags.split(',').map((t) => t.trim()).filter(Boolean), 'newsletter'].join(', ') })} /> Enviar só para quem se inscreveu e confirmou pela página (tag “newsletter”)</label>
      <div className="g-wide"><span className="g-label">Temas padrão da edição automática (nenhum = todos)</span><div className="g-chips">{NEWS_CATEGORIES.map(([id, label]) => <label key={id} className={`g-chip${(form.themes || []).includes(id) ? ' active' : ''}`}><input type="checkbox" checked={(form.themes || []).includes(id)} onChange={() => setForm({ ...form, themes: (form.themes || []).includes(id) ? form.themes.filter((t) => t !== id) : [...(form.themes || []), id] })} /> {label}</label>)}</div></div>
      <label className="g-wide">Foco editorial<textarea rows="2" value={form.focus || ''} onChange={set('focus')} placeholder="Ex.: priorizar mudanças em Meta Ads e Google, e-commerce no Brasil e criadores de conteúdo." /></label>
      <label>Nome do remetente<input value={form.from_name || ''} onChange={set('from_name')} /></label>
      <label>E-mail do remetente<input type="email" value={form.from_email || ''} onChange={set('from_email')} placeholder="novidades@news.mugoagencia.com.br" /></label>
      <label>Responder para<input type="email" value={form.reply_to || ''} onChange={set('reply_to')} /></label>
      <label className="g-check g-wide"><input type="checkbox" checked={Boolean(form.auto_send)} onChange={set('auto_send')} /> Enviar sem aprovação (não recomendado no começo)</label>
    </div>
    <header><Link2 size={18} /><div><strong>Página de inscrição</strong><small>Quem se inscreve recebe um e-mail de confirmação; só entra na lista (tag “newsletter”) depois do clique.</small></div></header>
    <div className="form-grid">
      <label className="g-check g-wide"><input type="checkbox" checked={form.signup_enabled !== false} onChange={set('signup_enabled')} /> Inscrições abertas</label>
      <div className="g-wide"><span className="g-label">Link da página</span><div className="g-copy-row"><code>{SIGNUP_URL}</code><button type="button" className="button secondary small" onClick={() => navigator.clipboard?.writeText(SIGNUP_URL)}><Copy size={13} /> Copiar</button></div></div>
      <div className="g-wide"><span className="g-label">Link para os anúncios da Meta (a campanha e o anúncio entram sozinhos)</span><div className="g-copy-row"><code>{AD_URL}</code><button type="button" className="button secondary small" onClick={() => navigator.clipboard?.writeText(AD_URL)}><Copy size={13} /> Copiar</button></div></div>
      <label>Pixel da Meta (ID)<input inputMode="numeric" value={form.meta_pixel_id || ''} onChange={set('meta_pixel_id')} placeholder="Ex.: 123456789012345" /></label>
      <p className="data-note g-wide">Com o pixel, a página registra <b>Lead</b> quando a pessoa envia o formulário e <b>CompleteRegistration</b> quando confirma o e-mail — use esse segundo evento para otimizar a campanha.</p>
    </div>
    <header><Newspaper size={18} /><div><strong>Layout do e-mail</strong><small>Cole o HTML de vocês. Campos: {'{{intro}}'}, {'{{itens}}'}, {'{{preheader}}'}, {'{{nome}}'}, {'{{descadastro}}'}. Vazio = layout provisório.</small></div></header>
    <div className="form-grid">
      <label className="g-wide">HTML da newsletter<textarea rows="8" className="g-code" value={form.template_html || ''} onChange={set('template_html')} /></label>
      <label className="g-wide">HTML de cada notícia (opcional) — {'{{titulo}}'}, {'{{resumo}}'}, {'{{impacto}}'}, {'{{fonte}}'}, {'{{link}}'}<textarea rows="5" className="g-code" value={form.item_template_html || ''} onChange={set('item_template_html')} /></label>
    </div>
    <header><Download size={18} /><div><strong>Layout do LinkedIn</strong><small>Slides de 1080×1350 (formato retrato do feed). Cole o HTML do designer. Vazio = layout provisório.</small></div></header>
    <div className="form-grid">
      <label className="g-wide">Capa — {'{{titulo_edicao}}'}, {'{{data}}'}, {'{{intro}}'}<textarea rows="5" className="g-code" value={form.linkedin_cover_html || ''} onChange={set('linkedin_cover_html')} /></label>
      <label className="g-wide">Slide da notícia — {'{{numero}}'}, {'{{titulo}}'}, {'{{resumo}}'}, {'{{impacto}}'}, {'{{fonte}}'}<textarea rows="5" className="g-code" value={form.linkedin_slide_html || ''} onChange={set('linkedin_slide_html')} /></label>
      <label className="g-wide">Hashtags<input value={form.linkedin_hashtags || ''} onChange={set('linkedin_hashtags')} /></label>
    </div>
    <div className="row-actions"><button className="button" type="submit" disabled={Boolean(busy)}><Save size={14} /> Salvar configuração</button></div>
  </form>
}

function FlashBlock({ news, settings, run, busy, onCopied, onError }) {
  const [form, setForm] = useState({ news_id: '', url: '', note: '' }), [result, setResult] = useState(null)
  return <>
    <form className="dashboard-panel g-settings" onSubmit={(e) => { e.preventDefault(); run('flash', async () => {
      const data = await newsletterFlash(form)
      setResult({ week_start: data.week_start, subject: data.title_pt, intro: '', linkedin_post: data.linkedin_post, items: [{ url: data.url, source_name: data.source_name, title_pt: data.title_pt, summary_pt: data.summary_pt, impact_pt: data.impact_pt }] })
    }, 'Post e slide prontos. Revise antes de publicar.') }}>
      <header><Zap size={18} /><div><strong>Notícia quente no meio da semana</strong><small>Gera na hora o post e o slide para a página da Mugô no LinkedIn. Não envia e-mail.</small></div></header>
      <div className="form-grid">
        <label className="g-wide">Escolha uma notícia já coletada<select value={form.news_id} onChange={(e) => setForm({ ...form, news_id: e.target.value, url: '' })}><option value="">—</option>{news.slice(0, 80).map((n) => <option key={n.id} value={n.id}>{n.source_name} — {n.title.slice(0, 100)}</option>)}</select></label>
        <label className="g-wide">…ou cole o link da notícia<input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value, news_id: '' })} placeholder="https://…" /></label>
        <label className="g-wide">Observação do time (opcional)<textarea rows="2" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ex.: focar no impacto para lojas de moda; citar que já estamos testando com clientes." /></label>
      </div>
      <div className="row-actions"><button className="button" type="submit" disabled={Boolean(busy) || (!form.news_id && !form.url && !form.note)}><Sparkles size={14} /> {busy === 'flash' ? 'Gerando…' : 'Gerar post e slide'}</button></div>
    </form>
    {result && <LinkedinBlock draft={result} setDraft={setResult} editable settings={settings} onCopied={onCopied} onError={onError} skipCover title="Edição extra — LinkedIn" />}
  </>
}
