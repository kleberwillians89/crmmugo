import {FileText} from 'lucide-react'
import {statusLabel} from '../config/statusLabels'

const money=(value)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const date=(value,options={day:'2-digit',month:'short'})=>value?new Intl.DateTimeFormat('pt-BR',options).format(new Date(`${String(value).slice(0,10)}T12:00:00`)):'Não informado'

export function ContractRecordSections({contract}){
  const documents=contract.documents||[],events=[...(contract.commercial_events||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
  return <div className="contract-record-sections">
    <details open><summary>Dados do contrato</summary><dl className="details-list"><div><dt>Cliente</dt><dd>{contract.clientName}</dd></div><div><dt>Número</dt><dd>{contract.contractNumber}</dd></div><div><dt>Status</dt><dd>{contract.statusLabel}</dd></div><div><dt>Responsável principal</dt><dd>{contract.responsibleName||'Não informado'}</dd></div><div><dt>Início</dt><dd>{date(contract.startDate,{dateStyle:'short'})}</dd></div><div><dt>Fim</dt><dd>{contract.endDate?date(contract.endDate,{dateStyle:'short'}):'Sem data final'}</dd></div></dl></details>
    <details open><summary>Valores contratados</summary><dl className="details-list"><div><dt>Mensalidade</dt><dd>{money(contract.monthlyValue)}</dd></div><div><dt>Setup</dt><dd>{money(contract.setupValue)}</dd></div><div><dt>Total</dt><dd>{money(contract.totalValue)}</dd></div><div><dt>Dia de cobrança</dt><dd>{contract.billingDay||'Não informado'}</dd></div></dl></details>
    <details open><summary>Documentos</summary><div className="contract-document-grid">{documents.map((item)=><article key={item.id}><FileText size={19}/><div><strong>{statusLabel('document',item.document_type)}</strong><small>{item.file_name}</small></div></article>)}{!documents.length&&<p className="empty-inline">Nenhum documento relacionado.</p>}</div></details>
    <details open><summary>Timeline</summary><div className="contract-timeline">{events.map((item)=><article key={item.id}><time>{date(item.created_at)}</time><div><strong>{item.title}</strong>{item.description&&<p>{item.description}</p>}</div></article>)}{!events.length&&<p className="empty-inline">Nenhum evento registrado.</p>}</div></details>
    <details open><summary>Observações</summary><p className="contract-notes">{contract.notes||'Nenhuma observação.'}</p></details>
  </div>
}
