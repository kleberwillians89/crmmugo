/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { Clock, MailPlus, RefreshCw, Send, UserPlus, Users } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'
import { useAuth } from '../contexts/AuthContext'
import {
  addEmailContact, campaignAudienceCount, listCampaigns, listEmailContacts, refreshCampaignStats, saveCampaign, scheduleCampaign,
  sendCampaignNow, sendCampaignTest, syncContactsFromCrm, unscheduleCampaign, updateEmailContact,
} from '../services/data/growthRepository'

const statusLabel = { draft: 'Rascunho', scheduled: 'Agendada', sending: 'Enviando', sent: 'Enviada', failed: 'Falhou' }
const sourceLabel = { manual: 'Manual', crm_client: 'Cliente (CRM)', crm_lead: 'Lead (CRM)', prospect_replied: 'Prospect que respondeu', import: 'Importado', form: 'Formulário' }
const dateTime = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '—'
const pct = (part, total) => total ? `${Math.round(part / total * 100)}%` : '—'
const STARTER = '<!doctype html>\n<html><body style="margin:0;background:#f4f6f8">\n  <div style="max-width:600px;margin:0 auto;background:#fff;font-family:Arial,sans-serif;padding:32px">\n    <h1 style="font-size:22px">Olá, {{nome}}!</h1>\n    <p>Cole aqui o HTML da newsletter.</p>\n    <p style="font-size:12px;color:#8b97a7"><a href="{{descadastro}}">Descadastrar</a></p>\n  </div>\n</body></html>'

