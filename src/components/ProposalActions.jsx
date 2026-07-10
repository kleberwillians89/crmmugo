import { ExternalLink, FileText, MoreHorizontal, Pencil } from 'lucide-react'

export function ProposalActions({ proposal, onEdit }) {
  return <details className="proposal-actions" onClick={(event) => event.stopPropagation()}>
    <summary aria-label={`Ações de ${proposal.client_name || 'proposta'}`}><MoreHorizontal size={18} /></summary>
    <div className="proposal-actions-menu">
      <button type="button" onClick={() => onEdit(proposal)}><Pencil size={14} />Editar</button>
      {proposal.proposal_file_url && <a href={proposal.proposal_file_url} target="_blank" rel="noreferrer"><FileText size={14} />Abrir proposta<ExternalLink size={11} /></a>}
      {proposal.contract_file_url && <a href={proposal.contract_file_url} target="_blank" rel="noreferrer"><FileText size={14} />Abrir contrato<ExternalLink size={11} /></a>}
    </div>
  </details>
}
