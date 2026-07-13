import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { FeedbackMessage } from './FeedbackMessage'

export function PixPaymentPanel({ pixKey, bankName, holder }) {
  const canvas = useRef(null)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (!pixKey || !canvas.current) return
    QRCode.toCanvas(canvas.current, pixKey, { width: 184, margin: 2, color: { dark: '#073b4c', light: '#ffffff' } }).catch(() => setFeedback('Não foi possível gerar o QR Code da chave PIX.'))
  }, [pixKey])

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(pixKey)
      setFeedback('Chave PIX copiada.')
    } catch {
      setFeedback('Não foi possível copiar a chave PIX.')
    }
  }

  if (!pixKey) return <FeedbackMessage type="warning">Chave PIX não cadastrada nas Configurações da Empresa.</FeedbackMessage>

  return (
    <section className="pix-payment-panel" aria-labelledby="pix-panel-title">
      <div className="pix-qr"><canvas ref={canvas} role="img" aria-label="QR Code da chave PIX cadastrada" /></div>
      <div>
        <h3 id="pix-panel-title">Pagamento via PIX</h3>
        <dl>
          <div><dt>Chave PIX</dt><dd>{pixKey}</dd></div>
          {bankName && <div><dt>Banco</dt><dd>{bankName}</dd></div>}
          {holder && <div><dt>Titular</dt><dd>{holder}</dd></div>}
        </dl>
        <button type="button" className="button secondary" onClick={copyPix}>Copiar chave PIX</button>
        {feedback && <div className="pix-feedback" aria-live="polite"><FeedbackMessage type={feedback === 'Chave PIX copiada.' ? 'success' : 'error'}>{feedback}</FeedbackMessage></div>}
      </div>
    </section>
  )
}
