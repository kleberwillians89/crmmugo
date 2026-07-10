import { ContractBadge } from './ProposalStatusBadge'
import { ProposalActions } from './ProposalActions'
import { ProposalEmptyState } from './ProposalEmptyState'

const statuses = ['Proposta enviada', 'Em negociação', 'Fechada', 'Perdida']
const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const proposalValue = (item) => (Number(item.setup_value) || 0) + (Number(item.monthly_value) || 0)

export function ProposalPipelineView({ proposals, onEdit, onSelect, onQuickUpdate }) {
  return <div className="pipeline-scroll"><div className="proposal-pipeline">
    {statuses.map((status) => {
      const items = proposals.filter((proposal) => proposal.proposal_status === status)
      const total = items.reduce((sum, item) => sum + proposalValue(item), 0)
      return <section className={`pipeline-column pipeline-${status.toLowerCase().replaceAll(' ', '-')}`} key={status}>
        <header><div><span className="pipeline-dot" /><strong>{status}</strong><small>{items.length}</small></div><p>{currency(total)}</p></header>
        <div className="pipeline-cards">{items.map((proposal) => <article className="pipeline-card" key={proposal.id} onClick={() => onSelect(proposal)}>
          <div className="pipeline-card-head"><div><strong>{proposal.company || proposal.client_name || 'Cliente não informado'}</strong>{proposal.company && <small>{proposal.client_name || 'Contato não informado'}</small>}</div><ProposalActions proposal={proposal} onEdit={onEdit} /></div>
          <p className="pipeline-service">{proposal.main_service || 'Serviço não informado'}</p>
          <dl><div><dt>Responsável</dt><dd>{proposal.responsible || 'Não informado'}</dd></div><div><dt>Envio</dt><dd>{proposal.proposal_sent_date ? new Date(`${proposal.proposal_sent_date.toString().slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Não informada'}</dd></div></dl>
          <div className="pipeline-values"><span>Implantação<strong>{currency(proposal.setup_value)}</strong></span><span>Mensalidade<strong>{currency(proposal.monthly_value)}</strong></span></div>
          <div className="pipeline-card-footer"><ContractBadge signed={proposal.contract_signed} /><label onClick={(e) => e.stopPropagation()}><span className="sr-only">Alterar status</span><select aria-label={`Alterar status de ${proposal.client_name || 'proposta'}`} value={proposal.proposal_status} onChange={(e) => onQuickUpdate(proposal.id, 'proposal_status', e.target.value)}>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label></div>
        </article>)}{!items.length && <ProposalEmptyState compact title="Coluna vazia" description="Nenhuma proposta com este status." />}</div>
      </section>
    })}
  </div></div>
}
