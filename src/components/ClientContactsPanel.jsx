import { useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'
import { formatWhatsAppPhone } from '../lib/whatsapp'
import { userError } from '../lib/userError'
import { createClientContact, removeClientContact, setPrimaryClientContact, updateClientContact } from '../services/data/clientContactsRepository'

const blank = { name: '', phone: '', role: '', email: '' }

// Vários contatos por cliente; o principal é o sugerido na cobrança e espelhado no cadastro.
export function ClientContactsPanel({ clientId, contacts, canWrite, onChanged }) {
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action) {
    setBusy(true); setError('')
    try { await action(); await onChanged?.() } catch (cause) { setError(userError(cause, cause?.message || 'Não foi possível salvar o contato.')) } finally { setBusy(false) }
  }
  function startEdit(contact) { setEditing(contact.id); setForm({ name: contact.name || '', phone: contact.phone || '', role: contact.role || '', email: contact.email || '' }) }
  function cancel() { setEditing(null); setForm(blank) }
  function save(event) {
    event.preventDefault()
    run(async () => {
      if (editing) await updateClientContact(editing, form)
      else await createClientContact(clientId, { ...form, is_primary: contacts.length === 0 })
      cancel()
    })
  }

  return <section className="dashboard-panel client-section">
    <h2>Contatos e WhatsApp</h2>
    <p className="data-note">O contato principal é o sugerido na cobrança. Com mais de um número, você escolhe na hora de enviar.</p>
    {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
    <div className="table-scroll">
      <table className="report-table">
        <thead><tr><th>Contato</th><th>WhatsApp</th><th>Função</th><th>Principal</th>{canWrite && <th>Ações</th>}</tr></thead>
        <tbody>
          {contacts.map((contact) => <tr key={contact.id}>
            <td>{contact.name}</td>
            <td>{contact.phone ? (formatWhatsAppPhone(contact.phone) || contact.phone) : 'Sem número'}</td>
            <td>{contact.role || '—'}</td>
            <td>{contact.is_primary ? '✓' : (canWrite ? <button className="button secondary small" disabled={busy} onClick={() => run(() => setPrimaryClientContact(contact.id))}>Tornar principal</button> : '')}</td>
            {canWrite && <td className="table-actions">
              <button className="button secondary small" disabled={busy} onClick={() => startEdit(contact)}>Editar</button>
              <button className="button secondary small" disabled={busy} onClick={() => { if (window.confirm(`Remover ${contact.name}?`)) run(() => removeClientContact(contact.id)) }}>Remover</button>
            </td>}
          </tr>)}
          {!contacts.length && <tr><td colSpan={canWrite ? 5 : 4}>Nenhum contato cadastrado.</td></tr>}
        </tbody>
      </table>
    </div>
    {canWrite && <form className="client-contact-form" onSubmit={save}>
      <label>Nome<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>WhatsApp<input placeholder="11 99999-9999 ou +34 600 000 000" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
      <label>Função<input placeholder="Financeiro, sócio…" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} /></label>
      <label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <div className="table-actions">
        <button className="button small" disabled={busy}>{editing ? 'Salvar contato' : 'Adicionar contato'}</button>
        {editing && <button type="button" className="button secondary small" onClick={cancel}>Cancelar</button>}
      </div>
    </form>}
  </section>
}
