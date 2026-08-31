/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import { getWhatsAppSystemHealth } from '../services/data/whatsappRepository'
import { CONNECTION_STATES, connectionLabel, deriveConnectionState } from '../services/whatsapp/connectionState'
import { FeedbackMessage } from './FeedbackMessage'

const checks = [
  ['edge_function', 'WhatsApp API (edge function)'],
  ['supabase', 'Banco de dados'],
  ['mugozap_backend', 'Backend MugoZap'],
  ['meta_configured', 'Credenciais da Meta'],
  ['whatsapp_connection_found', 'Conexão WhatsApp registrada'],
]

const badgeClass = {
  [CONNECTION_STATES.CONNECTED]: 'connected',
  [CONNECTION_STATES.DEGRADED]: 'unstable',
  [CONNECTION_STATES.DISCONNECTED]: 'auth-error',
  [CONNECTION_STATES.SETUP_REQUIRED]: 'initializing',
  [CONNECTION_STATES.UNKNOWN]: 'initializing',
}

export function WhatsAppSystemStatusPanel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      setData(await getWhatsAppSystemHealth({ force: true }))
      setError('')
    } catch (cause) {
      setData(cause?.details || { code: cause?.code, message: cause?.message })
      setError(cause.message || 'Não foi possível consultar o diagnóstico.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const derived = deriveConnectionState(data)

  return (
    <section className="dashboard-panel">
      <header className="templates-header">
        <div>
          <span>Diagnóstico sanitizado</span>
          <h2>Status do sistema</h2>
          <p>Estado real da integração, sem exibir credenciais.</p>
        </div>
        <button className="button secondary" onClick={load} disabled={loading}>
          {loading ? 'Verificando…' : 'Atualizar'}
        </button>
      </header>

      <div className={`whatsapp-status-badge ${badgeClass[derived.state]}`} style={{ display: 'inline-flex', marginBottom: 10 }}>
        {loading ? 'Verificando…' : connectionLabel(derived.state)}
      </div>

      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}

      {derived.reasons.length > 0 && (
        <FeedbackMessage type={derived.state === CONNECTION_STATES.CONNECTED ? 'info' : 'warning'}>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {derived.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
          </ul>
        </FeedbackMessage>
      )}

      <div className="health-grid">
        {checks.map(([key, label]) => {
          const value = data?.[key]
          const status = value === true || value === 'online'
            ? 'online'
            : value === false || value === 'unavailable'
              ? 'indisponível'
              : value == null
                ? (loading ? 'verificando' : 'sem dado')
                : String(value)
          return (
            <article key={key}>
              <span>{label}</span>
              <strong>{status}</strong>
            </article>
          )
        })}
        {data?.last_template_sync && (
          <article>
            <span>Última sincronização de templates</span>
            <strong>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(data.last_template_sync))}</strong>
          </article>
        )}
        {data?.pending_projection_events != null && (
          <article>
            <span>Eventos de projeção pendentes</span>
            <strong>{data.pending_projection_events}</strong>
          </article>
        )}
      </div>
    </section>
  )
}
