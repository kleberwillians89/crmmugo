import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { decideDraft, listPendingDrafts } from '../services/data/growthRepository'

// Modo copiloto: mostra a resposta que a IA sugeriu para esta conversa.
// "Usar" coloca o texto no campo de mensagem para a pessoa revisar e enviar.
export function AiDraftSuggestion({ conversationId, onUse }) {
  const [draft, setDraft] = useState(null)
  useEffect(() => {
    let active = true
    const load = () => listPendingDrafts(conversationId).then((rows) => { if (active) setDraft(rows?.[0] || null) }).catch(() => null)
    load()
    const timer = setInterval(load, 10_000)
    return () => { active = false; clearInterval(timer) }
  }, [conversationId])
  if (!draft) return null
  const decide = async (status, text = null) => { setDraft(null); await decideDraft(draft.id, status, text).catch(() => null) }
  return <div className="ai-draft" role="status">
    <Sparkles size={15} aria-hidden="true" />
    <div><small>Sugestão da IA</small><p>{draft.draft_text}</p></div>
    <div className="ai-draft-actions">
      <button type="button" className="button small" onClick={() => { onUse(draft.draft_text); decide('edited_sent', draft.draft_text) }}>Usar</button>
      <button type="button" className="button secondary small" onClick={() => decide('discarded')} aria-label="Descartar sugestão"><X size={13} /></button>
    </div>
  </div>
}
