import { useEffect, useState } from 'react'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'
import { PixPaymentPanel } from './PixPaymentPanel'
import { useAuth } from '../contexts/AuthContext'
import { dataProvider } from '../lib/supabase/client'
import { getOrganizationSettings, updateOrganizationSettings } from '../services/data/settingsRepository'
import { userError } from '../lib/userError'

export function OrganizationSettingsPage() {
  const { isAdmin } = useAuth()
  const [form, setForm] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (dataProvider === 'supabase') getOrganizationSettings().then(setForm).catch((error) => setMessage(userError(error, 'Não foi possível carregar as configurações.')))
  }, [])

  async function submit(event) {
    event.preventDefault()
    try {
      setForm(await updateOrganizationSettings(form))
      setMessage('Configurações atualizadas.')
    } catch (error) {
      setMessage(userError(error))
    }
  }

  return <div><PageHeader eyebrow="Administração" title="Configurações da empresa" description="Dados institucionais e PIX armazenados em organization_settings." />{dataProvider === 'legacy' && <FeedbackMessage type="info">Disponível após ativação da nova base de dados.</FeedbackMessage>}{message && <FeedbackMessage type={message.includes('atualizadas') ? 'success' : 'error'}>{message}</FeedbackMessage>}{form && <><form className="dashboard-panel settings-form" onSubmit={submit} aria-readonly={!isAdmin}><section className="settings-section"><h2>Dados para cobrança</h2><div className="form-grid">{[['company_name', 'Empresa'], ['bank_name', 'Banco'], ['pix_key_type', 'Tipo da chave PIX'], ['pix_key', 'Chave PIX'], ['legal_name', 'Titular']].map(([key, label]) => <label key={key}>{label}<input value={form[key] || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div></section><section className="settings-section"><h2>Outras configurações</h2><div className="form-grid">{[['document_number', 'Documento'], ['billing_email', 'E-mail financeiro'], ['whatsapp_number', 'WhatsApp'], ['whatsapp_provider', 'Provider WhatsApp'], ['currency', 'Moeda'], ['timezone', 'Fuso horário']].map(([key, label]) => <label key={key}>{label}<input value={form[key] || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div></section>{isAdmin && <button className="button">Salvar configurações</button>}</form><PixPaymentPanel pixKey={form.pix_key} bankName={form.bank_name} holder={form.legal_name} /></>}</div>
}
