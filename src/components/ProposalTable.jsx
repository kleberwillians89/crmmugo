export function ProposalTable({ proposals, onEdit, onQuickUpdate, loading }) {
  return (
    <div className="proposal-table-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Propostas</p>
          <h1>Gerenciar propostas</h1>
          <p className="page-description">Veja as propostas e atualize o status diretamente na tabela.</p>
        </div>
      </div>

      <div className="table-scroll">
        <table className="proposal-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Empresa</th>
              <th>Serviço</th>
              <th>Implantação</th>
              <th>Mensal</th>
              <th>Status</th>
              <th>Contrato</th>
              <th>Prazo</th>
              <th>Responsável</th>
              <th>Envio</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.id}>
                <td>{proposal.client_name}</td>
                <td>{proposal.company || '-'}</td>
                <td>{proposal.main_service}</td>
                <td>R$ {Number(proposal.setup_value || 0).toFixed(2)}</td>
                <td>R$ {Number(proposal.monthly_value || 0).toFixed(2)}</td>
                <td>
                  <select
                    value={proposal.proposal_status}
                    onChange={(event) => onQuickUpdate(proposal.id, 'proposal_status', event.target.value)}
                  >
                    <option>Proposta enviada</option>
                    <option>Em negociação</option>
                    <option>Fechada</option>
                    <option>Perdida</option>
                  </select>
                </td>
                <td>
                  <select
                    value={proposal.contract_signed ? 'true' : 'false'}
                    onChange={(event) =>
                      onQuickUpdate(proposal.id, 'contract_signed', event.target.value === 'true')
                    }
                  >
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                </td>
                <td>
                  <select
                    value={proposal.contract_term || 'Sem contrato'}
                    onChange={(event) => onQuickUpdate(proposal.id, 'contract_term', event.target.value)}
                  >
                    <option>Sem contrato</option>
                    <option>3 meses</option>
                    <option>6 meses</option>
                    <option>12 meses</option>
                    <option>Indeterminado</option>
                  </select>
                </td>
                <td>{proposal.responsible}</td>
                <td>{proposal.proposal_sent_date || '-'}</td>
                <td className="table-actions">
                  <button type="button" className="button small" onClick={() => onEdit(proposal)}>
                    Editar
                  </button>
                  <a
                    className={proposal.proposal_file_url ? 'button small secondary' : 'button small secondary disabled'}
                    href={proposal.proposal_file_url || '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver proposta
                  </a>
                  <a
                    className={proposal.contract_file_url ? 'button small secondary' : 'button small secondary disabled'}
                    href={proposal.contract_file_url || '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver contrato
                  </a>
                </td>
              </tr>
            ))}
            {!proposals.length && (
              <tr>
                <td colSpan="11" className="empty-state">
                  Nenhuma proposta cadastrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
