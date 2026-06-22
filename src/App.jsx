import { useEffect, useState } from 'react'
import './App.css'
import { getProposals, createProposal, updateProposal } from './lib/api'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './components/Dashboard'
import { ProposalForm } from './components/ProposalForm'
import { ProposalTable } from './components/ProposalTable'

const initialFormState = {
  client_name: '',
  company: '',
  phone: '',
  email: '',
  main_service: '',
  extra_services: '',
  setup_value: '',
  monthly_value: '',
  proposal_sent_date: '',
  responsible: '',
  proposal_status: '',
  contract_signed: false,
  contract_term: 'Sem contrato',
  contract_start_date: '',
  contract_end_date: '',
  proposal_file_url: '',
  contract_file_url: '',
  canva_link: '',
  notes: '',
}

function buildDateValue(value) {
  return value ? value.toString().slice(0, 10) : ''
}

export default function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [proposals, setProposals] = useState([])
  const [form, setForm] = useState(initialFormState)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    loadProposals()
  }, [])

  async function loadProposals() {
    setLoading(true)
    setErrorMessage('')

    try {
      const data = await getProposals()
      setProposals(data)
    } catch (error) {
      console.error(error)
      setErrorMessage('Não foi possível carregar as propostas.')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setForm(initialFormState)
    setEditId(null)
    setMessage('')
    setErrorMessage('')
  }

  function handleNavigate(page) {
    setActivePage(page)
    setMessage('')
    setErrorMessage('')
  }

  function handleChange(event) {
    const { name, value } = event.target

    if (name === 'contract_signed') {
      setForm((current) => ({ ...current, [name]: value === 'true' }))
      return
    }

    setForm((current) => ({ ...current, [name]: value }))
  }

  function validateForm() {
    if (!form.client_name.trim()) return 'Nome do cliente é obrigatório.'
    if (!form.main_service.trim()) return 'Serviço principal é obrigatório.'
    if (!form.proposal_status) return 'Status da proposta é obrigatório.'
    if (!form.responsible) return 'Responsável é obrigatório.'
    if (!form.setup_value && !form.monthly_value) return 'Valor de implantação ou valor mensal obrigatórios.'
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')
    setMessage('')

    const validationError = validateForm()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setLoading(true)

    try {
      const record = {
        ...form,
        setup_value: form.setup_value || null,
        monthly_value: form.monthly_value || null,
        proposal_sent_date: form.proposal_sent_date || null,
        contract_start_date: form.contract_start_date || null,
        contract_end_date: form.contract_end_date || null,
      }

      if (editId) {
        const data = await updateProposal(editId, record)
        setProposals((current) => current.map((item) => (item.id === editId ? data : item)))
        setMessage('Proposta atualizada com sucesso.')
      } else {
        const data = await createProposal(record)
        setProposals((current) => [data, ...current])
        setMessage('Proposta criada com sucesso.')
      }

      resetForm()
      setActivePage('proposals')
    } catch (error) {
      console.error(error)
      setErrorMessage('Erro ao salvar proposta. Verifique os dados e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  function handleEdit(proposal) {
    setForm({
      client_name: proposal.client_name || '',
      company: proposal.company || '',
      phone: proposal.phone || '',
      email: proposal.email || '',
      main_service: proposal.main_service || '',
      extra_services: proposal.extra_services || '',
      setup_value: proposal.setup_value ?? '',
      monthly_value: proposal.monthly_value ?? '',
      proposal_sent_date: buildDateValue(proposal.proposal_sent_date),
      responsible: proposal.responsible || '',
      proposal_status: proposal.proposal_status || '',
      contract_signed: proposal.contract_signed ?? false,
      contract_term: proposal.contract_term || 'Sem contrato',
      contract_start_date: buildDateValue(proposal.contract_start_date),
      contract_end_date: buildDateValue(proposal.contract_end_date),
      proposal_file_url: proposal.proposal_file_url || '',
      contract_file_url: proposal.contract_file_url || '',
      canva_link: proposal.canva_link || '',
      notes: proposal.notes || '',
    })
    setEditId(proposal.id)
    setMessage('')
    setErrorMessage('')
    setActivePage('nova')
  }

  async function handleQuickUpdate(id, field, value) {
    setLoading(true)
    setErrorMessage('')

    try {
      const data = await updateProposal(id, { [field]: value })
      setProposals((current) => current.map((item) => (item.id === id ? data : item)))
    } catch (error) {
      console.error(error)
      setErrorMessage('Erro ao atualizar o registro.')
    } finally {
      setLoading(false)
    }
  }

  const contractProposals = proposals.filter((proposal) => proposal.contract_term && proposal.contract_term !== 'Sem contrato')

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={handleNavigate} />
      <main className="main-content">
        {activePage === 'dashboard' && <Dashboard proposals={proposals} />}
        {activePage === 'nova' && (
          <ProposalForm
            form={form}
            onChange={handleChange}
            onSubmit={handleSubmit}
            loading={loading}
            errors={errorMessage}
            message={message}
            editMode={Boolean(editId)}
          />
        )}
        {activePage === 'proposals' && (
          <ProposalTable
            proposals={proposals}
            onEdit={handleEdit}
            onQuickUpdate={handleQuickUpdate}
            loading={loading}
          />
        )}
        {activePage === 'contracts' && (
          <section className="contracts-page">
            <div className="page-header">
              <div>
                <p className="eyebrow">Contratos</p>
                <h1>Visão de contratos</h1>
                <p className="page-description">
                  Acompanhe contratos assinados e prazos de renovação.
                </p>
              </div>
            </div>
            <div className="contracts-summary">
              <div className="contract-card">
                <span>Contratos totais</span>
                <strong>{contractProposals.length}</strong>
              </div>
              <div className="contract-card">
                <span>Assinados</span>
                <strong>{proposals.filter((item) => item.contract_signed).length}</strong>
              </div>
              <div className="contract-card">
                <span>Vencendo em 30 dias</span>
                <strong>
                  {proposals.filter((item) => {
                    if (!item.contract_end_date) return false
                    const end = new Date(item.contract_end_date)
                    const now = new Date()
                    const diff = (end - now) / (1000 * 60 * 60 * 24)
                    return diff >= 0 && diff <= 30
                  }).length}
                </strong>
              </div>
            </div>
            <div className="table-scroll">
              <table className="proposal-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Prazo</th>
                    <th>Início</th>
                    <th>Término</th>
                    <th>Assinado</th>
                    <th>Responsável</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {contractProposals.map((proposal) => (
                    <tr key={proposal.id}>
                      <td>{proposal.client_name}</td>
                      <td>{proposal.contract_term}</td>
                      <td>{proposal.contract_start_date || '-'}</td>
                      <td>{proposal.contract_end_date || '-'}</td>
                      <td>{proposal.contract_signed ? 'Sim' : 'Não'}</td>
                      <td>{proposal.responsible}</td>
                      <td className="table-actions">
                        <button type="button" className="button small" onClick={() => handleEdit(proposal)}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!contractProposals.length && (
                    <tr>
                      <td colSpan="7" className="empty-state">
                        Nenhum contrato registrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
