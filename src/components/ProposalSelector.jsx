import {useMemo,useState} from 'react'

const money=(value)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const label={draft:'Rascunho',sent:'Enviada',viewed:'Visualizada',negotiating:'Em negociação',won:'Ganha',lost:'Perdida',expired:'Expirada',cancelled:'Cancelada'}
const normalize=(value='')=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()

export function ProposalSelector({proposals,value,clientId,onChange}){
  const [search,setSearch]=useState('')
  const rows=useMemo(()=>proposals.filter((proposal)=>normalize([proposal.proposalNumber,proposal.title,proposal.clientName,proposal.companyName,proposal.clientDetails?.document_number].join(' ')).includes(normalize(search))).sort((a,b)=>Number(b.clientId===clientId)-Number(a.clientId===clientId)),[proposals,search,clientId])
  return <div className="proposal-selector"><input type="search" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar cliente, empresa, título, número ou CNPJ" aria-label="Buscar propostas"/><div className="proposal-selector-list" role="listbox" aria-label="Todas as propostas não arquivadas"><button type="button" className={!value?'selected':''} onClick={()=>onChange('')}>Sem proposta</button>{rows.map((proposal)=>{const linked=proposal.linkedContract;return <button type="button" key={proposal.id} className={value===proposal.id?'selected':''} disabled={Boolean(linked&&value!==proposal.id)} onClick={()=>onChange(proposal.id)}><span><strong>{proposal.proposalNumber||'Sem número'} — {proposal.companyName}</strong><small>{proposal.title} · {money(proposal.totalValue||proposal.setupValue)} · {label[proposal.status]||proposal.status}</small></span>{linked?<em>Já vinculada ao contrato {linked.contract_number||'sem número'}</em>:proposal.clientId===clientId?<em>Mesmo cliente</em>:null}</button>})}{!rows.length&&<p>Nenhuma proposta encontrada.</p>}</div></div>
}
