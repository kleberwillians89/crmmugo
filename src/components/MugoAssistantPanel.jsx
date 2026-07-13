import { useEffect, useRef, useState } from 'react'
import { localBusinessAssistant } from '../services/ai/localBusinessAssistant'
import { dataProvider, getSupabaseClient } from '../lib/supabase/client'

const suggestions = ['Quanto falta para bater a meta?', 'Quais contratos vencem?', 'Quem devo ligar hoje?', 'Quais clientes podem comprar IA?', 'Qual serviço mais converte?', 'Como aumentar a receita este mês?', 'Quais propostas estão paradas?', 'Quem não paga há mais tempo?']

export function MugoAssistantPanel({ open, onClose, data }) {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const panel = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    panel.current?.focus()
    const key = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); previous?.focus() }
  }, [open, onClose])

  if (!open) return null

  async function ask(text = question) {
    if (!text.trim()) return
    setLoading(true)
    let response = localBusinessAssistant(text, data)
    if (!response.handled && dataProvider === 'supabase' && import.meta.env.VITE_AI_ASSISTANT_ENABLED === 'true') {
      try {
        const { data: remote, error } = await getSupabaseClient().functions.invoke('mugo-ai-assistant', { body: { question: text } })
        if (error) throw error
        response = { text: remote.answer, sources: remote.sources, mode: 'servidor', intention: 'openai_fallback' }
      } catch {
        response = { ...response, text: 'Não consegui interpretar essa pergunta com segurança. Tente uma das sugestões disponíveis.' }
      }
    }
    setHistory((current) => [...current, { question: text, ...response }])
    setQuestion('')
    setLoading(false)
  }

  return <aside className="assistant-panel" role="dialog" aria-modal="true" aria-labelledby="assistant-title" tabIndex="-1" ref={panel}><header><div><h2 id="assistant-title">Central IA Mugô</h2><p>Motores locais primeiro; IA externa somente como apoio consultivo</p></div><button className="icon-button" aria-label="Fechar assistente" onClick={onClose}>×</button></header><div className="assistant-history" aria-live="polite">{history.map((item, index) => <article key={index}><strong>{item.question}</strong><p>{item.text}</p><small>Fontes: {item.sources.join(', ')} · modo {item.mode} · intenção {item.intention}</small></article>)}{!history.length && <div className="assistant-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div>}</div><footer><label>Pergunta<textarea rows="3" maxLength="500" value={question} onChange={(event) => setQuestion(event.target.value)} /></label><button className="button" disabled={loading} onClick={() => ask()}>{loading ? 'Analisando…' : 'Enviar'}</button><button className="button secondary small" onClick={() => setHistory([])}>Limpar conversa</button></footer></aside>
}
