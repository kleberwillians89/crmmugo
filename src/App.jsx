import { useEffect, useState } from 'react'
import './App.css'
import { listProposals as getProposals, createProposal, updateProposal } from './services/data/proposalsRepository'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './components/Dashboard'
import { ProposalForm } from './components/ProposalForm'
import { ProposalTable } from './components/ProposalTable'
import { Menu } from 'lucide-react'
import { ContractsPage } from './components/ContractsPage'
import { FeedbackMessage } from './components/FeedbackMessage'
import { PageSkeleton } from './components/PageSkeleton'
import { ServicesCatalogPage } from './components/ServicesCatalogPage'
import { ClientsPage } from './components/ClientsPage'
import { FinancePage } from './components/FinancePage'
import { ImportDocumentPage } from './components/ImportDocumentPage'
import { SupabaseDiagnosticPage } from './components/SupabaseDiagnosticPage'
import { OrganizationSettingsPage } from './components/OrganizationSettingsPage'
import { CommercialPerformancePage } from './components/CommercialPerformancePage'
import { SupabaseContractsPage } from './components/SupabaseContractsPage'
import { dataProvider } from './lib/supabase/client'
import { listContracts } from './services/data/contractsRepository'

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
  const [supabaseContracts, setSupabaseContracts] = useState([])
  const [form, setForm] = useState(initialFormState)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [formDirty, setFormDirty] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  useEffect(() => {
    loadProposals()
  }, [])

  async function loadProposals() {
    setLoading(true)
    setErrorMessage('')

    try {
      const data = await getProposals()
      setProposals(data)
      if (dataProvider === 'supabase') setSupabaseContracts(await listContracts())
    } catch (error) {
      console.error(error)
      setErrorMessage('Não foi possível carregar as propostas.')
    } finally {
      setLoading(false)
      setHasLoaded(true)
    }
  }

  function resetForm() {
    setForm(initialFormState)
    setEditId(null)
    setMessage('')
    setErrorMessage('')
  }

  function handleNavigate(page) {
    if (activePage === 'nova' && page !== 'nova' && formDirty && !window.confirm('Você tem alterações não salvas. Deseja sair mesmo assim?')) return
    if (activePage === 'nova' && page !== 'nova') {
      resetForm()
      setFormDirty(false)
    }
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
        const res = await updateProposal(editId, record)
        if (res && res.success) {
          setMessage('Proposta atualizada com sucesso.')
          await loadProposals()
        } else {
          throw new Error('Falha ao atualizar')
        }
      } else {
        const res = await createProposal(record)
        if (res && res.success) {
          setMessage('Proposta criada com sucesso.')
          await loadProposals()
        } else {
          throw new Error('Falha ao criar')
        }
      }

      resetForm()
      setFormDirty(false)
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
      const res = await updateProposal(id, { [field]: value })
      if (res && res.success) {
        await loadProposals()
      } else {
        throw new Error('Falha ao atualizar')
      }
    } catch (error) {
      console.error(error)
      setErrorMessage('Erro ao atualizar o registro.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigate}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
      />
      <main className="main-content">
        <div className="mobile-topbar">
          <button type="button" className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <strong>Mugô CRM</strong>
          <span aria-hidden="true" />
        </div>
        <div className="content-container">
        {loading && !hasLoaded ? <PageSkeleton type={activePage === 'nova' ? 'form' : activePage === 'proposals' ? 'proposals' : 'dashboard'} /> : <>
        {errorMessage && activePage !== 'nova' && <FeedbackMessage type="error">{errorMessage}</FeedbackMessage>}
        {activePage === 'dashboard' && <Dashboard proposals={dataProvider === 'supabase' ? supabaseContracts.map((contract)=>({ ...contract, proposal_status: contract.status === 'active' ? 'Fechada' : contract.status, contract_signed: contract.signed, contract_start_date: contract.start_date, contract_end_date: contract.end_date, responsible: contract.proposals?.responsible || '', main_service: contract.contract_services?.map((service)=>service.service_name).join(', ') || 'Serviço não informado' })) : proposals} />}
        {activePage === 'nova' && (
          <ProposalForm
            form={form}
            onChange={handleChange}
            onSubmit={handleSubmit}
            loading={loading}
            errors={errorMessage}
            message={message}
            editMode={Boolean(editId)}
            onDirtyChange={setFormDirty}
            onCancel={() => handleNavigate('proposals')}
          />
        )}
        {activePage === 'proposals' && (
          <ProposalTable
            proposals={proposals}
            onEdit={handleEdit}
            onQuickUpdate={handleQuickUpdate}
            loading={loading}
            onNew={() => handleNavigate('nova')}
          />
        )}
        {activePage === 'contracts' && dataProvider === 'legacy' && (
          <ContractsPage proposals={proposals} onEdit={handleEdit} />
        )}
        {activePage === 'contracts' && dataProvider === 'supabase' && <SupabaseContractsPage />}
        {activePage === 'services' && <ServicesCatalogPage />}
        {activePage === 'clients' && <ClientsPage />}
        {activePage === 'finance' && <FinancePage />}
        {activePage === 'documents' && <ImportDocumentPage />}
        {activePage === 'diagnostic' && <SupabaseDiagnosticPage />}
        {activePage === 'organization-settings' && <OrganizationSettingsPage />}
        {activePage === 'performance' && <CommercialPerformancePage />}
        </>}
        </div>
      </main>
    </div>
  )
}
