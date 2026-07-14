import {Archive,Copy,FileText,Link2,MoreHorizontal,Pencil,RefreshCw} from 'lucide-react'
export function ProposalActions({proposal,onEdit,onDuplicate,onConvert,onLink,onArchive,busyId}){const busy=busyId===proposal.id;return <details className="proposal-actions" onClick={(event)=>event.stopPropagation()}><summary aria-label={`Ações de ${proposal.clientName||'proposta'}`} aria-disabled={busy}><MoreHorizontal size={18}/></summary><div className="proposal-actions-menu">
  <button type="button" disabled={busy} onClick={()=>onEdit(proposal)}><Pencil size={14}/>Editar</button>
  <button type="button" disabled={busy} onClick={()=>onDuplicate?.(proposal)}><Copy size={14}/>{busy?'Processando…':'Duplicar'}</button>
  <button type="button" disabled={busy||proposal.hasContract} onClick={()=>onConvert?.(proposal)}><RefreshCw size={14}/>Converter em contrato</button>
  <button type="button" disabled={busy||proposal.hasContract} onClick={()=>onLink?.(proposal)}><Link2 size={14}/>Vincular a contrato existente</button>
  {proposal.proposalFile&&<button type="button" onClick={()=>window.open(proposal.proposalFile.public_url||proposal.proposalFile.url,'_blank')}><FileText size={14}/>Abrir proposta</button>}
  <button type="button" disabled={busy} onClick={()=>onArchive?.(proposal)}><Archive size={14}/>Arquivar</button>
</div></details>}
