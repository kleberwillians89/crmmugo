import { ArrowUpRight, Award, BarChart3, CalendarDays, Clock3, FileText, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { MetricCard } from './MetricCard'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'

function formatCurrency(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(number)
}

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function formatDate(value) {
  if (!value) return 'Não informada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Não informada'
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function RankingBars({ items, emptyMessage }) {
  const maximum = Math.max(...items.map(([, count]) => count), 0)

  if (!items.length) return <div className="panel-empty">{emptyMessage}</div>

  return (
    <ol className="ranking-bars">
      {items.map(([label, count]) => (
        <li key={label}>
          <div className="ranking-label">
            <span title={label}>{label}</span>
            <strong>{count}</strong>
          </div>
          <div className="ranking-track" aria-label={`${label}: ${count}`}>
            <span style={{ width: `${maximum ? (count / maximum) * 100 : 0}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function countBy(list, field) {
  return list.reduce((acc, item) => {
    const key = item[field] || (field === 'responsible' ? 'Não informado' : 'Serviço não informado')
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
  const totalSentProposals = proposals.filter((item) => item)
  const closedProposals = proposals.filter((item) =>
    ['Fechada', 'Aprovado', 'Contrato assinado', 'Projeto iniciado'].includes(item.proposal_status),
  )
  const lostProposals = proposals.filter((item) => item.proposal_status === 'Perdida')
  const signedContracts = proposals.filter(
    (item) =>
      item.contract_signed === true ||
      item.contract_signed === 'Sim' ||
      item.contract_signed === 'sim' ||
      item.contract_signed === 'SIM',
  ).length
  const pendingContracts = proposals.filter(
    (item) =>
      item.proposal_status !== 'Perdida' &&
      (item.contract_signed === false ||
        item.contract_signed === '' ||
        item.contract_signed === 'Não' ||
        item.contract_signed === 'nao' ||
        item.contract_signed === 'NÃO'),
  ).length
  const recurringProposals = proposals.filter(
    (item) =>
      Number(item.monthly_value) > 0 &&
      (item.contract_signed === true ||
        item.contract_signed === 'Sim' ||
        item.contract_signed === 'sim' ||
        item.contract_signed === 'SIM') &&
      ['Fechada', 'Aprovado', 'Contrato assinado', 'Projeto iniciado'].includes(item.proposal_status),
  )

  const totalSent = proposals.reduce(
    (sum, item) => sum + safeNumber(item.setup_value) + safeNumber(item.monthly_value),
    0,
  )
  const totalClosed = closedProposals.reduce(
    (sum, item) => sum + safeNumber(item.setup_value) + safeNumber(item.monthly_value),
    0,
  )
  const totalLost = lostProposals.reduce(
    (sum, item) => sum + safeNumber(item.setup_value) + safeNumber(item.monthly_value),
    0,
  )
  const conversionRate = totalCount ? Math.round((closedProposals.length / totalCount) * 100) : 0
  const averageTicket = closedProposals.length
    ? totalClosed / closedProposals.length
    : 0
  const monthlyRecurring = recurringProposals.reduce(
    (sum, item) => sum + safeNumber(item.monthly_value),
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
      <PageHeader
        eyebrow="Visão geral"
        title="Visão comercial Mugô"
        description="Acompanhe as propostas, status de contratos e resultados comerciais."
        actions={
          <div className="connection-action">
          <button type="button" className="button small" onClick={testConnection}>
            Testar Conexão
          </button>
          {connStatus && <FeedbackMessage type={connStatus.startsWith('❌') ? 'error' : 'success'}>{connStatus}</FeedbackMessage>}
          </div>
        }
      />

      <section className="revenue-hero" aria-labelledby="recurring-revenue-title">
        <div className="revenue-hero-copy">
          <span className="revenue-label" id="recurring-revenue-title">Receita recorrente mensal</span>
          <strong>{formatCurrency(monthlyRecurring)}</strong>
          <p>Receita mensal de propostas fechadas com contrato assinado.</p>
        </div>
        <div className="revenue-hero-meta">
          <div className="revenue-icon"><RefreshCw size={20} aria-hidden="true" /></div>
          <span>{recurringProposals.length}</span>
          <small>{recurringProposals.length === 1 ? 'contrato recorrente' : 'contratos recorrentes'}</small>
        </div>
      </section>

      <div className="cards-grid dashboard-kpis">
        <MetricCard
          title="Total enviado"
          value={formatCurrency(totalSent)}
          icon={FileText}
          items={totalSentProposals.map((item) => ({
            ...item,
            status: item.proposal_status,
            value: safeNumber(item.setup_value) + safeNumber(item.monthly_value),
          }))}
          itemValueKey="value"
          tone="brand"
        />
        <MetricCard
          title="Fechadas"
          value={formatCurrency(totalClosed)}
          icon={Award}
          items={closedProposals.map((item) => ({
            ...item,
            status: item.proposal_status,
            value: safeNumber(item.setup_value) + safeNumber(item.monthly_value),
          }))}
          itemValueKey="value"
        />
        <MetricCard
          title="Perdidas"
          value={formatCurrency(totalLost)}
          icon={Clock3}
          items={lostProposals.map((item) => ({
            ...item,
            status: item.proposal_status,
            value: safeNumber(item.setup_value) + safeNumber(item.monthly_value),
          }))}
          itemValueKey="value"
          tone="danger"
        />
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
        <MetricCard
          title="Contratos assinados"
          value={signedContracts}
          icon={Award}
          items={proposals
            .filter(
              (item) =>
                item.contract_signed === true ||
                item.contract_signed === 'Sim' ||
                item.contract_signed === 'sim' ||
                item.contract_signed === 'SIM',
            )
            .map((item) => ({
              ...item,
              status: item.proposal_status,
              value: safeNumber(item.monthly_value),
            }))}
          itemValueKey="value"
        />
        <MetricCard
          title="Contratos pendentes"
          value={pendingContracts}
          icon={CalendarDays}
          items={proposals
            .filter(
              (item) =>
                item.proposal_status !== 'Perdida' &&
                (item.contract_signed === false ||
                  item.contract_signed === '' ||
                  item.contract_signed === 'Não' ||
                  item.contract_signed === 'nao' ||
                  item.contract_signed === 'NÃO'),
            )
            .map((item) => ({
              ...item,
              status: item.proposal_status,
              value: safeNumber(item.monthly_value),
            }))}
          itemValueKey="value"
        />
      </div>

      <section className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="panel-header">
            <h2>Serviços mais vendidos</h2>
          </div>
          <RankingBars items={serviceList} emptyMessage="Nenhuma proposta registrada." />
        </div>

        <div className="dashboard-panel">
          <div className="panel-header">
            <h2>Responsáveis</h2>
          </div>
          <RankingBars items={responsibleList} emptyMessage="Nenhum responsável selecionado." />
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
                    <td>{proposal.client_name || 'Cliente não informado'}</td>
                    <td>{proposal.proposal_status || 'Sem status'}</td>
                    <td>{proposal.responsible || 'Não informado'}</td>
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
                    <td>{proposal.client_name || 'Cliente não informado'}</td>
                    <td>{proposal.contract_term || 'Não informado'}</td>
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
