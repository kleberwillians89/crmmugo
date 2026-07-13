import { ContractBadge } from './ProposalStatusBadge'
import { ProposalActions } from './ProposalActions'
import { ProposalEmptyState } from './ProposalEmptyState'

const columns=[['draft','Rascunho'],['sent','Enviada'],['viewed','Visualizada'],['negotiating','Em negociação'],['won','Ganha'],['lost','Perdida']]
const currency=(value)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0)
const date=(value)=>value?new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'Não informada'
const value=(item)=>Number(item.totalValue)||(Number(item.setupValue)||0)+(Number(item.monthlyValue)||0)

export function ProposalPipelineView({proposals,onEdit,onSelect,onQuickUpdate,actions}){return <div className="pipeline-scroll"><div className="proposal-pipeline">
  {columns.map(([status,label])=>{const items=proposals.filter((proposal)=>proposal.status===status);return <section className={`pipeline-column pipeline-${status}`} key={status}>
    <header><div><span className="pipeline-dot"/><strong>{label}</strong><small>{items.length}</small></div><p>{currency(items.reduce((sum,item)=>sum+value(item),0))}</p></header>
    <div className="pipeline-cards">{items.map((proposal)=><article className="pipeline-card" key={proposal.id} onClick={()=>onSelect(proposal)}>
      <div className="pipeline-card-head"><div><strong>{proposal.companyName}</strong><small>{proposal.contactName||proposal.clientName}</small></div><ProposalActions proposal={proposal} onEdit={onEdit} {...actions}/></div>
      <p className="pipeline-service">{proposal.mainService||'Serviço não informado'}</p>
      <dl><div><dt>Responsável</dt><dd>{proposal.responsibleName||'Não informado'}</dd></div><div><dt>Envio</dt><dd>{date(proposal.sentAt)}</dd></div></dl>
      <div className="pipeline-values"><span>Implantação<strong>{currency(proposal.setupValue)}</strong></span><span>Mensalidade<strong>{currency(proposal.monthlyValue)}</strong></span></div>
      <div className="pipeline-card-footer"><ContractBadge signed={proposal.hasContract}/><label onClick={(event)=>event.stopPropagation()}><span className="sr-only">Alterar status</span><select aria-label={`Alterar status de ${proposal.clientName}`} value={proposal.status} onChange={(event)=>onQuickUpdate(proposal.id,'status',event.target.value)}>{columns.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div>
    </article>)}{!items.length&&<ProposalEmptyState compact title="Coluna vazia" description="Nenhuma proposta com este status."/>}</div>
  </section>})}
</div></div>}
