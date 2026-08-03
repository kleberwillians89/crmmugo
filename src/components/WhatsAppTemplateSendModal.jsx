import { useMemo, useRef, useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'
import { buildTemplateComponents, describeTemplateFields, missingTemplateFields, normalizeTemplateRecipient } from '../services/whatsapp/templateParameters'

const previewText = (template, fields, values) => {
  let preview = template.preview || ''
  for (const field of fields.filter(item => item.component === 'body' && item.variable)) preview = preview.replace(new RegExp(`\\{\\{\\s*${String(field.variable).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'), values[field.key] || `{{${field.variable}}}`)
  return preview
}

export function WhatsAppTemplateSendModal({ template, clients = [], onClose, onSend, dryRun = true }) {
  const fields = useMemo(() => describeTemplateFields(template), [template])
  const [recipient,setRecipient]=useState(''),[clientId,setClientId]=useState(''),[values,setValues]=useState({}),[sending,setSending]=useState(false),[error,setError]=useState(''),[validation,setValidation]=useState(null)
  const sendingRef=useRef(false)
  function selectClient(id){
    setClientId(id)
    const client=clients.find(item=>item.id===id)
    setRecipient(client?.billing_contact_phone||client?.phone||'')
  }
  async function submit(event){
    event.preventDefault()
    if(sendingRef.current)return
    const phone=normalizeTemplateRecipient(recipient)
    if(!phone){setError('Informe um telefone válido com DDI e DDD.');return}
    if(missingTemplateFields(fields,values).length){setError('Preencha todas as variáveis obrigatórias do template.');return}
    sendingRef.current=true;setSending(true);setError('')
    try{
      const payload={recipient:phone,template_name:template.name,language:template.language,components:buildTemplateComponents(fields,values),client_id:clientId||null}
      if(dryRun)setValidation({template_name:payload.template_name,language:payload.language,recipient_masked:`••••••••${phone.slice(-4)}`,component_types:payload.components.map(item=>item.type),parameter_count:payload.components.reduce((total,item)=>total+item.parameters.length,0),approved:template.status==='APPROVED',dry_run:true})
      else{await onSend(payload);onClose()}
    }catch(cause){setError(cause.message||'Não foi possível enviar o template.')}
    finally{sendingRef.current=false;setSending(false)}
  }
  return <div className="modal-overlay" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="whatsapp-modal whatsapp-template-send-modal" role="dialog" aria-modal="true" aria-labelledby="template-send-title"><header><div><small>{dryRun?'Validação segura':'Template aprovado'}</small><h2 id="template-send-title">{template.display||template.name}</h2><p>{template.category||'Sem categoria'} · {template.language}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">×</button></header><form onSubmit={submit}><label>Contato existente<select value={clientId} onChange={event=>selectClient(event.target.value)}><option value="">Informar telefone manualmente</option>{clients.map(client=><option key={client.id} value={client.id}>{client.trade_name||client.company_name} · {client.contact_name||'Sem contato'}</option>)}</select></label><label>Telefone com DDI e DDD<input value={recipient} onChange={event=>setRecipient(event.target.value)} placeholder="5511999999999" inputMode="tel"/></label>{fields.map(field=><label key={field.key}>{field.label}<input value={values[field.key]||''} onChange={event=>setValues(current=>({...current,[field.key]:event.target.value}))} placeholder={field.kind==='coupon_code'?'CODIGO':field.kind==='text'?'Texto':'https://...'}/></label>)}<section className="template-send-preview"><small>Prévia</small><p>{previewText(template,fields,values)}</p>{fields.filter(field=>field.component!=='body').map(field=><span key={field.key}>{field.label}: {values[field.key]||'—'}</span>)}</section>{dryRun&&<FeedbackMessage type="info">Validação local: nenhuma mensagem ou chamada à Meta será realizada.</FeedbackMessage>}{validation&&<FeedbackMessage type="success">Payload válido: {validation.parameter_count} parâmetro(s), destinatário {validation.recipient_masked}.</FeedbackMessage>}{error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}<footer><button type="button" className="button secondary" onClick={onClose} disabled={sending}>Cancelar</button><button className="button" disabled={sending}>{sending?'Validando…':dryRun?'Validar envio':'Enviar mensagem'}</button></footer></form></section></div>
}
