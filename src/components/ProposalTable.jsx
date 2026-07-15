import { useCallback, useMemo, useState } from 'react'
import { Columns3, List, Plus } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { ProposalDetailsPanel } from './ProposalDetailsPanel'
import { ProposalListView } from './ProposalListView'
import { ProposalPipelineView } from './ProposalPipelineView'
import { ProposalsSummary } from './ProposalsSummary'
import { ProposalsToolbar } from './ProposalsToolbar'
import { archiveProposal, convertProposalToContract, duplicateProposal } from '../services/data/proposalsRepository'
import {ProposalContractLinkModal} from './ProposalContractLinkModal'
import {FeedbackMessage} from './FeedbackMessage'
import {errorPresentation} from '../lib/userError'

const initialFilters = { search: '', status: '', responsible: '', service: '', signed: '', term: '', sentFrom: '', sentTo: '', sort: 'recent' }
const valueOf = (item) => Number(item.totalValue)||(Number(item.setupValue)||0)+(Number(item.monthlyValue)||0)
const normalized = (value) => (value || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const unique = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
const statusIs = (item, values) => values.includes(normalized(item.status || item.proposal_status))

function signedState(value) {
  if (value === true || ['Sim', 'sim', 'SIM'].includes(value)) return 'signed'
  if (value === false || value === '' || ['Não', 'nao', 'NÃO'].includes(value)) return 'pending'
  return 'unknown'
}

export function ProposalTable({ proposals, onEdit, onQuickUpdate, onNew, loading, initialSelectedId, onChanged }) {
  const [view, setView] = useState(() => localStorage.getItem('mugo-proposals-view') || 'list')
  const [filters, setFilters] = useState(initialFilters)
  const [selected, setSelected] = useState(()=>proposals.find((proposal)=>proposal.id===initialSelectedId)||null)
  const [linking,setLinking]=useState(null)
  const [busyId,setBusyId]=useState(null),[operationError,setOperationError]=useState(null)

  const setFilter = useCallback((field, value) => setFilters((current) => ({ ...current, [field]: value })), [])
  const changeView = (next) => { setView(next); localStorage.setItem('mugo-proposals-view', next) }
  const options = useMemo(() => ({
    statuses: unique(proposals.map((item) => item.status)),
    responsibles: unique(proposals.map((item) => item.responsibleName)),
    services: unique(proposals.flatMap((item) => item.services.map((service)=>service.name))),
    terms: unique(proposals.map((item) => item.contractTermMonths?.toString())),
  }), [proposals])

  const filtered = useMemo(() => {
    const search = normalized(filters.search)
    const result = proposals.filter((item) => {
      const searchable = [item.title,item.proposalNumber,item.clientName,item.companyName,item.contactName,item.responsibleName,item.clientDetails.email,item.clientDetails.phone,...item.services.map((service)=>service.name)].map(normalized).join(' ')
      const sentDate = String(item.sentAt || '').slice(0, 10)
      return (!search || searchable.includes(search)) && (!filters.status || item.status === filters.status) && (!filters.responsible || item.responsibleName === filters.responsible) && (!filters.service || item.services.some((service)=>service.name===filters.service)) && (!filters.signed || signedState(item.hasContract) === filters.signed) && (!filters.term || item.contractTermMonths?.toString() === filters.term) && (!filters.sentFrom || sentDate >= filters.sentFrom) && (!filters.sentTo || sentDate <= filters.sentTo)
    })
    return [...result].sort((a, b) => {
      if (filters.sort === 'oldest') return new Date(a.createdAt||a.sentAt||0)-new Date(b.createdAt||b.sentAt||0)
      if (filters.sort === 'highest') return valueOf(b) - valueOf(a)
      if (filters.sort === 'lowest') return valueOf(a) - valueOf(b)
      if (filters.sort === 'az') return a.clientName.localeCompare(b.clientName,'pt-BR')
      if (filters.sort === 'za') return b.clientName.localeCompare(a.clientName,'pt-BR')
      if (filters.sort === 'status') return String(a.status).localeCompare(String(b.status),'pt-BR')
      return new Date(b.createdAt||b.sentAt||0)-new Date(a.createdAt||a.sentAt||0)
    })
  }, [proposals, filters])

  const metrics = useMemo(() => {const result=filtered.reduce((acc,item)=>{const value=valueOf(item);const won=statusIs(item,['won','fechada','aprovado','contrato assinado','projeto iniciado']);const lost=statusIs(item,['lost','perdida']);const sent=!statusIs(item,['draft','rascunho']);if(sent){acc.sent++;acc.sentValue+=value}if(won){acc.closed++;acc.closedValue+=value}if(lost){acc.lost++;acc.lostValue+=value}return acc},{sent:0,sentValue:0,closed:0,closedValue:0,lost:0,lostValue:0});result.outcomeConversion=result.closed+result.lost?result.closed/(result.closed+result.lost)*100:0;result.sentConversion=result.sent?result.closed/result.sent*100:0;return result}, [filtered])
  const activeCount = ['search', 'status', 'responsible', 'service', 'signed', 'term', 'sentFrom', 'sentTo'].filter((key) => filters[key]).length
  const run=async(proposal,operation,action)=>{if(busyId)return;setBusyId(proposal.id);setOperationError(null);try{await action();await onChanged()}catch(cause){setOperationError(errorPresentation(cause,`Não foi possível ${operation} a proposta.`,{operation,entity:'proposta',id:proposal.id}))}finally{setBusyId(null)}}
  const actions = {busyId,onDuplicate:(proposal)=>run(proposal,'duplicar',()=>duplicateProposal(proposal)),onConvert:(proposal)=>run(proposal,'converter',()=>convertProposalToContract(proposal)),onLink:setLinking,onArchive:async(proposal)=>{if(window.confirm(`Arquivar a proposta “${proposal.title}”?`))await run(proposal,'arquivar',async()=>{await archiveProposal(proposal);setSelected(null)})}}

  const viewToggle = <div className="proposal-header-actions"><button type="button" className="button" onClick={onNew}><Plus size={15} />Nova proposta</button><div className="view-toggle" aria-label="Visualização"><button type="button" className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')} aria-pressed={view === 'list'}><List size={15} />Lista</button><button type="button" className={view === 'pipeline' ? 'active' : ''} onClick={() => changeView('pipeline')} aria-pressed={view === 'pipeline'}><Columns3 size={15} />Pipeline</button></div></div>

  return <div className="proposals-page" aria-busy={loading}>
    <PageHeader eyebrow="Comercial" title="Propostas" description="Acompanhe oportunidades, negociações, fechamentos e perdas em um único lugar." actions={viewToggle} />
    {operationError&&<FeedbackMessage type="error" details={operationError.technical}>{operationError.friendly}</FeedbackMessage>}
    <ProposalsSummary metrics={metrics} />
    <ProposalsToolbar filters={filters} options={options} activeCount={activeCount} onChange={setFilter} onClear={() => setFilters(initialFilters)} />
    <section className="proposals-view" aria-live="polite">
      <div className="results-heading"><span>{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}</span><small>{view === 'list' ? 'Visualização em lista' : 'Visualização em pipeline'}</small></div>
      {view === 'list' ? <ProposalListView proposals={filtered} onEdit={onEdit} onSelect={setSelected} onNew={onNew} hasFilters={activeCount > 0} actions={actions} /> : <ProposalPipelineView proposals={filtered} onEdit={onEdit} onSelect={setSelected} onQuickUpdate={onQuickUpdate} actions={actions} />}
    </section>
    <ProposalDetailsPanel proposal={selected} onClose={() => setSelected(null)} onEdit={(proposal) => { setSelected(null); onEdit(proposal) }} />
    {linking&&<ProposalContractLinkModal proposal={linking} onClose={()=>setLinking(null)} onLinked={onChanged}/>}
  </div>
}
