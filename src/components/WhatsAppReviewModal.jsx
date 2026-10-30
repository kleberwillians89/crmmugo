import { useEffect, useMemo, useRef, useState } from 'react'
import { buildWhatsAppLink, formatWhatsAppPhone, isValidBrazilianPhone } from '../lib/whatsapp'
import { FeedbackMessage } from './FeedbackMessage'
import { PixPaymentPanel } from './PixPaymentPanel'
import { callIfFunction } from '../lib/callbackSafety'
import { parseMoneyInput } from '../lib/moneyInput'

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
// data.phoneOptions: [{name, phone, source, isPrimary}] — com mais de um número, o usuário escolhe.
// data.amount + data.buildMessage({name, amount}): valor editável que reescreve a mensagem.
// data.installmentId: permite salvar o novo valor na parcela.
export function WhatsAppReviewModal({ data, onClose, onConfirm }) {
  const options = useMemo(() => {
    const list = Array.isArray(data.phoneOptions) ? data.phoneOptions.filter((item) => isValidBrazilianPhone(item.phone)) : []
    return list.length ? list : (data.phone ? [{ name: data.contactName || data.client, phone: data.phone, source: data.phoneSource || 'telefone principal', isPrimary: true }] : [])
  }, [data])
  const initialOption = Math.max(options.findIndex((item) => item.isPrimary), 0)
  const [selected, setSelected] = useState(initialOption)
  const [phone, setPhone] = useState(options[initialOption]?.phone || data.phone || '')
  const [amountText, setAmountText] = useState(data.amount != null ? String(data.amount).replace('.', ',') : '')
  const [saveAmount, setSaveAmount] = useState(Boolean(data.installmentId))
  const [manualMessage, setManualMessage] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState(false)
  const [paymentUrl, setPaymentUrl] = useState(data.paymentUrl || '')
  const [linking, setLinking] = useState(false)
  const dialog = useRef(null)
  const canEditAmount = data.amount != null && typeof data.buildMessage === 'function'
  const amount = canEditAmount ? parseMoneyInput(amountText) : null
  const amountChanged = canEditAmount && amount != null && Math.abs(amount - Number(data.amount)) >= 0.005
  const contactName = options[selected]?.name || data.contactName || data.client
  // Enquanto o texto não foi mexido à mão, ele acompanha o contato e o valor escolhidos.
  const baseMessage = canEditAmount && amount != null ? data.buildMessage({ name: contactName, amount, value: money(amount) }) : data.message
  const linkText = paymentUrl ? `\n\nPara pagar (Pix, boleto ou cartão): ${paymentUrl}\nApós o vencimento, multa e juros já são calculados no link.` : ''
  const generatedMessage = baseMessage + linkText
  const message = manualMessage ?? generatedMessage
  const messageEdited = manualMessage !== null

  useEffect(() => { const previous = document.activeElement; dialog.current?.focus(); const key = (event) => { if (event.key === 'Escape') callIfFunction(onClose) }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus() } }, [onClose])

  // Gera a cobrança no Asaas com o valor mostrado (o valor também é salvo na parcela) e põe o link na mensagem.
  async function createLink() {
    setError(''); setNotice('')
    if (canEditAmount && amount == null) { setError('Informe um valor válido para a cobrança.'); return }
    setLinking(true)
    try {
      const charge = await data.onCreatePaymentLink({ amount: canEditAmount ? amount : null })
      setPaymentUrl(charge.payment_url || '')
      if (manualMessage !== null && charge.payment_url && !manualMessage.includes(charge.payment_url)) setManualMessage(`${manualMessage}\n\nPara pagar (Pix, boleto ou cartão): ${charge.payment_url}`)
      setNotice(`Cobrança criada no Asaas (multa ${charge.fine_percent}% e juros ${charge.interest_percent}% ao mês após o vencimento).`)
    } catch (failure) {
      setError(failure?.message || 'Não foi possível gerar a cobrança no Asaas.')
    } finally { setLinking(false) }
  }
  function pick(index) { setSelected(index); setPhone(options[index].phone) }
  function refreshMessage() { setManualMessage(null) }
  async function copy() { await navigator.clipboard.writeText(message); setNotice('Mensagem copiada.') }
  async function open() {
    setError(''); setNotice('')
    if (!isValidBrazilianPhone(phone)) { setError('Informe um telefone válido com DDD (ou + e o código do país).'); return }
    if (canEditAmount && amount == null) { setError('Informe um valor válido para a cobrança.'); return }
    setOpening(true)
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null
    const link = buildWhatsAppLink(phone, message)
    let warning = ''
    try {
      await callIfFunction(onConfirm, { phone, message, contactName, amount, amountChanged, saveAmount: amountChanged && saveAmount })
    } catch (failure) {
      // Registrar a cobrança no histórico não pode impedir a mensagem de sair.
      warning = failure?.message || 'A cobrança foi aberta, mas não foi possível registrar no histórico.'
    }
    if (popup) popup.location.href = link
    else window.location.assign(link)
    setOpening(false)
    if (warning) { setError(warning); return }
    callIfFunction(onClose)
  }

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) callIfFunction(onClose) }}>
    <section className="whatsapp-modal" role="dialog" aria-modal="true" aria-labelledby="whatsapp-title" tabIndex="-1" ref={dialog}>
      <h2 id="whatsapp-title">Revisar cobrança no WhatsApp</h2>
      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      {notice && <FeedbackMessage type="success">{notice}</FeedbackMessage>}
      <dl>
        <div><dt>Cliente</dt><dd>{data.client}</dd></div>
        <div><dt>Tipo de cobrança</dt><dd>{data.type}</dd></div>
        {data.contract && <div><dt>Contrato</dt><dd>{data.contract}</dd></div>}
        {data.reference && <div><dt>Referência</dt><dd>{data.reference}</dd></div>}
        {!canEditAmount && data.value && <div><dt>Valor</dt><dd>{data.value}</dd></div>}
        {data.received && <div><dt>Valor já recebido</dt><dd>{data.received}</dd></div>}
        {!canEditAmount && data.balance && <div><dt>Saldo</dt><dd>{data.balance}</dd></div>}
        {data.dueDate && <div><dt>Vencimento</dt><dd>{data.dueDate}</dd></div>}
        {data.pixKey && <div><dt>PIX</dt><dd>{data.pixKey}</dd></div>}
        {data.bankName && <div><dt>Banco</dt><dd>{data.bankName}</dd></div>}
      </dl>
      {data.pixKey && <PixPaymentPanel pixKey={data.pixKey} bankName={data.bankName} holder={data.pixHolder} />}

      {canEditAmount && <fieldset className="billing-amount-field">
        <legend>Valor da cobrança</legend>
        <label>Valor (R$)<input inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} aria-invalid={amount == null} /></label>
        {amountChanged && <small>Antes: {money(data.amount)} · Agora: {money(amount)}</small>}
        {amountChanged && data.installmentId && <label className="checkbox-row"><input type="checkbox" checked={saveAmount} onChange={(event) => setSaveAmount(event.target.checked)} /> Salvar este valor na parcela (o financeiro passa a mostrar {money(amount)})</label>}
      </fieldset>}

      {options.length > 1 ? <fieldset className="billing-phone-options">
        <legend>Enviar para qual número?</legend>
        {options.map((item, index) => <label key={`${item.phone}-${index}`} className="checkbox-row">
          <input type="radio" name="billing-phone" checked={selected === index} onChange={() => pick(index)} />
          <span><strong>{item.name}</strong> · {formatWhatsAppPhone(item.phone) || item.phone}{item.isPrimary ? ' · principal' : ''}{item.source && !item.isPrimary ? ` · ${item.source}` : ''}</span>
        </label>)}
      </fieldset> : null}
      <label>Telefone que será utilizado<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      {options.length <= 1 && <small className="phone-source">Origem: {options[0]?.source || data.phoneSource || 'telefone principal'}</small>}

      {typeof data.onCreatePaymentLink === 'function' && <div className="billing-asaas-row">
        <button type="button" className="button secondary small" disabled={linking} onClick={createLink}>{linking ? 'Gerando no Asaas…' : paymentUrl ? 'Atualizar link do Asaas' : 'Gerar link de pagamento (Asaas)'}</button>
        <small>{paymentUrl ? <>Link: <a href={paymentUrl} target="_blank" rel="noreferrer">{paymentUrl}</a></> : 'Pix, boleto ou cartão. Depois do vencimento o Asaas cobra multa e juros. O valor acima é salvo na parcela.'}</small>
      </div>}
      <label>Mensagem editável<textarea rows="14" value={message} onChange={(event) => setManualMessage(event.target.value)} /></label>
      {canEditAmount && messageEdited && <button type="button" className="button secondary small" onClick={refreshMessage}>Refazer a mensagem com o valor e o contato escolhidos</button>}
      <footer>
        <button className="button secondary" onClick={() => callIfFunction(onClose)}>Cancelar</button>
        <button className="button secondary" onClick={copy}>Copiar mensagem</button>
        <button className="button" disabled={opening} onClick={open}>{opening ? 'Preparando…' : 'Abrir WhatsApp'}</button>
      </footer>
      <small>Abre a conversa no seu WhatsApp com a mensagem pronta; você confere e envia por lá.</small>
    </section>
  </div>
}
