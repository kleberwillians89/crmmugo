import { useRef, useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'

export function WhatsAppNewContactModal({clients=[],saving=false,onClose,onSave}){
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[clientId,setClientId]=useState(''),[clientQuery,setClientQuery]=useState(''),[error,setError]=useState('')
  const submittingRef=useRef(false)
  const visibleClients=clients.filter((client)=>`${client.trade_name||''} ${client.company_name||''} ${client.contact_name||''}`.toLocaleLowerCase('pt-BR').includes(clientQuery.toLocaleLowerCase('pt-BR')))
  async function submit(event){
    event.preventDefault()
    if(submittingRef.current||saving)return
    if(!name.trim()){setError('Informe o nome do contato.');return}
    if(!phone.trim()){setError('Informe o número do WhatsApp.');return}
    submittingRef.current=true;setError('')
    try{await onSave({name:name.trim(),phone,client_id:clientId||undefined})}
    catch(cause){setError(cause.message||'Não foi possível cadastrar o contato.')}
    finally{submittingRef.current=false}
  }
  return <div className="modal-overlay" onMouseDown={(event)=>event.target===event.currentTarget&&!saving&&onClose()}><section className="whatsapp-modal whatsapp-new-contact-modal" role="dialog" aria-modal="true" aria-labelledby="new-whatsapp-contact-title"><header><div><small>WhatsApp</small><h2 id="new-whatsapp-contact-title">Novo contato</h2><p>O cadastro não envia mensagem nem abre uma conversa.</p></div><button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button></header><form onSubmit={submit}><label>Nome *<input autoFocus value={name} maxLength={240} onChange={(event)=>setName(event.target.value)} placeholder="Nome do contato"/></label><label>WhatsApp *<input value={phone} onChange={(event)=>setPhone(event.target.value)} placeholder="(11) 99999-9999" inputMode="tel"/></label><label>Buscar cliente (opcional)<input value={clientQuery} onChange={(event)=>setClientQuery(event.target.value)} placeholder="Nome, empresa ou contato"/></label><label>Vincular a cliente existente<select value={clientId} onChange={(event)=>setClientId(event.target.value)}><option value="">Sem vínculo com cliente</option>{visibleClients.map((client)=><option key={client.id} value={client.id}>{client.trade_name||client.company_name||client.contact_name||'Cliente sem nome'}</option>)}</select></label>{error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}<footer><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button" disabled={saving}>{saving?'Salvando…':'Cadastrar contato'}</button></footer></form></section></div>
}
