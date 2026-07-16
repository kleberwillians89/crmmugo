import { useEffect, useRef, useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'
import { isValidBrazilianPhone, normalizeBrazilianPhone } from '../lib/whatsapp'
import { callIfFunction } from '../lib/callbackSafety'

export function WhatsAppPhoneModal({ client, onClose, onSave }) {
  const [phone,setPhone]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const dialog=useRef(null)
  useEffect(()=>{dialog.current?.focus()},[])
  async function save(event){event.preventDefault();if(!isValidBrazilianPhone(phone)){setError('Informe um número de WhatsApp válido com DDD.');return}setSaving(true);try{await callIfFunction(onSave,normalizeBrazilianPhone(phone))}catch(cause){setError(cause.message||'Não foi possível salvar o telefone.');setSaving(false)}}
  return <div className="modal-overlay" onMouseDown={event=>event.target===event.currentTarget&&callIfFunction(onClose)}><form className="whatsapp-modal" role="dialog" aria-modal="true" tabIndex="-1" ref={dialog} onSubmit={save}><h2>Cadastrar número para WhatsApp</h2>{error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}<dl><div><dt>Cliente</dt><dd>{client.contact_name||client.trade_name||client.company_name}</dd></div><div><dt>Empresa</dt><dd>{client.company_name}</dd></div></dl><label>Código do país<input value="+55" readOnly/></label><label>Telefone<input value={phone} onChange={event=>setPhone(event.target.value)} placeholder="(11) 99999-9999" autoFocus/></label><footer><button type="button" className="button secondary" onClick={()=>callIfFunction(onClose)}>Cancelar</button><button className="button" disabled={saving}>{saving?'Salvando…':'Salvar e continuar'}</button></footer></form></div>
}
