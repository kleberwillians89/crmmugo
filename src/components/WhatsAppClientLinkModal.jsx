import { useMemo, useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'
import { formatPhoneForDisplay } from '../services/whatsapp/phoneNormalization'
import { callIfFunction } from '../lib/callbackSafety'

const text = value => String(value || '').toLocaleLowerCase('pt-BR')

export function WhatsAppClientLinkModal({ conversation, clients = [], onClose, onLink }) {
  const [query,setQuery]=useState(''),[selectedId,setSelectedId]=useState(''),[updatePhone,setUpdatePhone]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('')
  const filtered=useMemo(()=>clients.filter(client=>text(`${client.contact_name} ${client.trade_name} ${client.company_name} ${client.email} ${client.phone}`).includes(text(query))).slice(0,30),[clients,query])
  async function save(){
    if(!selectedId||saving||typeof onLink!=='function')return
    setSaving(true);setError('')
    try{await callIfFunction(onLink,selectedId,{updatePhone});callIfFunction(onClose)}catch(cause){setError(cause.message)}finally{setSaving(false)}
  }
  return <div className="modal-overlay" onMouseDown={event=>event.target===event.currentTarget&&callIfFunction(onClose)}><section className="whatsapp-modal whatsapp-client-link-modal" role="dialog" aria-modal="true"><header><div><span>Vincular cliente</span><h2>{conversation.name}</h2><p>{formatPhoneForDisplay(conversation.waId||conversation.phone)}</p></div><button type="button" className="icon-button" onClick={()=>callIfFunction(onClose)}>×</button></header>{error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}<label>Pesquisar cliente<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Nome, empresa, e-mail ou telefone"/></label><div className="whatsapp-client-options">{filtered.map(client=><label className={selectedId===client.id?'selected':''} key={client.id}><input type="radio" name="client" value={client.id} checked={selectedId===client.id} onChange={()=>setSelectedId(client.id)}/><span><strong>{client.trade_name||client.company_name}</strong><small>{client.contact_name||client.email||client.phone||'Sem contato informado'}</small></span></label>)}</div>{!filtered.length&&<div className="whatsapp-empty">Nenhum cliente encontrado. Cadastre o cliente na área Clientes antes de criar o vínculo.</div>}<label className="whatsapp-link-confirm"><input type="checkbox" checked={updatePhone} onChange={event=>setUpdatePhone(event.target.checked)}/>Atualizar também o telefone principal do cliente após confirmação.</label><footer><button className="button secondary" onClick={()=>callIfFunction(onClose)}>Cancelar</button><button className="button" disabled={!selectedId||saving} onClick={save}>{saving?'Salvando…':'Vincular cliente'}</button></footer></section></div>
}
