import {Archive,Copy,FileText,MoreHorizontal,Pencil,RefreshCw} from 'lucide-react'
export function ProposalActions({proposal,onEdit,onDuplicate,onConvert,onArchive}){return <details className="proposal-actions" onClick={(event)=>event.stopPropagation()}><summary aria-label={`Ações de ${proposal.clientName||'proposta'}`}><MoreHorizontal size={18}/></summary><div className="proposal-actions-menu">
  <button type="button" onClick={()=>onEdit(proposal)}><Pencil size={14}/>Editar</button>
  <button type="button" onClick={()=>onDuplicate?.(proposal)}><Copy size={14}/>Duplicar</button>
  <button type="button" disabled={proposal.hasContract} onClick={()=>onConvert?.(proposal)}><RefreshCw size={14}/>Converter em contrato</button>
  {proposal.proposalFile&&<button type="button" onClick={()=>window.open(proposal.proposalFile.public_url||proposal.proposalFile.url,'_blank')}><FileText size={14}/>Abrir proposta</button>}
  <button type="button" onClick={()=>onArchive?.(proposal)}><Archive size={14}/>Arquivar</button>
</div></details>}
