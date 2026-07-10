import { useEffect, useRef } from 'react'
import { ExternalLink, Pencil, X } from 'lucide-react'
import { ContractBadge, ProposalStatusBadge } from './ProposalStatusBadge'

const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)

export function ProposalDetailsPanel({ proposal, onClose, onEdit }) {
  const closeRef = useRef(null)
  useEffect(() => {
    if (!proposal) return undefined
    const previous = document.activeElement
    closeRef.current?.focus()
    const escape = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape); previous?.focus?.() }
  }, [proposal, onClose])
  if (!proposal) return null

  const details = [
    ['Cliente', proposal.client_name], ['Empresa', proposal.company], ['Telefone', proposal.phone], ['E-mail', proposal.email],
    ['Serviço', proposal.main_service], ['Responsável', proposal.responsible], ['Origem', proposal.origin], ['Prazo', proposal.contract_term],
    ['Data de envio', proposal.proposal_sent_date], ['Observações', proposal.notes], ['Tags', proposal.tags],
  ]
  return <div className="details-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <aside className="proposal-details" role="dialog" aria-modal="true" aria-labelledby="proposal-details-title">
      <header><div><p>Detalhes da oportunidade</p><h2 id="proposal-details-title">{proposal.client_name || proposal.company || 'Proposta'}</h2></div><button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Fechar detalhes"><X size={19} /></button></header>
      <div className="details-badges"><ProposalStatusBadge status={proposal.proposal_status} /><ContractBadge signed={proposal.contract_signed} /></div>
      <section className="details-values"><div><span>Implantação</span><strong>{currency(proposal.setup_value)}</strong></div><div><span>Mensalidade</span><strong>{currency(proposal.monthly_value)}</strong></div></section>
      <dl className="details-list">{details.map(([label, value]) => <div key={label} className={label === 'Observações' ? 'detail-wide' : ''}><dt>{label}</dt><dd>{value || 'Não informado'}</dd></div>)}</dl>
      <footer><button type="button" className="button" onClick={() => onEdit(proposal)}><Pencil size={14} />Editar</button>{proposal.proposal_file_url && <a className="button secondary" href={proposal.proposal_file_url} target="_blank" rel="noreferrer">Abrir proposta<ExternalLink size={13} /></a>}{proposal.contract_file_url && <a className="button secondary" href={proposal.contract_file_url} target="_blank" rel="noreferrer">Abrir contrato<ExternalLink size={13} /></a>}</footer>
    </aside>
  </div>
}
