import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, FileText, Search, X } from 'lucide-react'
import { FeedbackMessage } from './FeedbackMessage'
import { loadStoredTemplateStatuses } from '../services/whatsapp/templateCatalog'
import { buildTemplateComponents, describeTemplateFields, maskTemplateRecipient, missingTemplateFields, renderTemplatePreview, suggestTemplateValues, templateCategory, templateSearchText } from '../services/whatsapp/templateParameters'

const categories = [['all','Todos'],['marketing','Marketing'],['utility','Utilidade'],['authentication','Autenticação']]
const categoryLabel = value => value === 'marketing' ? 'Marketing' : value === 'authentication' ? 'Autenticação' : 'Utilidade'

export function WhatsAppConversationTemplateDrawer({ open, conversation, client, contract, installment, owner, enabled = false, authorized = false, templatesOverride = null, onClose, onSend }) {
  const [templates,setTemplates]=useState([]),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState('')
  const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[selected,setSelected]=useState(null),[values,setValues]=useState({}),[step,setStep]=useState('select')
  const [confirmed,setConfirmed]=useState(false),[sending,setSending]=useState(false),[sendState,setSendState]=useState(''),[error,setError]=useState('')
  const drawerRef=useRef(null),returnFocusRef=useRef(null),sendingRef=useRef(false)
  const fields=useMemo(()=>describeTemplateFields(selected||{}),[selected])
  const preview=useMemo(()=>renderTemplatePreview(selected||{},fields,values),[selected,fields,values])
  const approved=useMemo(()=>templates.filter(item=>item.status==='APPROVED'&&item.is_active!==false),[templates])
  const visible=useMemo(()=>approved.filter(item=>(category==='all'||templateCategory(item)===category)&&(!query||templateSearchText(item).includes(query.toLocaleLowerCase('pt-BR')))),[approved,category,query])

  useEffect(()=>{
    if(!open)return
    returnFocusRef.current=document.activeElement
    let active=true
    Promise.resolve().then(()=>{if(active){setLoading(true);setLoadError('');setSelected(null);setStep('select');setConfirmed(false);setError('');setSendState('')}})
    const source=templatesOverride?Promise.resolve({templates:templatesOverride}):loadStoredTemplateStatuses({force:true})
    source.then(result=>{if(active)setTemplates(result.templates)}).catch(cause=>{if(active)setLoadError(cause.message||'Não foi possível carregar os modelos sincronizados.')}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[open,templatesOverride])
  useEffect(()=>{
    if(!open)return
    const node=drawerRef.current
    node?.querySelector('button,input,select,textarea')?.focus()
    const keydown=event=>{
      if(event.key==='Escape'){event.preventDefault();onClose();return}
      if(event.key!=='Tab'||!node)return
      const focusable=[...node.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href]')]
      if(!focusable.length)return
      const first=focusable[0],last=focusable.at(-1)
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',keydown)
    return()=>{document.removeEventListener('keydown',keydown);queueMicrotask(()=>returnFocusRef.current?.focus())}
  },[open,onClose])
  if(!open||!conversation)return null

  function choose(template){
    const nextFields=describeTemplateFields(template)
    setSelected(template)
    setValues(suggestTemplateValues(nextFields,{client,contract,installment,owner,contactName:conversation.name}))
    setStep('fill');setConfirmed(false);setError('')
  }
  function continueToReview(){
    const missing=missingTemplateFields(fields,values)
    if(missing.length){setError('Preencha os campos obrigatórios destacados antes de revisar.');return}
    setError('');setStep('review')
  }
  async function submit(){
    if(!confirmed||sendingRef.current||!enabled||!authorized)return
    sendingRef.current=true;setSending(true);setSendState('sending');setError('')
    try{
      await onSend({recipient:conversation.phone||conversation.waId,template_name:selected.name,language:selected.language||'pt_BR',components:buildTemplateComponents(fields,values),template:selected,preview})
      setSendState('sent')
      onClose()
    }catch(cause){
      const unknown=cause.code==='UPSTREAM_TIMEOUT'||cause.status===504
      setSendState(unknown?'unknown':'failed')
      setError(unknown?'O resultado do envio é desconhecido. Verifique o histórico antes de qualquer nova tentativa.':cause.message||'Não foi possível enviar o modelo.')
    }finally{sendingRef.current=false;setSending(false)}
  }

  return <><button className="template-context-backdrop" onClick={onClose} aria-label="Fechar seletor de modelos"/><aside ref={drawerRef} className="conversation-template-drawer" role="dialog" aria-modal="true" aria-labelledby="conversation-template-title">
    <header><div><small>{step==='select'?'Modelos aprovados':step==='fill'?'Preencher variáveis':'Confirmar envio'}</small><h2 id="conversation-template-title">{selected&&step!=='select'?selected.display||selected.name:'Enviar modelo'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Voltar à conversa"><X size={18}/></button></header>
    {step==='select'?<><label className="template-context-search"><Search size={15}/><span className="sr-only">Buscar modelos</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar por nome, conteúdo ou categoria"/></label><div className="template-context-filters" role="group" aria-label="Filtrar modelos">{categories.map(([value,label])=><button key={value} className={category===value?'active':''} onClick={()=>setCategory(value)}>{label}</button>)}</div>
      {loading?<div className="template-context-state">Carregando modelos aprovados…</div>:loadError?<FeedbackMessage type="error">{loadError}</FeedbackMessage>:visible.length?<div className="template-context-list">{visible.map(template=>{const templateFields=describeTemplateFields(template);return <button key={`${template.name}:${template.language}`} onClick={()=>choose(template)}><FileText size={17}/><span><strong>{template.display||template.name}</strong><small>{template.name}</small><p>{template.preview||'Sem prévia textual.'}</p><i>{categoryLabel(templateCategory(template))} · {template.language} · {templateFields.length} parâmetro(s)</i></span><CheckCircle2 size={15}/></button>})}</div>:<div className="template-context-state">Nenhum modelo aprovado corresponde à busca.</div>}
    </>:<><button className="template-context-back" onClick={()=>{setStep(step==='review'?'fill':'select');setError('')}}><ArrowLeft size={14}/>{step==='review'?'Revisar campos':'Escolher outro modelo'}</button>
      <div className="template-recipient"><span>Será enviado para</span><strong>{conversation.name} — {maskTemplateRecipient(conversation.phone||conversation.waId)}</strong></div>
      {step==='fill'?<div className="template-context-fields">{fields.length?fields.map(field=>{const missing=field.required&&!String(values[field.key]||'').trim();return <label key={field.key}>{field.label}{field.required&&<span>Obrigatório</span>}<input aria-invalid={missing} aria-describedby={missing?`${field.key}-error`:undefined} value={values[field.key]||''} onChange={event=>setValues(current=>({...current,[field.key]:event.target.value}))} placeholder={field.kind==='coupon_code'?'Código':field.kind==='text'?'Digite o texto':'https://…'}/>{missing&&<small id={`${field.key}-error`}>Informação não disponível no CRM.</small>}</label>}):<p className="template-context-state">Este modelo não exige parâmetros.</p>}<button className="button" onClick={continueToReview}>Revisar mensagem</button></div>:<div className="template-context-confirm"><TemplatePreview preview={preview}/><label className="template-confirm-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>Revisei o destinatário, o modelo e os dados da mensagem.</span></label>{!enabled&&<FeedbackMessage type="warning">O envio de modelos está desativado pela feature flag.</FeedbackMessage>}{enabled&&!authorized&&<FeedbackMessage type="warning">A homologação não está autorizada para este perfil.</FeedbackMessage>}{sendState==='sending'&&<FeedbackMessage type="info">Enviando uma única tentativa…</FeedbackMessage>}{error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}<button className="button" onClick={submit} disabled={!confirmed||sending||!enabled||!authorized}>{sending?'Enviando…':'Confirmar e enviar'}</button></div>}
      {step==='fill'&&<TemplatePreview preview={preview} compact/>}
    </>}
  </aside></>
}

function TemplatePreview({preview,compact=false}){
  return <section className={`conversation-template-preview${compact?' compact':''}`} aria-label="Prévia da mensagem">{preview.header&&<strong>{preview.header}</strong>}<p>{preview.body||'Sem conteúdo textual.'}</p>{preview.footer&&<small>{preview.footer}</small>}{preview.buttons?.length>0&&<div>{preview.buttons.map((button,index)=><span key={`${button.text}:${index}`}>{button.text||button.type}</span>)}</div>}</section>
}
