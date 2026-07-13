import { useCallback, useMemo, useState } from 'react'
import { Columns3, List, Plus } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { ProposalDetailsPanel } from './ProposalDetailsPanel'
import { ProposalListView } from './ProposalListView'
import { ProposalPipelineView } from './ProposalPipelineView'
import { ProposalsSummary } from './ProposalsSummary'
import { ProposalsToolbar } from './ProposalsToolbar'

const initialFilters = { search: '', status: '', responsible: '', service: '', signed: '', term: '', sort: 'recent' }
const valueOf = (item) => (Number(item.setup_value) || 0) + (Number(item.monthly_value) || 0)
const normalized = (value) => (value || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const unique = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
const statusIs = (item, values) => values.includes(normalized(item.status || item.proposal_status))

function signedState(value) {
  if (value === true || ['Sim', 'sim', 'SIM'].includes(value)) return 'signed'
  if (value === false || value === '' || ['Não', 'nao', 'NÃO'].includes(value)) return 'pending'
  return 'unknown'
}

export function ProposalTable({ proposals, onEdit, onQuickUpdate, onNew, loading }) {
  const [view, setView] = useState(() => localStorage.getItem('mugo-proposals-view') || 'list')
  const [filters, setFilters] = useState(initialFilters)
  const [selected, setSelected] = useState(null)

  const setFilter = useCallback((field, value) => setFilters((current) => ({ ...current, [field]: value })), [])
  const changeView = (next) => { setView(next); localStorage.setItem('mugo-proposals-view', next) }
  const options = useMemo(() => ({
    statuses: unique(proposals.map((item) => item.proposal_status)),
    responsibles: unique(proposals.map((item) => item.responsible)),
    services: unique(proposals.map((item) => item.main_service)),
    terms: unique(proposals.map((item) => item.contract_term)),
  }), [proposals])

  const filtered = useMemo(() => {
    const search = normalized(filters.search)
    const result = proposals.filter((item) => {
      const searchable = [item.client_name, item.company, item.main_service, item.responsible, item.email, item.phone].map(normalized).join(' ')
      return (!search || searchable.includes(search)) && (!filters.status || item.proposal_status === filters.status) && (!filters.responsible || item.responsible === filters.responsible) && (!filters.service || item.main_service === filters.service) && (!filters.signed || signedState(item.contract_signed) === filters.signed) && (!filters.term || item.contract_term === filters.term)
    })
    return [...result].sort((a, b) => {
      if (filters.sort === 'oldest') return new Date(a.created_at || a.proposal_sent_date || 0) - new Date(b.created_at || b.proposal_sent_date || 0)
      if (filters.sort === 'highest') return valueOf(b) - valueOf(a)
      if (filters.sort === 'lowest') return valueOf(a) - valueOf(b)
      if (filters.sort === 'az') return (a.client_name || '').localeCompare(b.client_name || '', 'pt-BR')
      if (filters.sort === 'za') return (b.client_name || '').localeCompare(a.client_name || '', 'pt-BR')
      return new Date(b.created_at || b.proposal_sent_date || 0) - new Date(a.created_at || a.proposal_sent_date || 0)
    })
  }, [proposals, filters])

  const metrics = useMemo(() => {const result=filtered.reduce((acc,item)=>{const value=valueOf(item);const won=statusIs(item,['won','fechada','aprovado','contrato assinado','projeto iniciado']);const lost=statusIs(item,['lost','perdida']);const sent=!statusIs(item,['draft','rascunho']);if(sent){acc.sent++;acc.sentValue+=value}if(won){acc.closed++;acc.closedValue+=value}if(lost){acc.lost++;acc.lostValue+=value}return acc},{sent:0,sentValue:0,closed:0,closedValue:0,lost:0,lostValue:0});result.outcomeConversion=result.closed+result.lost?result.closed/(result.closed+result.lost)*100:0;result.sentConversion=result.sent?result.closed/result.sent*100:0;return result}, [filtered])
  const activeCount = ['search', 'status', 'responsible', 'service', 'signed', 'term'].filter((key) => filters[key]).length

  const viewToggle = <div className="proposal-header-actions"><button type="button" className="button" onClick={onNew}><Plus size={15} />Nova proposta</button><div className="view-toggle" aria-label="Visualização"><button type="button" className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')} aria-pressed={view === 'list'}><List size={15} />Lista</button><button type="button" className={view === 'pipeline' ? 'active' : ''} onClick={() => changeView('pipeline')} aria-pressed={view === 'pipeline'}><Columns3 size={15} />Pipeline</button></div></div>

  return <div className="proposals-page" aria-busy={loading}>
    <PageHeader eyebrow="Comercial" title="Propostas" description="Acompanhe oportunidades, negociações, fechamentos e perdas em um único lugar." actions={viewToggle} />
    <ProposalsSummary metrics={metrics} />
    <ProposalsToolbar filters={filters} options={options} activeCount={activeCount} onChange={setFilter} onClear={() => setFilters(initialFilters)} />
    <section className="proposals-view" aria-live="polite">
      <div className="results-heading"><span>{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}</span><small>{view === 'list' ? 'Visualização em lista' : 'Visualização em pipeline'}</small></div>
      {view === 'list' ? <ProposalListView proposals={filtered} onEdit={onEdit} onSelect={setSelected} onNew={onNew} hasFilters={activeCount > 0} /> : <ProposalPipelineView proposals={filtered} onEdit={onEdit} onSelect={setSelected} onQuickUpdate={onQuickUpdate} />}
    </section>
    <ProposalDetailsPanel proposal={selected} onClose={() => setSelected(null)} onEdit={(proposal) => { setSelected(null); onEdit(proposal) }} />
  </div>
}
