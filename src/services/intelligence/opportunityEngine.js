import { SERVICE_CATALOG } from '../../config/serviceCatalog'

const DAY = 86400000
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const date = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : null
const catalogService = (pattern) => SERVICE_CATALOG.find((service) => pattern.test(normalize(`${service.name} ${service.category}`)))
const servicesForClient = (clientId, data) => [...(data.contracts || []).filter((contract) => contract.client_id === clientId).flatMap((contract) => contract.contract_services || []), ...(data.proposals || []).filter((proposal) => proposal.client_id === clientId).flatMap((proposal) => proposal.proposal_services || [])].map((service) => normalize(service.service_name || service.name))
const opportunity = (id, type, client, service, reason, confidence) => ({ id, type, clientId: client.id, client: client.company_name || client.trade_name || 'Cliente', service: service?.name || 'Serviço sob diagnóstico', estimatedValue: service?.recommendedPrice || 0, reason, confidence })

export function buildOpportunities(data = {}, now = new Date()) {
  const clients = data.clients || []
  const contracts = data.contracts || []
  const proposals = data.proposals || []
  const opportunities = []
  const media = catalogService(/midia|tráfego|trafego/)
  const ai = catalogService(/agente simples/)

  clients.forEach((client) => {
    const services = servicesForClient(client.id, data).join(' ')
    if (/social|redes sociais/.test(services) && !/midia|trafego/.test(services)) opportunities.push(opportunity(`cross-${client.id}`, 'Cross Sell', client, media, 'Cliente já compra Social e não possui Mídia Paga cadastrada.', 86))
    if (services && !/ia|inteligencia artificial|agente|chatbot/.test(services)) opportunities.push(opportunity(`ai-${client.id}`, 'IA', client, ai, 'Cliente ativo sem serviço de IA identificado no portfólio cadastrado.', 68))
  })

  contracts.forEach((contract) => {
    const client = clients.find((item) => item.id === contract.client_id)
    const end = date(contract.end_date)
    if (!client || !end) return
    const days = Math.ceil((end - now) / DAY)
    if (days <= 90 && normalize(contract.status) === 'active') {
      const current = contract.contract_services?.[0]
      opportunities.push({ id: `renew-${contract.id}`, type: 'Renovação', clientId: client.id, client: client.company_name, service: current?.service_name || 'Renovação contratual', estimatedValue: Number(contract.monthly_value || contract.total_value || 0), reason: days < 0 ? 'Contrato vencido ainda marcado como ativo.' : `Contrato vence em ${days} dias.`, confidence: 95 })
    }
  })

  proposals.filter((proposal) => normalize(proposal.status || proposal.proposal_status) === 'lost').forEach((proposal) => {
    const client = clients.find((item) => item.id === proposal.client_id)
    if (client) opportunities.push({ id: `reactivate-${proposal.id}`, type: 'Reativação', clientId: client.id, client: client.company_name, service: proposal.title || proposal.proposal_services?.[0]?.service_name || 'Novo projeto', estimatedValue: Number(proposal.total_value || proposal.setup_value || 0), reason: 'Proposta perdida disponível para nova abordagem consultiva.', confidence: 62 })
  })

  return opportunities.sort((a, b) => b.confidence - a.confidence || b.estimatedValue - a.estimatedValue)
}
