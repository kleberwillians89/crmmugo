import { calculateCommercialPerformance } from '../../lib/commercialMetrics'

const percent = (value) => Math.max(0, Math.min(100, Math.round(value)))
export function buildHealthScore(data = {}, goal = 0) {
  const proposals = data.proposals || []
  const contracts = data.contracts || []
  const clients = data.clients || []
  const installments = data.installments || []
  const documents = data.documents || []
  const performance = calculateCommercialPerformance(proposals)
  const active = contracts.filter((contract) => contract.status === 'active' && contract.signed)
  const mrr = active.reduce((sum, contract) => sum + Number(contract.monthly_value || 0), 0)
  const dueRenewals = active.filter((contract) => contract.end_date && new Date(contract.end_date) <= new Date(Date.now() + 60 * 86400000))
  const components = [
    { label: 'Receita', score: goal ? percent(mrr / goal * 100) : 0 },
    { label: 'Conversão', score: percent(performance.outcomeConversion) },
    { label: 'Renovações', score: dueRenewals.length ? percent(dueRenewals.filter((contract) => contract.auto_renew).length / dueRenewals.length * 100) : 100 },
    { label: 'Clientes ativos', score: clients.length ? percent(clients.filter((client) => client.status === 'active').length / clients.length * 100) : 0 },
    { label: 'MRR', score: active.length ? percent(active.filter((contract) => Number(contract.monthly_value) > 0).length / active.length * 100) : 0 },
    { label: 'Contratos', score: contracts.length ? percent(active.length / contracts.length * 100) : 0 },
    { label: 'Documentação', score: active.length ? percent(active.filter((contract) => documents.some((document) => document.contract_id === contract.id)).length / active.length * 100) : 0 },
    { label: 'Financeiro', score: installments.length ? percent(installments.filter((item) => item.status !== 'overdue').length / installments.length * 100) : 100 },
  ]
  return { score: Math.round(components.reduce((sum, item) => sum + item.score, 0) / components.length), components }
}