export function EmailCampaignsPage() {
  const { canWrite } = useAuth()
  const [tab, setTab] = useState('campaigns')
  const [campaigns, setCampaigns] = useState([]), [contacts, setContacts] = useState([])
  const [editing, setEditing] = useState(null), [audienceCount, setAudienceCount] = useState(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [feedback, setFeedback] = useState('')
  const [contactQuery, setContactQuery] = useState(''), [newContact, setNewContact] = useState(null)

  async function load() {
    setError('')
    try { const [rows, people] = await Promise.all([listCampaigns(), listEmailContacts()]); setCampaigns(rows); setContacts(people) }
    catch (cause) { setError(cause.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const run = async (label, action, success) => {
    setBusy(label); setError(''); setFeedback('')
    try { const result = await action(); if (success) setFeedback(typeof success === 'function' ? success(result) : success); return result }
    catch (cause) { setError(cause.message) } finally { setBusy('') }
  }

  const tags = useMemo(() => [...new Set(contacts.flatMap((contact) => contact.tags || []))].sort(), [contacts])
  const subscribed = contacts.filter((contact) => contact.subscribed).length
  const visibleContacts = contacts.filter((contact) => !contactQuery || [contact.email, contact.name, ...(contact.tags || [])].some((value) => String(value || '').toLowerCase().includes(contactQuery.toLowerCase())))

  async function persist() {
    const saved = await saveCampaign(editing)
    setEditing({ ...editing, ...saved }); setCampaigns((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    return saved
  }
  async function openEditor(campaign) {
    setEditing(campaign); setAudienceCount(null)
    if (campaign.id) campaignAudienceCount(campaign.id).then((r) => setAudienceCount(r.count)).catch(() => null)
  }

  if (loading) return <div className="dashboard-panel page-skeleton">Carregando e-mail marketing…</div>
  if (!canWrite) return <FeedbackMessage type="error">E-mail marketing é restrito a administradores e gestores.</FeedbackMessage>

  return <div className="g-page">
    <PageHeader eyebrow="Comercial" title="E-mail marketing" description="Newsletter e campanhas pelo Resend, só para quem já tem relação com a Mugô. Descadastro automático em todo envio."
      actions={tab === 'campaigns' ? <button className="button" onClick={() => openEditor({ name: '', subject: '', preheader: '', html: STARTER, from_name: 'Mugô', from_email: '', reply_to: '', audience: { tags: [], sources: [] } })}><MailPlus size={15} /> Nova campanha</button>
        : <button className="button" onClick={() => setNewContact({ email: '', name: '', tags: '' })}><UserPlus size={15} /> Contato</button>} />
    {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
    {feedback && <FeedbackMessage type="success">{feedback}</FeedbackMessage>}

    <nav className="section-tabs" aria-label="E-mail marketing">
      <button type="button" className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')}>Campanhas ({campaigns.length})</button>
      <button type="button" className={tab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>Contatos ({subscribed} inscritos)</button>
    </nav>

    {tab === 'campaigns' && !editing && <section className="dashboard-panel">
      <div className="g-table-wrap"><table className="g-table">
        <thead><tr><th>Campanha</th><th>Status</th><th>Destinatários</th><th>Entregues</th><th>Abertura</th><th>Cliques</th><th>Data</th></tr></thead>
        <tbody>{campaigns.map((campaign) => { const s = campaign.stats || {}; return <tr key={campaign.id} onClick={() => openEditor(campaign)}>
          <td><b>{campaign.name}</b><small>{campaign.subject || 'Sem assunto'}</small></td>
          <td>{statusLabel[campaign.status]}</td><td>{s.recipients ?? '—'}</td><td>{pct(s.delivered, s.sent)}</td><td>{pct(s.opened, s.delivered)}</td><td>{pct(s.clicked, s.delivered)}</td>
          <td>{dateTime(campaign.sent_at || campaign.scheduled_for || campaign.created_at)}</td>
        </tr> })}</tbody>
      </table></div>
      {!campaigns.length && <p className="empty-state">Nenhuma campanha ainda. Importe os contatos do CRM na aba Contatos e crie a primeira.</p>}
    </section>}

    {tab === 'campaigns' && editing && <section className="g-editor">
      <form className="dashboard-panel g-settings" onSubmit={(event) => { event.preventDefault(); run('save', persist, 'Campanha salva.') }}>
        <div className="form-grid">
          <label>Nome interno<input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} disabled={['sending', 'sent'].includes(editing.status)} /></label>
          <label>Assunto<input required value={editing.subject} onChange={(event) => setEditing({ ...editing, subject: event.target.value })} disabled={['sending', 'sent'].includes(editing.status)} /></label>
          <label>Nome do remetente<input value={editing.from_name || ''} onChange={(event) => setEditing({ ...editing, from_name: event.target.value })} /></label>
          <label>E-mail do remetente<input type="email" value={editing.from_email || ''} onChange={(event) => setEditing({ ...editing, from_email: event.target.value })} placeholder="news@seudominio.com.br (domínio verificado no Resend)" /></label>
          <label>Responder para<input type="email" value={editing.reply_to || ''} onChange={(event) => setEditing({ ...editing, reply_to: event.target.value })} placeholder="contato@mugo…" /></label>
          <fieldset className="g-wide g-tags"><legend>Público (vazio = todos os inscritos)</legend>
            {tags.map((tag) => <label key={tag} className="g-chip"><input type="checkbox" checked={(editing.audience?.tags || []).includes(tag)} onChange={(event) => { const current = new Set(editing.audience?.tags || []); if (event.target.checked) current.add(tag); else current.delete(tag); setEditing({ ...editing, audience: { ...editing.audience, tags: [...current] } }) }} />{tag}</label>)}
            {!tags.length && <small>Sem tags ainda.</small>}
            {editing.id && <small><Users size={13} /> {audienceCount ?? '…'} pessoas (salve para recalcular)</small>}
          </fieldset>
          <label className="g-wide">HTML da campanha — {'{{nome}}'} e {'{{descadastro}}'} são preenchidos no envio<textarea rows="14" className="g-code" value={editing.html} onChange={(event) => setEditing({ ...editing, html: event.target.value })} disabled={['sending', 'sent'].includes(editing.status)} /></label>
          <div className="g-wide"><small>Pré-visualização</small><iframe title="Pré-visualização da campanha" className="g-iframe tall" sandbox="" srcDoc={String(editing.html || '').replaceAll('{{nome}}', 'Ana').replaceAll('{{descadastro}}', '#')} /></div>
        </div>
        {editing.status === 'sent' && <div className="g-metrics">{['recipients', 'delivered', 'opened', 'clicked', 'bounced'].map((key) => <article key={key}><b>{editing.stats?.[key] ?? 0}</b><span>{{ recipients: 'destinatários', delivered: 'entregues', opened: 'abriram', clicked: 'clicaram', bounced: 'não entregues' }[key]}</span></article>)}</div>}
        <div className="row-actions">
          <button type="button" className="button secondary" onClick={() => { setEditing(null); load() }}>Voltar</button>
          {!['sending', 'sent'].includes(editing.status) && <button className="button secondary" type="submit" disabled={Boolean(busy)}>Salvar</button>}
          {editing.id && <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => { const emails = window.prompt('Enviar teste para (separe por vírgula):'); if (emails) run('test', async () => { await persist(); return sendCampaignTest(editing.id, emails.split(',').map((item) => item.trim())) }, (r) => `Teste enviado para ${r.sent_to.join(', ')}.`) }}>Enviar teste</button>}
          {editing.id && editing.status === 'draft' && <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => { const when = window.prompt('Agendar para (dd/mm/aaaa hh:mm, horário de Brasília):'); const match = when?.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/); if (match) run('schedule', async () => { await persist(); const saved = await scheduleCampaign(editing.id, new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00`).toISOString()); setEditing({ ...editing, ...saved }) }, 'Campanha agendada.') }}><Clock size={14} /> Agendar</button>}
          {editing.status === 'scheduled' && <button type="button" className="button secondary" onClick={() => run('unschedule', async () => setEditing({ ...editing, ...(await unscheduleCampaign(editing.id)) }), 'Agendamento cancelado.')}>Cancelar agendamento</button>}
          {editing.id && ['draft', 'scheduled'].includes(editing.status) && <button type="button" className="button" disabled={Boolean(busy)} onClick={() => window.confirm(`Enviar agora para ${audienceCount ?? 'todo o público'} pessoas?`) && run('send', async () => { await persist(); await sendCampaignNow(editing.id); await load(); setEditing(null) }, 'Envio iniciado. As métricas aparecem na lista em alguns minutos.')}><Send size={14} /> Enviar agora</button>}
          {editing.status === 'sent' && <button type="button" className="button secondary" onClick={() => run('stats', async () => setEditing({ ...editing, stats: await refreshCampaignStats(editing.id) }))}><RefreshCw size={14} /> Atualizar métricas</button>}
        </div>
      </form>
    </section>}

    {tab === 'contacts' && <section className="dashboard-panel">
      <div className="g-toolbar">
        <label className="g-search"><input placeholder="Buscar e-mail, nome ou tag…" value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} /></label>
        <button className="button secondary small" disabled={Boolean(busy)} onClick={() => run('sync', async () => { const count = await syncContactsFromCrm(); await load(); return count }, (count) => `${count} contatos novos vindos do CRM (clientes, ex-clientes e leads com e-mail).`)}><RefreshCw size={13} /> Importar do CRM</button>
      </div>
      <div className="g-table-wrap"><table className="g-table">
        <thead><tr><th>E-mail</th><th>Nome</th><th>Origem</th><th>Tags</th><th>Situação</th></tr></thead>
        <tbody>{visibleContacts.slice(0, 500).map((contact) => <tr key={contact.id}>
          <td>{contact.email}</td><td>{contact.name || '—'}</td><td>{sourceLabel[contact.source]}</td>
          <td><input className="g-inline" defaultValue={(contact.tags || []).join(', ')} onBlur={(event) => { const next = event.target.value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean); if (next.join() !== (contact.tags || []).join()) run('tags', async () => { await updateEmailContact(contact.id, { tags: next }); await load() }) }} aria-label={`Tags de ${contact.email}`} /></td>
          <td>{contact.subscribed ? 'Inscrito' : `Descadastrado ${dateTime(contact.unsubscribed_at)}`}</td>
        </tr>)}</tbody>
      </table></div>
      {!contacts.length && <p className="empty-state">Base vazia. Clique em “Importar do CRM” para trazer clientes e leads com e-mail.</p>}
      <p className="data-note">Prospects frios não entram aqui: só depois que respondem. Isso protege sua conta no Resend e segue a LGPD.</p>
    </section>}

    {newContact && <div className="modal-overlay"><form className="dashboard-panel g-modal" onSubmit={(event) => { event.preventDefault(); run('add', async () => { await addEmailContact({ email: newContact.email, name: newContact.name || null, tags: newContact.tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean) }); setNewContact(null); await load() }, 'Contato adicionado.') }}>
      <h2>Novo contato</h2>
      <label>E-mail<input type="email" required value={newContact.email} onChange={(event) => setNewContact({ ...newContact, email: event.target.value })} /></label>
      <label>Nome<input value={newContact.name} onChange={(event) => setNewContact({ ...newContact, name: event.target.value })} /></label>
      <label>Tags (separadas por vírgula)<input value={newContact.tags} onChange={(event) => setNewContact({ ...newContact, tags: event.target.value })} placeholder="cliente, evento-out" /></label>
      <p className="data-note">Adicione só quem autorizou receber e-mails da Mugô.</p>
      <div className="row-actions"><button type="button" className="button secondary" onClick={() => setNewContact(null)}>Cancelar</button><button className="button" type="submit">Adicionar</button></div>
    </form></div>}
  </div>
}
