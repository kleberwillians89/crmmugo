import { useEffect, useRef, useState } from 'react'
import { buildWhatsAppLink, isValidBrazilianPhone } from '../lib/whatsapp'
import { FeedbackMessage } from './FeedbackMessage'
import { PixPaymentPanel } from './PixPaymentPanel'
import { callIfFunction } from '../lib/callbackSafety'

export function WhatsAppReviewModal({ data, onClose, onConfirm }) {
  const [message, setMessage] = useState(data.message)
  const [phone, setPhone] = useState(data.phone || '')
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const dialog = useRef(null)
  useEffect(() => { const previous = document.activeElement; dialog.current?.focus(); const key = (event) => { if (event.key === 'Escape') onClose() }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus() } }, [onClose])
  async function copy() { await navigator.clipboard.writeText(message); setError('Mensagem copiada.') }
  async function open() {
    if (!isValidBrazilianPhone(phone)) { setError('Informe um telefone válido com DDD.'); return }
    setOpening(true)
    const popup=window.open('', '_blank')
    if(popup)popup.opener=null
    try { await callIfFunction(onConfirm,{ phone, message }); if(popup)popup.location.href=buildWhatsAppLink(phone,message);else window.location.href=buildWhatsAppLink(phone,message); callIfFunction(onClose) } catch { popup?.close(); setError('Não foi possível registrar a preparação da cobrança.') } finally { setOpening(false) }
  }
  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="whatsapp-modal" role="dialog" aria-modal="true" aria-labelledby="whatsapp-title" tabIndex="-1" ref={dialog}><h2 id="whatsapp-title">Revisar mensagem de WhatsApp</h2>{error&&<FeedbackMessage type={error.includes('copiada')?'success':'error'}>{error}</FeedbackMessage>}<dl><div><dt>Cliente</dt><dd>{data.client}</dd></div><div><dt>Tipo de cobrança</dt><dd>{data.type}</dd></div>{data.contract&&<div><dt>Contrato</dt><dd>{data.contract}</dd></div>}{data.reference&&<div><dt>Referência</dt><dd>{data.reference}</dd></div>}{data.value&&<div><dt>Valor</dt><dd>{data.value}</dd></div>}{data.received&&<div><dt>Valor já recebido</dt><dd>{data.received}</dd></div>}{data.balance&&<div><dt>Saldo</dt><dd>{data.balance}</dd></div>}{data.dueDate&&<div><dt>Vencimento</dt><dd>{data.dueDate}</dd></div>}{data.pixKey&&<div><dt>PIX</dt><dd>{data.pixKey}</dd></div>}{data.bankName&&<div><dt>Banco</dt><dd>{data.bankName}</dd></div>}</dl>{data.pixKey&&<PixPaymentPanel pixKey={data.pixKey} bankName={data.bankName} holder={data.pixHolder}/>}<label>Telefone que será utilizado<input value={phone} onChange={(event)=>setPhone(event.target.value)} /></label><small className="phone-source">Origem: {data.phoneSource||'telefone principal'}</small><label>Mensagem editável<textarea rows="14" value={message} onChange={(event)=>setMessage(event.target.value)} /></label><footer><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button secondary" onClick={copy}>Copiar mensagem</button><button className="button" disabled={opening} onClick={open}>{opening?'Preparando…':'Abrir WhatsApp'}</button></footer><small>A cobrança só é registrada como preparada ao confirmar a abertura. Nenhuma mensagem é enviada automaticamente.</small></section></div>
}
