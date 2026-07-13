const DAY = 86400000
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const parseDate = (value) => { if (!value) return null; const date = new Date(`${String(value).slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? null : date }
const moneyValue = (record) => Number(record?.monthly_value || record?.total_value || record?.setup_value || 0)
const openProposal = (proposal) => !['won', 'lost', 'cancelled', 'fechada', 'perdida'].includes(normalize(proposal.status || proposal.proposal_status))
const validPhone = (phone) => String(phone || '').replace(/\D/g, '').length >= 10
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))

const severityWeight = { Alta: 30, Média: 18, Baixa: 8 }
const makeInsight = ({ id, title, description, severity, impact = 0, urgency = 0, effort = 2, confidence = 100, count = 1, clientId = null }) => ({
  id, title, description, severity, impact, urgency, effort, confidence, count, clientId,
  score: Math.round(severityWeight[severity] + Math.min(impact / 500, 30) + urgency * 3 + confidence / 10 - effort * 2),
})

export function buildInsights(data = {}, now = new Date()) {
  const proposals = data.proposals || []
  const contracts = data.contracts || []
  const clients = data.clients || []
  const documents = data.documents || []
  const events = data.events || []
  const insights = []

  proposals.filter(openProposal).forEach((proposal) => {
    const sent = parseDate(proposal.sent_at || proposal.proposal_sent_date || proposal.created_at)
    const days = sent ? Math.floor((now - sent) / DAY) : 0
    if (days >= 7) insights.push(makeInsight({ id: `proposal-${proposal.id}`, title: 'Proposta esquecida', description: `${proposal.title || proposal.clients?.company_name || proposal.client_name || 'Proposta'} está aberta há ${days} dias.`, severity: days >= 30 ? 'Alta' : 'Média', impact: moneyValue(proposal), urgency: Math.min(Math.floor(days / 7), 10), confidence: 100, clientId: proposal.client_id }))
  })

  contracts.forEach((contract) => {
    const end = parseDate(contract.end_date || contract.contract_end_date)
    if (!end || !['active', 'fechada'].includes(normalize(contract.status || contract.proposal_status))) return
    const days = Math.ceil((end - now) / DAY)
    if (days <= 60) insights.push(makeInsight({ id: `contract-${contract.id}`, title: days < 0 ? 'Contrato vencido marcado como ativo' : 'Contrato vencendo', description: `${contract.clients?.company_name || contract.client_name || contract.contract_number || 'Contrato'} ${days < 0 ? `venceu há ${Math.abs(days)} dias` : `vence em ${days} dias`}.`, severity: days <= 15 ? 'Alta' : 'Média', impact: moneyValue(contract), urgency: days < 0 ? 10 : Math.max(1, 10 - Math.floor(days / 7)), confidence: 100, clientId: contract.client_id }))
  })

  const activeContractsByClient = new Map()
  contracts.filter((contract) => normalize(contract.status || contract.proposal_status) === 'active').forEach((contract) => activeContractsByClient.set(contract.client_id, (activeContractsByClient.get(contract.client_id) || []).concat(contract)))
  clients.forEach((client) => {
    const name = client.company_name || client.trade_name || 'Cliente sem nome'
    const clientContracts = activeContractsByClient.get(client.id) || []
    const lastEvent = events.filter((event) => event.client_id === client.id).map((event) => parseDate(event.created_at)).filter(Boolean).sort((a, b) => b - a)[0]
    if (!lastEvent || (now - lastEvent) / DAY >= 30) insights.push(makeInsight({ id: `contact-${client.id}`, title: 'Cliente sem contato recente', description: lastEvent ? `${name} está sem evento comercial há ${Math.floor((now - lastEvent) / DAY)} dias.` : `${name} não possui contato registrado na timeline.`, severity: 'Média', urgency: 5, confidence: 85, clientId: client.id }))
    if (!clientContracts.length) insights.push(makeInsight({ id: `no-contract-${client.id}`, title: 'Cliente sem contrato ativo', description: `${name} não possui contrato ativo cadastrado.`, severity: 'Média', urgency: 4, confidence: 100, clientId: client.id }))
    if (clientContracts.length && !clientContracts.some((contract) => Number(contract.monthly_value) > 0)) insights.push(makeInsight({ id: `no-monthly-${client.id}`, title: 'Cliente sem mensalidade', description: `${name} possui contrato ativo sem receita mensal registrada.`, severity: 'Alta', urgency: 7, confidence: 100, clientId: client.id }))
    const responsible = proposals.find((proposal) => proposal.client_id === client.id)?.responsible
    if (!responsible) insights.push(makeInsight({ id: `no-owner-${client.id}`, title: 'Cliente sem responsável', description: `${name} não possui responsável comercial identificado.`, severity: 'Média', urgency: 6, confidence: 95, clientId: client.id }))
    if (!validPhone(client.phone)) insights.push(makeInsight({ id: `phone-${client.id}`, title: 'Telefone inválido', description: `${name} não possui telefone válido para contato.`, severity: 'Baixa', urgency: 3, confidence: 100, clientId: client.id }))
    if (!validEmail(client.email)) insights.push(makeInsight({ id: `email-${client.id}`, title: 'Cliente sem e-mail válido', description: `${name} não possui e-mail válido cadastrado.`, severity: 'Baixa', urgency: 2, confidence: 100, clientId: client.id }))
  })

  const identityGroups = new Map()
  clients.forEach((client) => {
    const key = normalize(client.document_number || client.email || client.company_name)
    if (key) identityGroups.set(key, (identityGroups.get(key) || []).concat(client))
  })
  ;[...identityGroups.values()].filter((group) => group.length > 1).forEach((group, index) => insights.push(makeInsight({ id: `duplicate-${index}`, title: 'Possível cliente duplicado', description: `${group.length} cadastros compartilham nome, documento ou e-mail.`, severity: 'Alta', urgency: 7, confidence: group[0].document_number ? 100 : 80, count: group.length })))

  contracts.filter((contract) => contract.signed && !documents.some((document) => document.contract_id === contract.id && document.document_type === 'signed_contract')).forEach((contract) => insights.push(makeInsight({ id: `document-${contract.id}`, title: 'Documento pendente', description: `${contract.contract_number || contract.clients?.company_name || 'Contrato'} está assinado sem documento associado.`, severity: 'Alta', impact: moneyValue(contract), urgency: 7, confidence: 100, clientId: contract.client_id })))

  return insights.sort((a, b) => b.score - a.score || b.impact - a.impact)
}
