import { CheckCircle2, CircleDashed, Clock3, XCircle } from 'lucide-react'

const statusConfig = {
  'Proposta enviada': { tone: 'sent', icon: CircleDashed },
  'Em negociação': { tone: 'negotiation', icon: Clock3 },
  Fechada: { tone: 'closed', icon: CheckCircle2 },
  Perdida: { tone: 'lost', icon: XCircle },
}

export function ProposalStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig['Proposta enviada']
  const Icon = config.icon
  return <span className={`status-badge ${config.tone}`}><Icon size={12} aria-hidden="true" />{status || 'Não informado'}</span>
}

export function ContractBadge({ signed }) {
  if (signed === true || ['Sim', 'sim', 'SIM'].includes(signed)) {
    return <span className="contract-badge signed"><CheckCircle2 size={12} aria-hidden="true" />Assinado</span>
  }
  if (signed === false || signed === '' || ['Não', 'nao', 'NÃO'].includes(signed)) {
    return <span className="contract-badge pending"><Clock3 size={12} aria-hidden="true" />Pendente</span>
  }
  return <span className="contract-badge unknown"><CircleDashed size={12} aria-hidden="true" />Não informado</span>
}
