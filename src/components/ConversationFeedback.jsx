import {useState} from 'react'
import './ConversationFeedback.css'
import {CONVERSATION_FEEDBACK_LABELS,recordConversationFeedback} from '../services/data/conversationFeedbackRepository'

export function ConversationFeedback({conversationId}){
  const [label,setLabel]=useState('correct'),[note,setNote]=useState(''),[status,setStatus]=useState(''),[saving,setSaving]=useState(false)
  async function save(){
    setSaving(true);setStatus('')
    try{await recordConversationFeedback({conversationId,label,note});setStatus('Avaliação registrada.');setNote('')}
    catch(error){setStatus(error.message||'Não foi possível registrar a avaliação.')}
    finally{setSaving(false)}
  }
  return <details className="conversation-feedback"><summary>Avaliar atendimento</summary><label>Avaliação<select value={label} onChange={event=>setLabel(event.target.value)}>{Object.entries(CONVERSATION_FEEDBACK_LABELS).map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label><label>O que deveria acontecer?<textarea maxLength={2000} value={note} onChange={event=>setNote(event.target.value)}/></label><button type="button" disabled={saving} onClick={save}>{saving?'Salvando…':'Registrar avaliação'}</button>{status&&<p role="status">{status}</p>}</details>
}
