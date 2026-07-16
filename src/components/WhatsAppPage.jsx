/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bot, CheckCheck, CircleDollarSign, MessageCircle, PauseCircle, RefreshCw, Search, Send, UserRoundCheck, UsersRound } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'
import { PageSkeleton } from './PageSkeleton'
import { normalizeBrazilianPhone } from '../lib/whatsapp'
import { assignConversation, findConversationByPhone, getAttendanceMeta, getConversationIdentifier, hasValidConversationIdentifier, health, listConversations, listMessages, listWhatsAppUsers, pauseAutomation, resumeAutomation, sendManualMessage, startTemplateConversation } from '../services/data/whatsappRepository'
import { updateClientPhone } from '../services/data/clientsRepository'
import { WhatsAppPhoneModal } from './WhatsAppPhoneModal'
import { StartWhatsAppConversationModal } from './StartWhatsAppConversationModal'
import { listCollectionAlerts, markCollectionPaid, updateCollectionStage } from '../services/data/whatsappCollectionsRepository'
import { getOrganizationSettings } from '../services/data/settingsRepository'
import { WhatsAppBatchModal } from './WhatsAppBatchModal'
import { WhatsAppTemplatesPanel } from './WhatsAppTemplatesPanel'
import { WhatsAppUsagePanel } from './WhatsAppUsagePanel'
import { isTemplateAvailable, isTemplateSyncStale, refreshTemplateStatuses } from '../services/whatsapp/templateCatalog'

const tabs = [['inbox','Caixa de entrada'],['collections','Cobranças'],['contacts','Contatos'],['templates','Modelos'],['usage','Uso e custos']]
const fmtTime = value => value ? new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}).format(new Date(value)) : '—'
const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value || 0))
const samePhone = (a,b) => normalizeBrazilianPhone(a) && normalizeBrazilianPhone(a) === normalizeBrazilianPhone(b)
const modeLabel = item => item?.status === 'customer_replied' ? 'Cliente respondeu' : item?.status === 'waiting_customer' ? 'Aguardando resposta' : item?.awaitingHuman ? 'Aguardando atendimento' : item?.automationPaused ? 'Automação pausada' : item?.attendanceMode === 'human' || !item?.botEnabled ? 'Atendimento humano' : 'Bot ativo'

