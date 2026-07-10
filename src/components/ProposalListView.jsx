import { ContractBadge, ProposalStatusBadge } from './ProposalStatusBadge'
import { ProposalActions } from './ProposalActions'
import { ProposalEmptyState } from './ProposalEmptyState'

const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const date = (value) => {
  if (!value) return 'Não informada'
  const parsed = new Date(`${value.toString().slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? 'Data inválida' : parsed.toLocaleDateString('pt-BR')
}

export function ProposalListView({ proposals, onEdit, onSelect, onNew, hasFilters }) {
  if (!proposals.length) return <ProposalEmptyState title={hasFilters ? 'Nenhuma proposta encontrada' : 'Nenhuma proposta cadastrada'} description={hasFilters ? 'Ajuste a busca ou limpe os filtros para ampliar os resultados.' : 'Cadastre a primeira oportunidade para iniciar o acompanhamento comercial.'} actionLabel={hasFilters ? 'Limpar filtros acima' : 'Nova proposta'} onAction={hasFilters ? undefined : onNew} />

  return <>
    <div className="proposal-list-desktop table-scroll">
      <table className="proposal-list-table">
        <thead><tr><th>Cliente</th><th>Serviço</th><th>Responsável</th><th>Status</th><th>Implantação</th><th>Mensalidade</th><th>Contrato</th><th>Envio</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{proposals.map((proposal) => <tr key={proposal.id} onClick={() => onSelect(proposal)} tabIndex="0" onKeyDown={(event) => event.key === 'Enter' && onSelect(proposal)}>
          <td><div className="client-cell"><span className="client-avatar">{(proposal.client_name || proposal.company || '?').charAt(0).toUpperCase()}</span><div><strong>{proposal.client_name || 'Cliente não informado'}</strong><small>{proposal.company || 'Empresa não informada'}</small></div></div></td>
          <td>{proposal.main_service || 'Não informado'}</td><td>{proposal.responsible || 'Não informado'}</td><td><ProposalStatusBadge status={proposal.proposal_status} /></td>
          <td className="money-cell">{currency(proposal.setup_value)}</td><td className="money-cell">{currency(proposal.monthly_value)}</td><td><ContractBadge signed={proposal.contract_signed} /></td><td>{date(proposal.proposal_sent_date)}</td><td><ProposalActions proposal={proposal} onEdit={onEdit} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="proposal-list-mobile">{proposals.map((proposal) => <article key={proposal.id} className="mobile-proposal-card" onClick={() => onSelect(proposal)}>
      <div className="mobile-card-head"><div className="client-cell"><span className="client-avatar">{(proposal.client_name || proposal.company || '?').charAt(0).toUpperCase()}</span><div><strong>{proposal.client_name || 'Cliente não informado'}</strong><small>{proposal.company || 'Empresa não informada'}</small></div></div><ProposalActions proposal={proposal} onEdit={onEdit} /></div>
      <p>{proposal.main_service || 'Serviço não informado'}</p><div className="mobile-card-badges"><ProposalStatusBadge status={proposal.proposal_status} /><ContractBadge signed={proposal.contract_signed} /></div>
      <div className="mobile-card-values"><span>Implantação<strong>{currency(proposal.setup_value)}</strong></span><span>Mensalidade<strong>{currency(proposal.monthly_value)}</strong></span></div>
    </article>)}</div>
  </>
}
