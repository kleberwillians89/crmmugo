import { ArrowUpRight, Award, BarChart3, CalendarDays, Clock3, FileText, Users } from 'lucide-react'
import { useState } from 'react'

function formatCurrency(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(number)
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function countBy(list, field) {
  return list.reduce((acc, item) => {
    const key = item[field] || 'Sem categoria'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

export function Dashboard({ proposals }) {
  const [connStatus, setConnStatus] = useState('')

  async function testConnection() {
    const API_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL
    console.log('API URL:', API_URL)
    if (!API_URL) {
      setConnStatus('❌ VITE_GOOGLE_SCRIPT_URL não configurado')
      return
    }

    setConnStatus('...testando')
    try {
      const res = await fetch(API_URL, { method: 'GET' })
      const body = await res.json()
      console.log('Resposta teste conexão:', body)
      const count = Array.isArray(body.data) ? body.data.length : 0
      console.log('Registros encontrados:', count)
      if (res.ok && body && body.success) {
        setConnStatus('✅ Conectado ao Google Sheets (' + count + ' registros)')
      } else {
        setConnStatus('❌ Erro de conexão')
      }
    } catch (err) {
      console.error('Erro teste conexão:', err)
      setConnStatus('❌ Erro de conexão: ' + (err.message || err))
    }
  }
  const totalCount = proposals.length
  const closedProposals = proposals.filter((item) => item.proposal_status === 'Fechada')
  const lostProposals = proposals.filter((item) => item.proposal_status === 'Perdida')
  const signedContracts = proposals.filter((item) => item.contract_signed).length
  const pendingContracts = proposals.filter(
    (item) => !item.contract_signed && item.proposal_status !== 'Perdida',
  ).length

  const totalSent = proposals.reduce(
    (sum, item) => sum + (Number(item.setup_value) || 0) + (Number(item.monthly_value) || 0),
    0,
  )
  const totalClosed = closedProposals.reduce(
    (sum, item) => sum + (Number(item.setup_value) || 0) + (Number(item.monthly_value) || 0),
    0,
  )
  const totalLost = lostProposals.reduce(
    (sum, item) => sum + (Number(item.setup_value) || 0) + (Number(item.monthly_value) || 0),
    0,
  )
  const conversionRate = totalCount ? Math.round((closedProposals.length / totalCount) * 100) : 0
  const averageTicket = closedProposals.length
    ? totalClosed / closedProposals.length
    : 0
  const monthlyRecurring = proposals.reduce(
    (sum, item) => sum + (item.proposal_status === 'Fechada' ? Number(item.monthly_value) || 0 : 0),
    0,
  )

  const serviceMap = countBy(proposals, 'main_service')
  const serviceList = Object.entries(serviceMap).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const responsibleMap = countBy(proposals, 'responsible')
  const responsibleList = Object.entries(responsibleMap).sort((a, b) => b[1] - a[1]).slice(0, 6)

  const recentProposals = [...proposals]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)

  const expiringContracts = [...proposals]
    .filter((item) => item.contract_end_date)
    .filter((item) => {
      const end = new Date(item.contract_end_date)
      const now = new Date()
      const diff = (end - now) / (1000 * 60 * 60 * 24)
      return diff >= 0 && diff <= 30
    })
    .sort((a, b) => new Date(a.contract_end_date) - new Date(b.contract_end_date))
    .slice(0, 5)

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Visão comercial Mugô</h1>
          <p className="page-description">
            Acompanhe as propostas, status de contratos e resultados comerciais.
          </p>
        </div>
        <div>
          <button type="button" className="button small" onClick={testConnection}>
            Testar Conexão
          </button>
          <div style={{ marginTop: 8, color: '#334155' }}>{connStatus}</div>
        </div>
      </div>

      <div className="cards-grid">
        <article className="card card-highlight">
          <div>
            <span>Total enviado</span>
            <strong>{formatCurrency(totalSent)}</strong>
          </div>
          <FileText size={20} />
        </article>
        <article className="card">
          <div>
            <span>Fechadas</span>
            <strong>{formatCurrency(totalClosed)}</strong>
          </div>
          <Award size={20} />
        </article>
        <article className="card">
          <div>
            <span>Perdidas</span>
            <strong>{formatCurrency(totalLost)}</strong>
          </div>
          <Clock3 size={20} />
        </article>
        <article className="card">
          <div>
            <span>Conversão</span>
            <strong>{conversionRate}%</strong>
          </div>
          <BarChart3 size={20} />
        </article>
        <article className="card">
          <div>
            <span>Ticket médio</span>
            <strong>{formatCurrency(averageTicket)}</strong>
          </div>
          <ArrowUpRight size={20} />
        </article>
        <article className="card">
          <div>
            <span>Receita recorrente</span>
            <strong>{formatCurrency(monthlyRecurring)}</strong>
          </div>
          <Users size={20} />
        </article>
        <article className="card">
          <div>
            <span>Contratos assinados</span>
            <strong>{signedContracts}</strong>
          </div>
          <Award size={20} />
        </article>
        <article className="card">
          <div>
            <span>Contratos pendentes</span>
            <strong>{pendingContracts}</strong>
          </div>
          <CalendarDays size={20} />
        </article>
      </div>

      <section className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="panel-header">
            <h2>Serviços mais vendidos</h2>
          </div>
          <ul className="stat-list">
            {serviceList.map(([service, count]) => (
              <li key={service}>
                <span>{service}</span>
                <strong>{count}x</strong>
              </li>
            ))}
            {!serviceList.length && <li className="empty-state">Nenhuma proposta registrada.</li>}
          </ul>
        </div>

        <div className="dashboard-panel">
          <div className="panel-header">
            <h2>Responsáveis</h2>
          </div>
          <ul className="stat-list">
            {responsibleList.map(([responsible, count]) => (
              <li key={responsible}>
                <span>{responsible}</span>
                <strong>{count}x</strong>
              </li>
            ))}
            {!responsibleList.length && <li className="empty-state">Nenhum responsável selecionado.</li>}
          </ul>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-panel wide-panel">
          <div className="panel-header">
            <h2>Propostas recentes</h2>
          </div>
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Status</th>
                  <th>Responsável</th>
                  <th>Envio</th>
                </tr>
              </thead>
              <tbody>
                {recentProposals.map((proposal) => (
                  <tr key={proposal.id}>
                    <td>{proposal.client_name}</td>
                    <td>{proposal.proposal_status}</td>
                    <td>{proposal.responsible}</td>
                    <td>{formatDate(proposal.proposal_sent_date)}</td>
                  </tr>
                ))}
                {!recentProposals.length && (
                  <tr>
                    <td colSpan="4" className="empty-state">Nenhuma proposta recente.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dashboard-panel wide-panel">
          <div className="panel-header">
            <h2>Contratos vencendo</h2>
          </div>
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Prazo</th>
                  <th>Termina</th>
                  <th>Assinado</th>
                </tr>
              </thead>
              <tbody>
                {expiringContracts.map((proposal) => (
                  <tr key={proposal.id}>
                    <td>{proposal.client_name}</td>
                    <td>{proposal.contract_term}</td>
                    <td>{formatDate(proposal.contract_end_date)}</td>
                    <td>{proposal.contract_signed ? 'Sim' : 'Não'}</td>
                  </tr>
                ))}
                {!expiringContracts.length && (
                  <tr>
                    <td colSpan="4" className="empty-state">Nenhum contrato vencendo nos próximos 30 dias.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