export function WhatsAppPage({ clients = [], contracts = [], installments = [], proposals = [], onNavigate = () => {}, canWrite = false, isAdmin = false }) {
  const [tab,setTab]=useState('inbox'),[conversations,setConversations]=useState([]),[selectedId,setSelectedId]=useState(''),[messages,setMessages]=useState([])
  const [summary,setSummary]=useState({}),[meta,setMeta]=useState({queues:[],statuses:[]}),[users,setUsers]=useState([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all')
  const [loading,setLoading]=useState(true),[messagesLoading,setMessagesLoading]=useState(false),[sending,setSending]=useState(false),[error,setError]=useState(''),[draft,setDraft]=useState('')
  const [collectionTarget,setCollectionTarget]=useState(null),[phoneModal,setPhoneModal]=useState(false),[startModal,setStartModal]=useState(false),[starting,setStarting]=useState(false)
  const [templateStatus,setTemplateStatus]=useState({name:'mugo_alerta_pagamento_pendente',language:'pt_BR',status:'SYNC_ERROR'})
  const [collectionAlerts,setCollectionAlerts]=useState([]),[settings,setSettings]=useState({})
  const [batchOpen,setBatchOpen]=useState(false)
  const sendingRef=useRef(false)
  const actionRef=useRef(false)
  const historyRequestRef=useRef(0)
  const historyControllerRef=useRef(null)
  const optimisticIdRef=useRef(0)
  const [connection,setConnection]=useState('initializing')

  const refresh = useCallback(async (quiet=false, force=false) => {
    if(!quiet)setLoading(true)
    try {
      const rows=await listConversations({}, {force})
      setConversations(rows);setSummary({conversations_open:rows.length});setError('')
      setSelectedId(current=>current&&rows.some(item=>item.waId===current&&hasValidConversationIdentifier(item))?current:'')
    } catch (cause) { setError(cause.message) } finally { if(!quiet)setLoading(false) }
  },[])
  const loadHistory=useCallback(async (conversation,force=false)=>{
    const requestId=++historyRequestRef.current
    historyControllerRef.current?.abort()
    const controller=new AbortController()
    historyControllerRef.current=controller
    if(!hasValidConversationIdentifier(conversation)){setMessages([]);setError(conversation?'Identificador da conversa ausente.':'');return}
    setMessagesLoading(true)
    try{const rows=await listMessages(conversation,80,{force,signal:controller.signal});if(requestId===historyRequestRef.current){setMessages(rows);setError('')}}
    catch(cause){if(cause.name!=='AbortError'&&requestId===historyRequestRef.current)setError(cause.retryable?'O histórico demorou para responder. Tente novamente.':cause.message)}
    finally{if(requestId===historyRequestRef.current)setMessagesLoading(false)}
  },[])
  useEffect(()=>{refresh();Promise.allSettled([listCollectionAlerts(),getOrganizationSettings()]).then(([alertsResult,settingsResult])=>{if(alertsResult.status==='fulfilled')setCollectionAlerts(alertsResult.value);if(settingsResult.status==='fulfilled')setSettings(settingsResult.value)})},[refresh])
  useEffect(()=>{let active=true;health().then(()=>active&&setConnection('connected')).catch(error=>active&&setConnection(error.code==='UPSTREAM_COLD_START'?'initializing':error.code==='UPSTREAM_UNAUTHORIZED'?'auth-error':'unavailable'));return()=>{active=false}},[])
  useEffect(()=>{loadHistory(selectedId)},[selectedId,loadHistory])
  useEffect(()=>()=>historyControllerRef.current?.abort(),[])
  useEffect(()=>{if(!isAdmin||!selectedId)return;let active=true;Promise.allSettled([getAttendanceMeta(),listWhatsAppUsers()]).then(([metaResult,usersResult])=>{if(!active)return;if(metaResult.status==='fulfilled')setMeta(metaResult.value);if(usersResult.status==='fulfilled')setUsers(usersResult.value)});return()=>{active=false}},[isAdmin,selectedId])

  const selected=conversations.find(item=>item.waId===selectedId)
  const client=clients.find(item=>samePhone(item.phone,selected?.phone)||samePhone(item.billing_contact_phone,selected?.phone))
  const clientContracts=contracts.filter(item=>item.client_id===client?.id),clientProposals=proposals.filter(item=>item.client_id===client?.id)
  const clientInstallments=installments.filter(item=>item.client_id===client?.id),openInstallments=clientInstallments.filter(item=>['pending','overdue'].includes(item.status))
  const overdue=openInstallments.filter(item=>item.status==='overdue'||(item.due_date&&new Date(item.due_date)<new Date()))
  const activeAlert=collectionAlerts.find(item=>samePhone(item.wa_id,selected?.phone)),activeCollectionInstallment=installments.find(item=>item.id===activeAlert?.installment_id)
  const filtered=useMemo(()=>conversations.filter(item=>{const haystack=`${item.name} ${item.phone} ${item.preview}`.toLowerCase();if(query&&!haystack.includes(query.toLowerCase()))return false;if(filter==='collection'&&!item.collection)return false;if(filter!=='all'&&filter!=='collection'&&item.status!==filter)return false;return true}),[conversations,query,filter])

  async function mutate(action){if(!selected||!canWrite||actionRef.current||typeof action!=='function')return;actionRef.current=true;try{setError('');await action();await refresh(true,true)}catch(cause){setError(cause.message)}finally{actionRef.current=false}}
  async function send(event){event.preventDefault();const text=draft.trim();if(!selected||!hasValidConversationIdentifier(selected)||!text||sendingRef.current||!canWrite)return;sendingRef.current=true;setSending(true);optimisticIdRef.current+=1;const optimistic={id:`optimistic-${optimisticIdRef.current}`,text,createdAt:null,direction:'out',status:'sending'};setMessages(current=>[...current,optimistic]);try{await sendManualMessage(selected,text);setDraft('');await loadHistory(selected,true)}catch(cause){setMessages(current=>current.filter(item=>item.id!==optimistic.id));setError(cause.message)}finally{sendingRef.current=false;setSending(false)}}
  const collections=installments.filter(item=>['pending','overdue'].includes(item.status)).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)))
  async function openCollection(item){
    const targetClient=clients.find(row=>row.id===item.client_id)
    if(!targetClient){setError('O cliente desta cobrança não foi encontrado.');return}
    const phone=normalizeBrazilianPhone(targetClient.billing_contact_phone||targetClient.phone)
    const target={installment:item,client:targetClient,phone}
    setCollectionTarget(target);setError('')
    if(!phone){setPhoneModal(true);return}
    try{if(isTemplateSyncStale()){const result=await refreshTemplateStatuses(),template=result.templates.find(row=>row.name==='mugo_alerta_pagamento_pendente');if(template)setTemplateStatus(template)}const conversation=await findConversationByPhone(phone);if(conversation){await refresh(true);setSelectedId(conversation.waId);setTab('inbox')}else{setStartModal(true);setError('Nenhuma conversa anterior encontrada. Você pode iniciar uma nova conversa.')}}catch(cause){setError(cause.message)}
  }
  async function savePhone(phone){
    const updated=await updateClientPhone(collectionTarget.client.id,phone)
    setCollectionTarget(current=>({...current,client:updated,phone}))
    setPhoneModal(false);setStartModal(true)
  }
  async function startCollection(){
    if(!collectionTarget||starting)return
    setStarting(true);setError('')
    try{
      const result=await startTemplateConversation({client_id:collectionTarget.client.id,installment_id:collectionTarget.installment.id,phone:collectionTarget.phone,template_name:'mugo_alerta_pagamento_pendente',language:'pt_BR'})
      const waId=getConversationIdentifier(result?.conversation||{phone:collectionTarget.phone})
      setStartModal(false);await refresh(true,true);setSelectedId(waId);setTab('inbox')
    }catch(cause){setError(cause.message||'Não foi possível iniciar a conversa pelo WhatsApp.')}finally{setStarting(false)}
  }
  function suggestCollectionDetails(){
    if(!client||!activeCollectionInstallment)return
    const name=client.contact_name||client.trade_name||client.company_name||'cliente',pix=settings.pix_key||'Chave PIX não configurada'
    setDraft(`Olá, ${name}.\n\nSegue o detalhamento solicitado:\n\nValor: ${money(Math.max(Number(activeCollectionInstallment.amount||0)-Number(activeCollectionInstallment.received_amount||0),0))}\nVencimento: ${activeCollectionInstallment.due_date}\n\nChave PIX:\n${pix}\n\nApós o pagamento, envie o comprovante por aqui.\n\nCaso já tenha realizado o pagamento, desconsidere esta mensagem.`)
  }
  async function markPaid(){
    if(!activeAlert||!activeCollectionInstallment||!window.confirm('Confirma o recebimento deste pagamento?'))return
    try{await markCollectionPaid(activeAlert,activeCollectionInstallment);await refresh(true)}catch(cause){setError(cause.message||'Não foi possível registrar o pagamento.')}
  }
  async function sendBatch(rows){const result={checked:rows.length,eligible:rows.length,sent:0,failed:0,skipped:0,reasons:[]};for(const row of rows){try{await startTemplateConversation({client_id:row.client.id,installment_id:row.item.id,phone:row.phone,template_name:'mugo_alerta_pagamento_pendente',language:'pt_BR'});result.sent+=1}catch(cause){result.failed+=1;result.reasons.push({installment_id:row.item.id,reason:cause.message})}}await refresh(true);return result}

  return <section className="whatsapp-page">
    <PageHeader eyebrow="Operação integrada" title="WhatsApp" description="Atendimento da agência dentro do CRM, com envio e automação executados com segurança pelo MugoZap." actions={<><span className={`whatsapp-connection ${connection}`}>{connection==='connected'?'Conectado':connection==='initializing'?'Inicializando':connection==='auth-error'?'Erro de autenticação':'Indisponível'}</span><button className="button button-secondary" onClick={()=>refresh(false,true)} disabled={loading}><RefreshCw size={15}/>Atualizar</button></>}/>
    <div className="whatsapp-summary">
      <article><MessageCircle/><span>Conversas abertas</span><strong>{summary.conversations_open ?? conversations.length}</strong></article>
      <article><UserRoundCheck/><span>Aguardando humano</span><strong>{summary.waiting_human ?? conversations.filter(x=>x.awaitingHuman).length}</strong></article>
      <article><Bot/><span>Bot ativo</span><strong>{summary.bot_active ?? conversations.filter(x=>modeLabel(x)==='Bot ativo').length}</strong></article>
      <article><PauseCircle/><span>Automação pausada</span><strong>{summary.paused_automation ?? conversations.filter(x=>x.automationPaused).length}</strong></article>
    </div>
    <nav className="whatsapp-tabs" aria-label="Áreas do WhatsApp">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}
    {loading?<PageSkeleton type="dashboard"/>:tab==='inbox'?<div className={`whatsapp-workspace${selected?' has-selection':''}`}>
      <aside className="conversation-list">
        <div className="conversation-tools"><label><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar conversa"/></label><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todas</option><option value="collection">Cobranças</option><option value="waiting_customer">Aguardando cliente</option><option value="customer_replied">Cliente respondeu</option><option value="waiting_finance">Aguardando financeiro</option><option value="negotiating">Em negociação</option><option value="paid">Pagas</option><option value="failed">Falha de envio</option></select></div>
        <div className="conversation-scroll">{filtered.length?filtered.map(item=>{const valid=hasValidConversationIdentifier(item);return <button key={item.id||item.waId} disabled={!valid} className={`conversation-item${selectedId===item.waId?' active':''}`} onClick={()=>valid&&setSelectedId(item.waId)}><span className="contact-avatar">{item.name.slice(0,1).toUpperCase()}</span><span className="conversation-copy"><span><strong>{item.name}</strong><time>{fmtTime(item.updatedAt)}</time></span><small>{valid?item.phone:'Identificador da conversa ausente'}</small><p>{item.preview||'Sem prévia de mensagem'}</p><span className="conversation-badges"><i>{modeLabel(item)}</i>{item.owner&&<i>{item.owner}</i>}{item.collection&&<i className="collection">Cobrança</i>}</span></span>{item.unread>0&&<b>{item.unread}</b>}</button>}):<div className="whatsapp-empty">Nenhuma conversa encontrada.</div>}</div>
      </aside>
      <main className="chat-panel">{selected?<><header><div><button className="mobile-back" onClick={()=>setSelectedId('')}>Voltar</button><strong>{selected.name}</strong><small>{selected.phone} · {modeLabel(selected)}</small></div><div className="chat-actions">{canWrite&&<><button onClick={()=>mutate(()=>assignConversation(selected,''))}>Assumir conversa</button><button onClick={()=>mutate(()=>pauseAutomation(selected))}>Pausar automação</button><button onClick={()=>mutate(()=>resumeAutomation(selected))}>Retomar automação</button></>} </div></header>
        {isAdmin&&users.length>0&&<div className="chat-management"><label>Responsável<select value={selected.owner||''} onChange={e=>mutate(()=>assignConversation(selected,e.target.value))}><option value="">Sem responsável</option>{users.map(user=><option key={user.id||user.email} value={user.name||user.email}>{user.name||user.email}</option>)}</select></label>{meta.statuses?.length>0&&<small>Status disponíveis: {meta.statuses.join(', ')}</small>}</div>}
        <div className="message-history">{messagesLoading?<div className="whatsapp-empty">Carregando histórico…</div>:messages.length?messages.map(message=><article key={message.id} className={message.direction==='out'?'out':'in'}><p>{message.text||'Mensagem sem conteúdo textual'}</p><footer>{message.template&&<span>Template</span>}{message.collection&&<span>Cobrança</span>}<time>{fmtTime(message.createdAt)}</time>{message.direction==='out'&&<CheckCheck size={13} aria-label={message.status||'enviada'}/>}</footer></article>):<div className="whatsapp-empty">Nenhuma mensagem nesta conversa.</div>}</div>
        <form className="message-composer" onSubmit={send}><textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder={canWrite?'Escreva uma resposta manual…':'Seu perfil possui acesso somente para leitura.'} disabled={!canWrite||sending} maxLength={4000}/><button className="button button-primary" disabled={!canWrite||sending||!draft.trim()}><Send size={16}/>{sending?'Enviando…':'Enviar'}</button></form></>:<div className="whatsapp-empty">Selecione uma conversa para abrir o atendimento.</div>}</main>
      <aside className="client-context">{selected?<><header><span>Contexto do cliente</span><strong>{client?.trade_name||client?.company_name||selected.name}</strong><small>{client?'Cliente cadastrado':'Contato não vinculado ao CRM'}</small></header>{client?<><dl><div><dt>Contato</dt><dd>{client.contact_name||'Não informado'}</dd></div><div><dt>Status comercial</dt><dd>{client.status||'Não informado'}</dd></div><div><dt>Contratos</dt><dd>{clientContracts.length}</dd></div><div><dt>Propostas</dt><dd>{clientProposals.length}</dd></div><div><dt>Parcelas pendentes</dt><dd>{openInstallments.length}</dd></div><div><dt>Total em atraso</dt><dd>{money(overdue.reduce((sum,item)=>sum+Number(item.amount||0),0))}</dd></div><div><dt>Próximo vencimento</dt><dd>{openInstallments[0]?.due_date||'Nenhum'}</dd></div></dl>{activeAlert&&activeCollectionInstallment&&<section className="collection-context"><h3>Cobrança vinculada</h3><dl><div><dt>Parcela</dt><dd>{activeCollectionInstallment.reference_month}</dd></div><div><dt>Vencimento</dt><dd>{activeCollectionInstallment.due_date}</dd></div><div><dt>Valor pendente</dt><dd>{money(Math.max(Number(activeCollectionInstallment.amount||0)-Number(activeCollectionInstallment.received_amount||0),0))}</dd></div><div><dt>Status</dt><dd>{activeAlert.status}</dd></div><div><dt>Último alerta</dt><dd>{fmtTime(activeAlert.sent_at)}</dd></div></dl><div className="context-actions"><button onClick={()=>navigator.clipboard.writeText(settings.pix_key||'')} disabled={!settings.pix_key}>Copiar PIX</button><button onClick={suggestCollectionDetails}>Enviar detalhes</button><button onClick={async()=>{await updateCollectionStage(activeAlert.id,'negotiating');await refresh(true)}}>Marcar em negociação</button><button onClick={markPaid}>Marcar como pago</button></div></section>}<div className="context-actions"><button onClick={()=>onNavigate('clients')}>Abrir cliente</button>{clientContracts.length>0&&<button onClick={()=>onNavigate('contracts')}>Abrir contrato</button>}<button onClick={()=>onNavigate('finance')}>Abrir financeiro</button></div></>:<div className="context-empty"><AlertCircle size={18}/><p>O telefone não corresponde a um cliente cadastrado.</p><button onClick={()=>onNavigate('clients')}>Criar cliente</button></div>}</>:null}</aside>
    </div>:tab==='collections'?<div className="whatsapp-table-card"><header><div><CircleDollarSign/><div><strong>Cobranças</strong><small>Base financeira oficial: parcelas do CRM. O primeiro contato utiliza exclusivamente o template aprovado.</small></div></div></header>{collections.length?<div className="whatsapp-table">{collections.map(item=>{const rowClient=clients.find(row=>row.id===item.client_id),phone=rowClient?.billing_contact_phone||rowClient?.phone,known=conversations.some(c=>samePhone(c.phone,phone));return <article key={item.id}><div><strong>{rowClient?.company_name||item.clients?.company_name||'Cliente não informado'}</strong><small>{item.due_date} · {item.status}</small></div><strong>{money(item.amount)}</strong><button onClick={()=>openCollection(item)} disabled={!canWrite} title={!canWrite?'Seu perfil possui acesso somente para leitura.':phone?(known?'Abrir a conversa existente':'Localizar ou iniciar conversa'):'Cadastrar número e continuar'}>{phone?(known?'Abrir conversa':'Iniciar conversa'):'Cadastrar número'}</button><button onClick={()=>openCollection(item)} disabled={!canWrite} title={!canWrite?'Seu perfil não pode enviar alertas.':'Revisar e enviar o template aprovado'}>Enviar alerta</button></article>})}</div>:<div className="whatsapp-empty">Nenhuma parcela pendente encontrada.</div>}</div>:tab==='contacts'?<div className="whatsapp-table-card"><header><div><UsersRound/><div><strong>Contatos</strong><small>Clientes do CRM relacionados às conversas pelo telefone normalizado.</small></div></div></header><div className="whatsapp-table">{clients.map(item=>{const conversation=conversations.find(c=>samePhone(c.phone,item.phone)||samePhone(c.phone,item.billing_contact_phone));return <article key={item.id}><div><strong>{item.trade_name||item.company_name}</strong><small>{item.contact_name||'Sem contato'} · {item.phone||item.billing_contact_phone||'Sem telefone'}</small></div><span>{item.status}</span><button disabled={!conversation} onClick={()=>{setSelectedId(conversation.waId);setTab('inbox')}}>Abrir conversa</button><button onClick={()=>onNavigate('clients')}>Abrir cliente</button></article>})}</div></div>:<div className="template-card"><header><strong>mugo_alerta_pagamento_pendente</strong><span>Utilidade · pt_BR</span></header><p>Finalidade: iniciar alerta financeiro. Interação esperada: Consultar cobrança.</p><dl><div><dt>Uso</dt><dd>Alertas financeiros revisados pela equipe</dd></div><div><dt>Variáveis</dt><dd>Primeiro nome seguro do cliente</dd></div><div><dt>Ação</dt><dd>Consultar cobrança</dd></div></dl><FeedbackMessage type="warning">A aprovação e o status oficial do template continuam sendo gerenciados na Meta.</FeedbackMessage></div>}
    {tab==='collections'&&<button className="button secondary whatsapp-batch-trigger" onClick={()=>setBatchOpen(true)}>Envio em lote</button>}
    {tab==='templates'&&<WhatsAppTemplatesPanel onStatusesChanged={templates=>{const template=templates.find(item=>item.name==='mugo_alerta_pagamento_pendente');if(template)setTemplateStatus(template)}}/>}
    {tab==='usage'&&<WhatsAppUsagePanel/>}
    {phoneModal&&collectionTarget&&<WhatsAppPhoneModal client={collectionTarget.client} onClose={()=>setPhoneModal(false)} onSave={savePhone}/>}
    {startModal&&collectionTarget&&<StartWhatsAppConversationModal client={collectionTarget.client} installment={collectionTarget.installment} phone={collectionTarget.phone} canWrite={canWrite} loading={starting} templateConfigured={isTemplateAvailable('mugo_alerta_pagamento_pendente',[templateStatus])} templateStatus={templateStatus.status} onClose={()=>setStartModal(false)} onStart={startCollection}/>}
    {batchOpen&&<WhatsAppBatchModal installments={installments} clients={clients} contracts={contracts} alerts={collectionAlerts} templateStatus={templateStatus.status} templateAvailable={isTemplateAvailable('mugo_alerta_pagamento_pendente',[templateStatus])} onClose={()=>setBatchOpen(false)} onSend={sendBatch}/>}
  </section>
}
