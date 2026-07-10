import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, FileText } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { ContractBadge } from './ProposalStatusBadge'
import { ProposalEmptyState } from './ProposalEmptyState'

const currentTime = Date.now()

function dateInfo(value) {
  if (!value) return { label: 'Não informada', time: null }
  const date = new Date(`${value.toString().slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return { label: 'Data inválida', time: null }
  return { label: date.toLocaleDateString('pt-BR'), time: date.getTime() }
}
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)

export function ContractsPage({ proposals, onEdit }) {
  const contracts = proposals.filter((item) => item.contract_term && item.contract_term !== 'Sem contrato')
  const now = currentTime
  const day = 86400000
  const signed = contracts.filter((item) => item.contract_signed).length
  const pending = contracts.filter((item) => !item.contract_signed).length
  const expiring = contracts.filter((item) => { const end = dateInfo(item.contract_end_date).time; return end && end >= now && end - now <= day * 30 }).length
  const expired = contracts.filter((item) => { const end = dateInfo(item.contract_end_date).time; return end && end < now }).length

  return <section className="contracts-page premium-contracts">
    <PageHeader eyebrow="Contratos" title="Gestão de contratos" description="Acompanhe documentos, períodos e situações contratuais derivados das propostas atuais." />
    <div className="contract-overview">
      <article><FileText size={18} /><span>Contratos</span><strong>{contracts.length}</strong></article>
      <article className="positive"><CheckCircle2 size={18} /><span>Assinados</span><strong>{signed}</strong></article>
      <article className="warning"><CalendarClock size={18} /><span>Pendentes</span><strong>{pending}</strong></article>
      <article className="warning"><CalendarClock size={18} /><span>Vencem em 30 dias</span><strong>{expiring}</strong></article>
      <article className="danger"><AlertTriangle size={18} /><span>Com data vencida</span><strong>{expired}</strong></article>
    </div>
    {!contracts.length ? <ProposalEmptyState title="Nenhum contrato registrado" description="Propostas com prazo diferente de “Sem contrato” aparecerão aqui." /> : <div className="contract-list">
      {contracts.map((proposal) => {
        const start = dateInfo(proposal.contract_start_date)
        const end = dateInfo(proposal.contract_end_date)
        const isExpired = end.time && end.time < now
        const isExpiring = end.time && end.time >= now && end.time - now <= day * 30
        return <article className="contract-row" key={proposal.id}>
          <div className="contract-client"><span>{(proposal.client_name || proposal.company || '?').charAt(0).toUpperCase()}</span><div><strong>{proposal.company || proposal.client_name || 'Cliente não informado'}</strong><small>{proposal.main_service || 'Serviço não informado'}</small></div></div>
          <div><span>Responsável</span><strong>{proposal.responsible || 'Não informado'}</strong></div>
          <div><span>Período</span><strong>{start.label} — {end.label}</strong>{isExpired && <small className="danger-text">Data final vencida</small>}{isExpiring && <small className="warning-text">Próximo do vencimento</small>}</div>
          <div><span>Mensalidade</span><strong>{money(proposal.monthly_value)}</strong></div>
          <ContractBadge signed={proposal.contract_signed} />
          <div className="contract-actions"><button type="button" className="button small secondary" onClick={() => onEdit(proposal)}>Editar</button>{proposal.contract_file_url && <a className="button small" href={proposal.contract_file_url} target="_blank" rel="noreferrer">Contrato<ExternalLink size={12} /></a>}</div>
        </article>
      })}
    </div>}
  </section>
}
