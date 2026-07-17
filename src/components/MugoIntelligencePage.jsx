import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, CalendarClock, ChartNoAxesCombined, CircleDollarSign, HeartPulse, Lightbulb, Radar, Target } from 'lucide-react'
import { AGENCY_GOALS } from '../config/agencyGoals'
import { calculateCommercialPerformance } from '../lib/commercialMetrics'
import { buildForecast } from '../services/intelligence/forecastEngine'
import { buildHealthScore } from '../services/intelligence/healthEngine'
import { buildInsights } from '../services/intelligence/insightsEngine'
import { buildOpportunities } from '../services/intelligence/opportunityEngine'
import { buildRecommendations } from '../services/intelligence/recommendationEngine'
import { buildTimeline } from '../services/intelligence/timelineEngine'
import { buildCausalAnalysis } from '../services/intelligence/causalAnalysisEngine'
import { FeedbackMessage } from './FeedbackMessage'
import { PageHeader } from './PageHeader'
import {getTemporalContext} from '../lib/temporalIntelligence'

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const percent = (value) => `${Number(value || 0).toFixed(1)}%`
const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR') : 'Não informado'
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const contractMonths = (contract) => {
  if (!contract.start_date || !contract.end_date) return 0
  return Math.max(0, (new Date(contract.end_date) - new Date(contract.start_date)) / 86400000 / 30)
}
const group = (rows, key, value) => [...rows.reduce((map, row) => { const label = key(row) || 'Não informado'; map.set(label, (map.get(label) || 0) + value(row)); return map }, new Map())].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount)

function Section({ icon: Icon, eyebrow, title, children, className = '', id }) {
  return <section id={id} className={`intelligence-section ${className}`.trim()}><header><span><Icon size={18} aria-hidden="true" /></span><div><p>{eyebrow}</p><h2>{title}</h2></div></header>{children}</section>
}

function BarList({ rows, format = money }) {
  const max = Math.max(...rows.map((row) => row.amount), 1)
  if (!rows.length) return <p className="intelligence-empty">Sem dados suficientes para este recorte.</p>
  return <div className="intelligence-bars">{rows.slice(0, 7).map((row) => <div key={row.label}><div><span>{row.label}</span><strong>{format(row.amount)}</strong></div><i><b style={{ width: `${Math.max(row.amount / max * 100, 2)}%` }} /></i></div>)}</div>
}

