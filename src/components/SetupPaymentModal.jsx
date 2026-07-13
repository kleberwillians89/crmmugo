import { useMemo, useState } from 'react'
import { setupStatus } from '../lib/financialMetrics'

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const methods = [['pix','PIX'],['transfer','Transferência'],['ted','TED'],['boleto','Boleto'],['card','Cartão'],['cash','Dinheiro'],['other','Outro']]

export function SetupPaymentModal({ contract, correction = false, onClose, onSave }) {
  const current = Number(contract.setup_received_amount || 0)
  const total = Number(contract.setup_value || 0)
  const [amount, setAmount] = useState(correction ? current : Math.max(total - current, 0))
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState(contract.setup_payment_method || 'pix')
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const after = correction ? Number(amount || 0) : current + Number(amount || 0)
  const balance = Math.max(total - after, 0)
  const preview = useMemo(() => setupStatus({ setup_value: total, setup_received_amount: after }), [total, after])
  const invalid = Number(amount) < 0 || (!correction && Number(amount) <= 0) || !receivedAt || !method || !notes.trim() || !confirmed
  return <div className="modal-overlay" role="presentation"><section className="setup-payment-modal" role="dialog" aria-modal="true" aria-labelledby="setup-payment-title"><h2 id="setup-payment-title">{correction?'Corrigir recebimento':'Registrar recebimento do setup'}</h2><dl><div><dt>Cliente</dt><dd>{contract.clients?.company_name||'Não informado'}</dd></div><div><dt>Contrato</dt><dd>{contract.contract_number||'Sem número'}</dd></div><div><dt>Setup contratado</dt><dd>{money(total)}</dd></div><div><dt>Já recebido</dt><dd>{money(current)}</dd></div><div><dt>Saldo atual</dt><dd>{money(Math.max(total-current,0))}</dd></div><div><dt>Saldo depois</dt><dd>{money(balance)}</dd></div></dl><div className="form-grid"><label>{correction?'Valor recebido corrigido':'Valor recebido agora'}<input type="number" min="0" step="0.01" value={amount} onChange={(event)=>setAmount(event.target.value)} /></label><label>Data do recebimento<input type="date" value={receivedAt} onChange={(event)=>setReceivedAt(event.target.value)} /></label><label>Forma de pagamento<select value={method} onChange={(event)=>setMethod(event.target.value)}>{methods.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label className="full-width">{correction?'Motivo obrigatório da correção':'Observações do pagamento'}<textarea value={notes} onChange={(event)=>setNotes(event.target.value)} /></label></div><div className="setup-payment-preview"><span>{preview}</span><strong>{total?Math.min(after/total*100,100).toFixed(1):'0.0'}% recebido</strong></div><label className="strong-confirm"><input type="checkbox" checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)} />Confirmo os valores, a data e a forma de pagamento. Esta ação será registrada no histórico.</label><footer><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button" disabled={invalid} onClick={()=>onSave({setup_received_amount:after,setup_received_at:`${receivedAt}T12:00:00`,setup_payment_method:method,setup_payment_notes:notes})}>{correction?'Confirmar correção':'Registrar recebimento'}</button></footer></section></div>
}
