import { ContractBadge, ProposalStatusBadge } from './ProposalStatusBadge'
import { ProposalActions } from './ProposalActions'
import { ProposalEmptyState } from './ProposalEmptyState'

const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const date = (value) => {
  if (!value) return 'Não informada'
  const parsed = new Date(`${value.toString().slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? 'Data inválida' : parsed.toLocaleDateString('pt-BR')
}

export function ProposalListView({ proposals, onEdit, onSelect, onNew, hasFilters, actions }) {
  if (!proposals.length) return <ProposalEmptyState title={hasFilters ? 'Nenhuma proposta encontrada' : 'Nenhuma proposta cadastrada'} description={hasFilters ? 'Ajuste a busca ou limpe os filtros para ampliar os resultados.' : 'Cadastre a primeira oportunidade para iniciar o acompanhamento comercial.'} actionLabel={hasFilters ? 'Limpar filtros acima' : 'Nova proposta'} onAction={hasFilters ? undefined : onNew} />

  return <>
    <div className="proposal-list-desktop table-scroll">
      <table className="proposal-list-table">
        <thead><tr><th>Cliente</th><th>Serviço</th><th>Responsável</th><th>Status</th><th>Implantação</th><th>Mensalidade</th><th>Contrato</th><th>Envio</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{proposals.map((proposal) => <tr key={proposal.id} onClick={() => onSelect(proposal)} tabIndex="0" onKeyDown={(event) => event.key === 'Enter' && onSelect(proposal)}>
          <td><div className="client-cell"><span className="client-avatar">{(proposal.clientName||'?').charAt(0).toUpperCase()}</span><div><strong>{proposal.clientName}</strong><small>{proposal.companyName}</small></div></div></td>
          <td>{proposal.mainService||'Não informado'}</td><td>{proposal.responsibleName||'Não informado'}</td><td><ProposalStatusBadge status={proposal.status} /></td>
          <td className="money-cell">{currency(proposal.setupValue)}</td><td className="money-cell">{currency(proposal.monthlyValue)}</td><td><ContractBadge signed={proposal.hasContract} /></td><td>{date(proposal.sentAt)}</td><td><ProposalActions proposal={proposal} onEdit={onEdit} {...actions} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="proposal-list-mobile">{proposals.map((proposal) => <article key={proposal.id} className="mobile-proposal-card" onClick={() => onSelect(proposal)}>
      <div className="mobile-card-head"><div className="client-cell"><span className="client-avatar">{(proposal.clientName||'?').charAt(0).toUpperCase()}</span><div><strong>{proposal.clientName}</strong><small>{proposal.companyName}</small></div></div><ProposalActions proposal={proposal} onEdit={onEdit} {...actions} /></div>
      <p>{proposal.mainService||'Serviço não informado'}</p><div className="mobile-card-badges"><ProposalStatusBadge status={proposal.status} /><ContractBadge signed={proposal.hasContract} /></div>
      <div className="mobile-card-values"><span>Implantação<strong>{currency(proposal.setupValue)}</strong></span><span>Mensalidade<strong>{currency(proposal.monthlyValue)}</strong></span></div>
    </article>)}</div>
  </>
}