export function MugoIntelligencePage({ data, loading, error, section = 'today', onAskAI }) {
  const [revenueView, setRevenueView] = useState('service')
  const temporal=getTemporalContext()
  const intelligence = useMemo(() => {
    const proposals = data.proposals || []
    const contracts = data.contracts || []
    const clients = data.clients || []
    const active = contracts.filter((contract) => contract.status === 'active' && contract.signed)
    const performance = calculateCommercialPerformance(proposals)
    const mrr = active.reduce((sum, contract) => sum + Number(contract.monthly_value || 0), 0)
    const projectRevenue = contracts.reduce((sum, contract) => sum + Number(contract.setup_value || 0), 0)
    const insights = buildInsights(data)
    const opportunities = buildOpportunities(data)
    const health = buildHealthScore(data, AGENCY_GOALS.monthlyAgencyGoal)
    const forecast = buildForecast(data)
    const timeline = buildTimeline(data)
    const recommendations = buildRecommendations(insights, opportunities)
    const causal = buildCausalAnalysis(data)
    const lifetime = active.reduce((sum, contract) => sum + Number(contract.monthly_value || 0) * contractMonths(contract) + Number(contract.setup_value || 0), 0)
    const summary = [
      ['Receita recorrente', money(mrr)], ['Receita de projetos', money(projectRevenue)], ['Meta', money(AGENCY_GOALS.monthlyAgencyGoal)], ['Falta para meta', money(Math.max(AGENCY_GOALS.monthlyAgencyGoal - mrr, 0))],
      ['Conversão', percent(performance.outcomeConversion)], ['Clientes ativos', clients.filter((client) => client.status === 'active').length], ['Ticket médio', money(active.length ? mrr / active.length : 0)], ['Tempo médio para fechamento', `${performance.averageClosingDays.toFixed(1)} dias`],
      ['Prazo médio de contrato', `${average(active.map(contractMonths).filter(Boolean)).toFixed(1)} meses`], ['MRR', money(mrr)], ['ARR', money(mrr * 12)], ['Lifetime estimado', money(lifetime)],
    ]
    const maps = {
      service: group(active.flatMap((contract) => (contract.contract_services?.length ? contract.contract_services.map((service) => ({ ...contract, service: service.service_name })) : [{ ...contract, service: 'Serviço não informado' }])), (row) => row.service, (row) => Number(row.monthly_value || 0)),
      responsible: group(active, (row) => row.commercialResponsible?.name || row.responsibleName || 'Não definido', (row) => Number(row.monthly_value || 0)),
      client: group(active, (row) => row.clients?.company_name || row.client_name || 'Cliente não informado', (row) => Number(row.monthly_value || 0)),
      period: group(active, (row) => row.start_date ? String(row.start_date).slice(0, 7) : 'Sem período', (row) => Number(row.monthly_value || 0)),
      duration: group(active, (row) => { const months = contractMonths(row); return !months ? 'Prazo não informado' : months <= 3 ? 'Até 3 meses' : months <= 6 ? '4 a 6 meses' : months <= 12 ? '7 a 12 meses' : 'Mais de 12 meses' }, (row) => Number(row.monthly_value || 0)),
    }
    return { summary, insights, opportunities, health, forecast, timeline, recommendations, causal, maps }
  }, [data])

  useEffect(() => {
    const target = document.getElementById(`intelligence-${section}`)
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [section])

  const activeAlerts = (data.alerts || []).filter((item) => !['resolved', 'ignored'].includes(item.status))
  const overdue = activeAlerts.filter((item) => item.rule === 'overdue-installment').length
  const expiring = activeAlerts.filter((item) => item.rule === 'expiring-contract').length
  const atRisk = activeAlerts.filter((item) => ['Clientes', 'Contratos'].includes(item.category)).length

  return <div className="intelligence-page">
    <PageHeader eyebrow="Inteligência comercial" title="Mugô Intelligence" description="Diagnósticos, prioridades e projeções calculados exclusivamente com os dados cadastrados no CRM." />
    {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
    {loading && <p className="intelligence-loading" role="status">Calculando inteligência comercial…</p>}
    <p className="data-scope-note">Número calculado apenas com os dados atualmente cadastrados.</p>

    <Section id="intelligence-today" icon={CalendarClock} eyebrow="Centro de decisão" title="Hoje">
      <p className="central-ai-copy"><strong>{temporal.greeting}.</strong> Hoje encontramos:</p>
      <div className="intelligence-summary"><article><span>Cobranças vencidas</span><strong>{overdue}</strong></article><article><span>Contratos vencendo</span><strong>{expiring}</strong></article><article><span>Clientes em risco</span><strong>{atRisk}</strong></article><article><span>Itens que precisam de atenção</span><strong>{activeAlerts.length}</strong></article></div>
    </Section>

    <Section id="intelligence-cross-analysis" icon={BrainCircuit} eyebrow="Causa, evidência e impacto" title="Análise Cruzada">
      <div className="causal-insight-grid">{intelligence.causal.slice(0,12).map((item)=><article key={item.id}><span>{item.type}</span><h3>{item.statement}</h3><ul>{item.evidence.slice(0,4).map((evidence)=><li key={evidence}>{evidence}</li>)}</ul><small>Fontes: {item.sources.join(' · ')}</small></article>)}{!intelligence.causal.length&&<p className="intelligence-empty">Nenhuma relação causal confiável foi identificada com os dados atuais.</p>}</div>
    </Section>

    <Section icon={ChartNoAxesCombined} eyebrow="Visão consolidada" title="Resumo Executivo">
      <div className="intelligence-summary">{intelligence.summary.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    </Section>

    <div className="intelligence-grid two">
      <Section id="intelligence-insights" icon={Radar} eyebrow="Prioridade automática" title="Insights">
        <div className="insight-list">{intelligence.insights.slice(0, 12).map((item) => <article key={item.id} tabIndex="0"><span className={`severity ${normalize(item.severity)}`}>{item.severity}</span><div><strong>{item.title}</strong><p>{item.description}</p><small>Prioridade {item.score} · impacto {money(item.impact)} · confiança {item.confidence}%</small></div></article>)}{!intelligence.insights.length && <p className="intelligence-empty">Nenhuma atenção identificada com os dados atuais.</p>}</div>
      </Section>
      <Section id="intelligence-recommendations" icon={Lightbulb} eyebrow="Próximas ações consultivas" title="Recomendações">
        <ol className="recommendation-list">{intelligence.recommendations.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.reason}</span></li>)}{!intelligence.recommendations.length && <li>Cadastre mais histórico para gerar recomendações.</li>}</ol>
      </Section>
    </div>

    <Section icon={Target} eyebrow="Receita potencial" title="Oportunidades">
      <div className="opportunity-grid">{intelligence.opportunities.slice(0, 12).map((item) => <article key={item.id}><span>{item.type}</span><h3>{item.client}</h3><strong>{item.service}</strong><p>{item.reason}</p><footer><b>{money(item.estimatedValue)}</b><small>{item.confidence}% de confiança</small></footer></article>)}{!intelligence.opportunities.length && <p className="intelligence-empty">Nenhuma oportunidade determinística identificada.</p>}</div>
    </Section>

    <div className="intelligence-grid two health-forecast-grid">
      <Section id="intelligence-health" icon={HeartPulse} eyebrow="0 a 100" title="Saúde do Negócio" className="health-section">
        <div className="health-score" aria-label={`Saúde comercial ${intelligence.health.score} de 100`}><strong>{intelligence.health.score}</strong><span>/100</span></div>
        <div className="health-components">{intelligence.health.components.map((item) => <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${item.score}%` }} /></i><strong>{item.score}</strong></div>)}</div>
      </Section>
      <Section icon={CircleDollarSign} eyebrow="Contratos cadastrados" title="Receita Futura">
        <div className="forecast-grid">{intelligence.forecast.map((item) => <article key={item.days}><span>{item.days} dias</span><strong>{money(item.total)}</strong><small>Mensalidades {money(item.recurring)}<br />Renovações {money(item.renewals)}</small></article>)}</div>
      </Section>
    </div>

    <Section icon={ChartNoAxesCombined} eyebrow="Composição" title="Mapa de Receita">
      <div className="revenue-tabs" role="tablist" aria-label="Dimensão do mapa de receita">{[['service', 'Serviço'], ['responsible', 'Responsável'], ['client', 'Cliente'], ['period', 'Período'], ['duration', 'Duração contratual']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={revenueView === id} className={revenueView === id ? 'active' : ''} onClick={() => setRevenueView(id)}>{label}</button>)}</div>
      <BarList rows={intelligence.maps[revenueView]} />
    </Section>

    <Section id="intelligence-trends" icon={CalendarClock} eyebrow="Ordem cronológica" title="Tendências">
      <div className="commercial-timeline">{intelligence.timeline.slice(0, 30).map((item) => <article key={item.id}><time dateTime={item.date}>{date(item.date)}</time><span>{item.type}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}{!intelligence.timeline.length && <p className="intelligence-empty">Nenhum evento comercial disponível.</p>}</div>
    </Section>

    <Section id="intelligence-ai" icon={BrainCircuit} eyebrow="Assistência consultiva" title="Pergunte à IA">
      <p className="central-ai-copy">{temporal.greeting}. Agora são {temporal.formattedTime} de {temporal.weekday}. O horário comercial está {temporal.businessStatus}. Use “Pergunte à Mugô” para saber o que resolver hoje, o que vence amanhã, o que é urgente agora e o que pode aguardar. A Central IA não executa alterações.</p>
      <button type="button" className="button" onClick={onAskAI}>Pergunte à IA</button>
    </Section>
  </div>
}
