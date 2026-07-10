const responsibilities = ['Kleber', 'Julia', 'Danilo']
const proposalStatuses = [
  'Proposta enviada',
  'Em negociação',
  'Fechada',
  'Perdida',
]
const contractTerms = ['Sem contrato', '3 meses', '6 meses', '12 meses', 'Indeterminado']

export function ProposalForm({
  form,
  onChange,
  onSubmit,
  loading,
  errors,
  message,
  editMode,
}) {
  return (
    <div className="proposal-form-page">
      <PageHeader
        eyebrow={editMode ? 'Editar proposta' : 'Nova proposta'}
        title={editMode ? 'Atualizar proposta' : 'Cadastrar proposta'}
        description="Preencha os dados do cliente e envie a proposta para o painel comercial."
      />

      {message && <FeedbackMessage>{message}</FeedbackMessage>}
      {errors && <FeedbackMessage type="error">{errors}</FeedbackMessage>}

      <form className="proposal-form" onSubmit={onSubmit}>
        <div className="form-grid">
          <label>
            Nome do cliente<span>*</span>
            <input
              name="client_name"
              value={form.client_name}
              onChange={onChange}
              placeholder="Nome completo"
              required
            />
          </label>
          <label>
            Empresa
            <input name="company" value={form.company} onChange={onChange} placeholder="Nome da empresa" />
          </label>
          <label>
            Telefone
            <input name="phone" value={form.phone} onChange={onChange} placeholder="(00) 00000-0000" />
          </label>
          <label>
            E-mail
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={onChange}
              placeholder="email@cliente.com"
            />
          </label>
          <label>
            Serviço principal<span>*</span>
            <input
              name="main_service"
              value={form.main_service}
              onChange={onChange}
              placeholder="Serviço principal"
              required
            />
          </label>
          <label className="full-width">
            Serviços adicionais
            <input
              name="extra_services"
              value={form.extra_services}
              onChange={onChange}
              placeholder="Serviços opcionais"
            />
          </label>
          <label>
            Valor de implantação
            <input
              name="setup_value"
              type="number"
              value={form.setup_value}
              onChange={onChange}
              step="0.01"
              placeholder="0.00"
            />
          </label>
          <label>
            Valor mensal
            <input
              name="monthly_value"
              type="number"
              value={form.monthly_value}
              onChange={onChange}
              step="0.01"
              placeholder="0.00"
            />
          </label>
          <label>
            Data de envio da proposta
            <input type="date" name="proposal_sent_date" value={form.proposal_sent_date} onChange={onChange} />
          </label>
          <label>
            Responsável<span>*</span>
            <select name="responsible" value={form.responsible} onChange={onChange} required>
              <option value="">Selecione</option>
              {responsibilities.map((responsible) => (
                <option key={responsible} value={responsible}>
                  {responsible}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status da proposta<span>*</span>
            <select name="proposal_status" value={form.proposal_status} onChange={onChange} required>
              <option value="">Selecione</option>
              {proposalStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contrato assinado
            <select name="contract_signed" value={form.contract_signed ? 'true' : 'false'} onChange={onChange}>
              <option value="false">Não</option>
              <option value="true">Sim</option>
            </select>
          </label>
          <label>
            Prazo do contrato
            <select name="contract_term" value={form.contract_term} onChange={onChange}>
              {contractTerms.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data de início do contrato
            <input type="date" name="contract_start_date" value={form.contract_start_date} onChange={onChange} />
          </label>
          <label>
            Data de término do contrato
            <input type="date" name="contract_end_date" value={form.contract_end_date} onChange={onChange} />
          </label>
          <label className="full-width">
            Link do orçamento Canva
            <input name="canva_link" value={form.canva_link} onChange={onChange} placeholder="https://..." />
          </label>
          <label className="full-width">
            Link do contrato PDF/Drive
            <input name="contract_file_url" value={form.contract_file_url} onChange={onChange} placeholder="https://..." />
          </label>
          <label className="full-width">
            Observações
            <textarea name="notes" value={form.notes} onChange={onChange} rows="4" placeholder="Detalhes adicionais" />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="button primary" disabled={loading}>
            {editMode ? 'Atualizar proposta' : 'Salvar proposta'}
          </button>
        </div>
      </form>
    </div>
  )
}
import { FeedbackMessage } from './FeedbackMessage'
import { PageHeader } from './PageHeader'
