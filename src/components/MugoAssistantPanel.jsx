import { useEffect, useRef, useState } from 'react'
import { AI_MAX_QUESTION_LENGTH } from '../config/aiConfig'
import { useAuth } from '../contexts/AuthContext'
import { askMugoAssistant } from '../services/ai/aiAssistantService'

const defaultSuggestions = ['O que preciso resolver hoje?', 'O que vence amanhã?', 'Existe algo urgente agora?', 'O que posso deixar para amanhã?', 'Por que o faturamento pode cair no próximo mês?', 'Qual serviço representa mais receita?', 'Quais clientes estão sem cobrança?', 'Quais são as principais causas agora?']
const pageSuggestions={contracts:['Quais contratos vencem?','Quem ainda não pagou?','Quanto recebo este mês?','Quais contratos renovam em agosto?']}

function SafeAnswer({ text }) {
  const blocks=String(text||'').split('\n').filter(Boolean)
  return <div className="assistant-answer">{blocks.map((block,index)=>block.startsWith('• ')?<div className="assistant-list-item" key={index}><span aria-hidden="true">•</span><p>{block.slice(2)}</p></div>:<p key={index}>{block}</p>)}</div>
}

function StructuredResult({ data }) {
  if(!data)return null
  if(data.type==='service_target')return <div className="assistant-structured-grid">{data.scenarios?.map((item)=><article key={item.service}><span>{item.service}</span><strong>{item.quantity} contratos</strong><small>{item.total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</small></article>)}</div>
  return null
}

export function MugoAssistantPanel({ open, onClose, data, activePage }) {
  const {profile}=useAuth()
  const [question,setQuestion]=useState(''),[history,setHistory]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const panel=useRef(null)
  useEffect(()=>{if(!open)return undefined;const previous=document.activeElement;panel.current?.focus();const key=(event)=>{if(event.key==='Escape')onClose()};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus()}},[open,onClose])
  if(!open)return null

  async function ask(text=question){const clean=text.trim();if(!clean||loading)return;setLoading(true);setError('');try{const result=await askMugoAssistant({question:clean,crmContext:data,conversation:history,userRole:profile?.role});setHistory((current)=>[...current,{question:clean,...result}]);setQuestion('')}catch{setError('Não foi possível concluir a pergunta. O texto foi mantido para você tentar novamente.')}finally{setLoading(false)}}
  function newConversation(){setHistory([]);setQuestion('');setError('')}

  const suggestions=pageSuggestions[activePage]||defaultSuggestions
  return <aside className="assistant-panel" role="dialog" aria-modal="true" aria-labelledby="assistant-title" tabIndex="-1" ref={panel}><header><div><h2 id="assistant-title">Central IA Mugô</h2><p>{activePage==='contracts'?'Inteligência contextual para contratos':'Motores locais primeiro; apoio externo consultivo quando necessário'}</p></div><button className="icon-button" aria-label="Fechar assistente" onClick={onClose}>×</button></header><div className="assistant-history" aria-live="polite">{error&&<p className="assistant-error" role="alert">{error}</p>}{history.map((item,index)=><article key={index}><strong>{item.question}</strong><SafeAnswer text={item.answer}/><StructuredResult data={item.structuredData}/>{item.suggestions?.length>0&&<div className="assistant-suggestions compact">{item.suggestions.map((suggestion)=><button key={suggestion} onClick={()=>ask(suggestion)} disabled={loading}>{suggestion}</button>)}</div>}<small>{item.sources?.join(' ')}</small></article>)}{!history.length&&<div className="assistant-suggestions">{suggestions.map((suggestion)=><button key={suggestion} onClick={()=>ask(suggestion)}>{suggestion}</button>)}</div>}</div><footer><label>Pergunta<textarea rows="3" maxLength={AI_MAX_QUESTION_LENGTH} value={question} onChange={(event)=>setQuestion(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask()}}}/><small>{question.length}/{AI_MAX_QUESTION_LENGTH}</small></label><button className="button" disabled={loading||!question.trim()} onClick={()=>ask()}>{loading?'Analisando…':'Enviar'}</button><button className="button secondary small" onClick={newConversation}>Nova conversa</button></footer></aside>
}
