import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { listProposals as getProposals, createProposal, updateProposal } from './services/data/proposalsRepository'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './components/Dashboard'
import { ProposalForm } from './components/ProposalForm'
import { ProposalTable } from './components/ProposalTable'
import { Menu, Sparkles } from 'lucide-react'
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
import { MugoAssistantPanel } from './components/MugoAssistantPanel'
import { MugoIntelligencePage } from './components/MugoIntelligencePage'
import { listClients } from './services/data/clientsRepository'
import { listInstallments } from './services/data/financeRepository'
import { listIntelligenceRecords } from './services/data/intelligenceRepository'
import { CommercialTrashPage } from './components/CommercialTrashPage'
import { CommercialIntegrityPage } from './components/CommercialIntegrityPage'

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
  const [clients, setClients] = useState([])
  const [installments, setInstallments] = useState([])
  const [documents, setDocuments] = useState([])
  const [commercialEvents, setCommercialEvents] = useState([])
  const [documentAnalyses, setDocumentAnalyses] = useState([])
  const [intelligenceError, setIntelligenceError] = useState('')
  const [form, setForm] = useState(initialFormState)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [formDirty, setFormDirty] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [importedEntity, setImportedEntity] = useState(null)

  useEffect(() => {
    loadProposals()
  }, [])

  async function loadProposals() {
    setLoading(true)
    setErrorMessage('')
    setIntelligenceError('')

    try {
      const data = await getProposals()
      setProposals(data)
      if (dataProvider === 'supabase') {
        setSupabaseContracts(await listContracts())
        try {
          const [clientRows, installmentRows, intelligenceRecords] = await Promise.all([listClients(), listInstallments(), listIntelligenceRecords()])
          setClients(clientRows)
          setInstallments(installmentRows)
          setDocuments(intelligenceRecords.documents)
          setCommercialEvents(intelligenceRecords.events)
          setDocumentAnalyses(intelligenceRecords.documentAnalyses)
        } catch (error) {
          console.error(error)
          setIntelligenceError('Parte dos dados analíticos não pôde ser carregada. Os resultados exibidos consideram somente os registros disponíveis.')
        }
      }
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
    if (['dashboard', 'intelligence'].includes(page)) loadProposals()
    setMessage('')
    setErrorMessage('')
  }

  async function handleDocumentImported(imported) {
    setImportedEntity(imported)
    await loadProposals()
    setActivePage(imported.documentType === 'proposal' ? 'proposals' : imported.documentType === 'other' ? 'clients' : 'contracts')
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
      client_name: proposal.clientName || proposal.client_name || '',
      company: proposal.companyName || proposal.company || '',
      phone: proposal.clientDetails?.phone || proposal.phone || '',
      email: proposal.clientDetails?.email || proposal.email || '',
      main_service: proposal.mainService || proposal.main_service || '',
      extra_services: proposal.extra_services || '',
      setup_value: proposal.setupValue ?? proposal.setup_value ?? '',
      monthly_value: proposal.monthlyValue ?? proposal.monthly_value ?? '',
      proposal_sent_date: buildDateValue(proposal.sentAt || proposal.proposal_sent_date),
      responsible: proposal.responsibleName || proposal.responsible || '',
      proposal_status: proposal.status || proposal.proposal_status || '',
      contract_signed: proposal.hasContract ?? proposal.contract_signed ?? false,
      contract_term: proposal.contractTermMonths ? `${proposal.contractTermMonths} meses` : proposal.contract_term || 'Sem contrato',
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

  const intelligenceData = useMemo(() => ({
    proposals,
    contracts: dataProvider === 'supabase' ? supabaseContracts : proposals.map((proposal) => ({
      ...proposal,
      status: proposal.contract_signed ? 'active' : proposal.proposal_status,
      signed: Boolean(proposal.contract_signed),
      start_date: proposal.contract_start_date,
      end_date: proposal.contract_end_date,
      contract_services: proposal.main_service ? [{ service_name: proposal.main_service }] : [],
      clients: { company_name: proposal.company || proposal.client_name },
    })),
    clients,
    installments,
    documents,
    documentAnalyses,
    events: commercialEvents,
  }), [proposals, supabaseContracts, clients, installments, documents, documentAnalyses, commercialEvents])

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
        {errorMessage && !['nova', 'intelligence'].includes(activePage) && <FeedbackMessage type="error">{errorMessage}</FeedbackMessage>}
        {activePage === 'dashboard' && <Dashboard proposals={dataProvider === 'supabase' ? supabaseContracts.map((contract)=>({ ...contract, proposal_status: contract.status === 'active' ? 'Fechada' : contract.status, contract_signed: contract.signed, contract_start_date: contract.start_date, contract_end_date: contract.end_date, responsible: contract.proposals?.responsible || '', main_service: contract.contract_services?.map((service)=>service.service_name).join(', ') || 'Serviço não informado' })) : proposals} contracts={intelligenceData.contracts} installments={installments} />}
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
            key={importedEntity?.proposalId || 'proposals'}
            proposals={proposals}
            onEdit={handleEdit}
            onQuickUpdate={handleQuickUpdate}
            loading={loading}
            onNew={() => handleNavigate('nova')}
            initialSelectedId={importedEntity?.proposalId}
            onChanged={loadProposals}
          />
        )}
        {activePage === 'contracts' && dataProvider === 'legacy' && (
          <ContractsPage proposals={proposals} onEdit={handleEdit} />
        )}
        {activePage === 'contracts' && dataProvider === 'supabase' && <SupabaseContractsPage />}
        {activePage === 'services' && <ServicesCatalogPage />}
        {activePage === 'clients' && <ClientsPage />}
        {activePage === 'finance' && <FinancePage />}
        {activePage === 'documents' && <ImportDocumentPage onImported={handleDocumentImported} />}
        {activePage === 'diagnostic' && <SupabaseDiagnosticPage />}
        {activePage === 'organization-settings' && <OrganizationSettingsPage />}
        {activePage === 'commercial-trash' && <CommercialTrashPage />}
        {activePage === 'commercial-integrity' && <CommercialIntegrityPage />}
        {activePage === 'performance' && <CommercialPerformancePage />}
        {activePage === 'intelligence' && <MugoIntelligencePage data={intelligenceData} loading={loading} error={errorMessage || intelligenceError} />}
        </>}
        </div>
        <button type="button" className="assistant-trigger" onClick={() => setAssistantOpen(true)}><Sparkles size={16}/>Pergunte à Mugô</button>
        <MugoAssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} data={intelligenceData} />
      </main>
    </div>
  )
}
