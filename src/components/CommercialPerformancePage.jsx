import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'
import { listProposals } from '../services/data/proposalsRepository'
import { calculateCommercialPerformance, filterBySentAt, groupCommercialPerformance, periodRange } from '../lib/commercialMetrics'
import { userError } from '../lib/userError'

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)

export function CommercialPerformancePage() {
  const [items, setItems] = useState([])
  const [period, setPeriod] = useState('month')
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [dimension, setDimension] = useState('responsible')
  const [error, setError] = useState('')
  useEffect(() => { listProposals().then(setItems).catch((reason) => setError(userError(reason))) }, [])
  const data = useMemo(() => filterBySentAt(items, periodRange(period, new Date(), custom)), [items, period, custom])
  const metrics = useMemo(() => calculateCommercialPerformance(data.filtered), [data])
  const grouped = useMemo(() => groupCommercialPerformance(data.filtered, dimension), [data, dimension])
  const stats = [['Propostas enviadas', metrics.sent], ['Valor total proposto', money(metrics.proposedValue)], ['Setup enviado', money(metrics.setupSent)], ['Mensalidade potencial', money(metrics.monthlyPotential)], ['Abertas', metrics.open], ['Em negociação', metrics.negotiating], ['Ganhas', metrics.won], ['Perdidas', metrics.lost], ['Valor ganho', money(metrics.wonValue)], ['Valor perdido', money(metrics.lostValue)], ['Conversão por desfecho', `${metrics.outcomeConversion.toFixed(1)}%`], ['Conversão sobre enviadas', `${metrics.sentConversion.toFixed(1)}%`], ['Ticket médio enviado', money(metrics.averageSent)], ['Ticket médio ganho', money(metrics.averageWon)], ['Tempo médio de fechamento', `${metrics.averageClosingDays.toFixed(1)} dias`], ['Tempo médio até perda', `${metrics.averageLossDays.toFixed(1)} dias`]]
  return <div>
    <PageHeader eyebrow="Inteligência comercial" title="Performance comercial" description="Conversão por data de envio, sem inventar histórico ausente." />
    {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
    <section className="catalog-filters performance-filters">
      <label>Período<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="month">Este mês</option><option value="30">Últimos 30 dias</option><option value="quarter">Trimestre atual</option><option value="year">Ano atual</option><option value="12months">Últimos 12 meses</option><option value="all">Todo período</option><option value="custom">Personalizado</option></select></label>
      {period === 'custom' && <label>Início<input type="date" value={custom.start} onChange={(event) => setCustom({ ...custom, start: event.target.value })} /></label>}
      {period === 'custom' && <label>Fim<input type="date" value={custom.end} onChange={(event) => setCustom({ ...custom, end: event.target.value })} /></label>}
    </section>
    <p className="data-note">{data.withoutDate} registro(s) sem data de envio; {metrics.withoutResponsible} sem responsável.</p>
    <section className="performance-stats">{stats.map(([label, value]) => <article className="business-stat" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="dashboard-panel business-section"><header><div><h2>Conversão por dimensão</h2><p>Enviadas, desfechos e valores disponíveis.</p></div><label>Dimensão<select value={dimension} onChange={(event) => setDimension(event.target.value)}><option value="responsible">Responsável</option><option value="service">Serviço</option><option value="origin">Origem</option><option value="status">Status</option></select></label></header>
      <div className="table-scroll"><table className="report-table"><thead><tr><th>Dimensão</th><th>Enviadas</th><th>Ganhas</th><th>Perdidas</th><th>Abertas</th><th>Proposto</th><th>Ganho</th><th>Conversão</th></tr></thead><tbody>{grouped.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.sent}</td><td>{row.won}</td><td>{row.lost}</td><td>{row.open}</td><td>{money(row.proposedValue)}</td><td>{money(row.wonValue)}</td><td>{row.outcomeConversion.toFixed(1)}%</td></tr>)}{!grouped.length && <tr><td colSpan="8">Nenhuma proposta no período.</td></tr>}</tbody></table></div>
    </section>
  </div>
}
