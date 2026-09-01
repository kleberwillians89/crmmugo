import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCheck, CircleDollarSign, Copy, ExternalLink, FileText, Link2, MessageCircle, MoreHorizontal, RefreshCw, Search, Send, Sparkles, UsersRound } from 'lucide-react'
import { FeedbackMessage } from './FeedbackMessage'
import { PageSkeleton } from './PageSkeleton'
import { normalizeBrazilianPhone } from '../lib/whatsapp'
import { assignConversation, closeConversation, createCrmWhatsAppContact, findConversationByPhone, getAttendanceMeta, getConversationIdentifier, getTemplateTestAccess, hasValidConversationIdentifier, health, listConversations, listCrmWhatsAppContacts, listMessages, listWhatsAppUsers, markConversationRead, pauseAutomation, resumeAutomation, sendManualMessage, sendTemplateMessage, startTemplateConversation } from '../services/data/whatsappRepository'
import { updateClientPhone } from '../services/data/clientsRepository'
import { WhatsAppPhoneModal } from './WhatsAppPhoneModal'
import { StartWhatsAppConversationModal } from './StartWhatsAppConversationModal'
import { listCollectionAlerts, markCollectionPaid, updateCollectionStage } from '../services/data/whatsappCollectionsRepository'
import { getOrganizationSettings } from '../services/data/settingsRepository'
import { WhatsAppBatchModal } from './WhatsAppBatchModal'
import { WhatsAppTemplatesPanel } from './WhatsAppTemplatesPanel'
import { WhatsAppUsagePanel } from './WhatsAppUsagePanel'
import { isTemplateAvailable, isTemplateSyncStale, refreshTemplateStatuses } from '../services/whatsapp/templateCatalog'
import { formatPhoneForDisplay } from '../services/whatsapp/phoneNormalization'
import { linkConversationToClient, listConversationLinks, unlinkConversation } from '../services/data/whatsappClientLinksRepository'
import { WhatsAppClientLinkModal } from './WhatsAppClientLinkModal'
import { WhatsAppConversationTemplateDrawer } from './WhatsAppConversationTemplateDrawer'
import { whatsappVisualConversations, whatsappVisualMessages, whatsappVisualTemplates } from '../services/whatsapp/visualFixtures'
import { getSupabaseClient } from '../lib/supabase/client'
import { WhatsAppAutomationPanel } from './WhatsAppAutomationPanel'
import { WhatsAppSystemStatusPanel } from './WhatsAppSystemStatusPanel'
import { isAmbiguousTemplateSendOutcome } from '../services/whatsapp/templateSendAttempt'
import { WhatsAppNewContactModal } from './WhatsAppNewContactModal'
import { ProductBreadcrumbs } from './ProductBreadcrumbs'
import './WhatsAppPage.css'

const SECTION_PRESENTATION = {
  inbox: { title: 'Caixa de entrada', description: 'Conversas, atendimento e contexto do cliente em um único workspace.', tabs: [['inbox', 'Caixa de entrada']] },
  contacts: { title: 'Contatos', description: 'Contatos canônicos do CRM e seus vínculos com conversas.', tabs: [['contacts', 'Contatos']] },
  automations: { title: 'Automações', description: 'Fluxos de comunicação e sua operação atual.', tabs: [['automations', 'Automações']] },
  templates: { title: 'Templates', description: 'Modelos aprovados e disponíveis para comunicação.', tabs: [['templates', 'Templates']] },
  collections: { title: 'Cobranças', description: 'Acompanhamento financeiro e contatos de cobrança.', tabs: [['collections', 'Cobranças']] },
  channel: { title: 'WhatsApp', description: 'Conexão do canal, consumo e diagnóstico técnico.', tabs: [['usage', 'Uso e custos'], ['status', 'Status técnico']] },
}
const fmtTime = value => value ? new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}).format(new Date(value)) : '—'
const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value || 0))
const samePhone = (a,b) => normalizeBrazilianPhone(a) && normalizeBrazilianPhone(a) === normalizeBrazilianPhone(b)
const modeLabel = item => item?.status === 'customer_replied' ? 'Cliente respondeu' : item?.status === 'waiting_customer' ? 'Aguardando resposta' : item?.awaitingHuman ? 'Aguardando atendimento' : item?.automationPaused ? 'Automação pausada' : item?.attendanceMode === 'human' || !item?.botEnabled ? 'Atendimento humano' : 'Bot ativo'
const auditFrontend = (stage, operation, detail = {}) => console.info('[whatsapp_audit]', {event:'whatsapp_operation_trace',stage,operation,occurred_at:new Date().toISOString(),...detail})
const realtimeLog=(event,detail={})=>{if(import.meta.env.DEV)console.info(`[WhatsAppRealtime] ${event}`,detail)}
const mergeMessages=(current,incoming)=>{
  const rows=new Map(current.map(item=>[String(item.provider_message_id||item.idempotencyKey||item.id),item]))
  for(const item of incoming){
    const key=String(item.provider_message_id||item.idempotencyKey||item.id)
    const optimistic=[...rows.entries()].find(([,row])=>item.provider_message_id&&row.provider_message_id===item.provider_message_id||item.idempotencyKey&&row.idempotencyKey===item.idempotencyKey)
    if(optimistic&&optimistic[0]!==key)rows.delete(optimistic[0])
    rows.set(key,{...(optimistic?.[1]||rows.get(key)),...item})
  }
  return [...rows.values()].sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0))
}
const conversationKey=item=>item?.id||item?.waId||''

export function WhatsAppPage({ section = 'inbox', page = 'inbox', clients = [], contracts = [], installments = [], proposals = [], onNavigate = () => {}, onAskAI = () => {}, canWrite = false, isAdmin = false }) {
  const presentation = SECTION_PRESENTATION[section] || SECTION_PRESENTATION.inbox
  const tabs = presentation.tabs
  const visualMock=import.meta.env.DEV&&new URLSearchParams(window.location.search).has('whatsapp_mock')
  const visualWindowClosed=visualMock&&new URLSearchParams(window.location.search).get('window')==='closed'
  const visualConversations=useMemo(()=>visualMock?whatsappVisualConversations.map((item,index)=>index===0?{...item,serviceWindowOpen:!visualWindowClosed}:item):[],[visualMock,visualWindowClosed])
  const [tab,setTab]=useState(tabs[0][0]),[conversations,setConversations]=useState(visualConversations),[selectedId,setSelectedId]=useState(visualMock?conversationKey(visualConversations[0]):''),[messages,setMessages]=useState(visualMock?whatsappVisualMessages:[])
  const [summary,setSummary]=useState({}),[meta,setMeta]=useState({queues:[],statuses:[]}),[users,setUsers]=useState([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all')
  const [loading,setLoading]=useState(true),[messagesLoading,setMessagesLoading]=useState(false),[sending,setSending]=useState(false),[error,setError]=useState(''),[draft,setDraft]=useState('')
  const [collectionTarget,setCollectionTarget]=useState(null),[phoneModal,setPhoneModal]=useState(false),[startModal,setStartModal]=useState(false),[starting,setStarting]=useState(false),[templateSyncing,setTemplateSyncing]=useState(false)
  const [templateStatus,setTemplateStatus]=useState({name:'mugo_alerta_pagamento_pendente',language:'pt_BR',status:'SYNC_ERROR'})
  const [collectionAlerts,setCollectionAlerts]=useState([]),[settings,setSettings]=useState({})
  const [conversationLinks,setConversationLinks]=useState([]),[linkModal,setLinkModal]=useState(false),[contextOpen,setContextOpen]=useState(false),[actionFeedback,setActionFeedback]=useState('')
  const [actionsOpen,setActionsOpen]=useState(false)
  const [templateDrawerOpen,setTemplateDrawerOpen]=useState(false)
  const [batchOpen,setBatchOpen]=useState(false)
  const [whatsappContacts,setWhatsappContacts]=useState([]),[contactsLoading,setContactsLoading]=useState(false),[newContactOpen,setNewContactOpen]=useState(false),[contactSaving,setContactSaving]=useState(false)
  const sendingRef=useRef(false)
  const actionRef=useRef(false)
  const historyRequestRef=useRef(0)
  const historyControllerRef=useRef(null)
  const optimisticIdRef=useRef(0)
  const historyEndRef=useRef(null)
  const historyContainerRef=useRef(null)
  const composerTextareaRef=useRef(null)
  const shouldAutoScrollRef=useRef(true)
  const conversationsRef=useRef([])
  const selectedIdRef=useRef(selectedId)
  const realtimeConnectedRef=useRef(false)
  const [connection,setConnection]=useState('initializing')
  const [realtimeState,setRealtimeState]=useState('connecting')
  const templateSendEnabled=import.meta.env.VITE_WHATSAPP_TEMPLATE_SEND_ENABLED==='true'
  const templateTestEnabled=import.meta.env.VITE_WHATSAPP_TEMPLATE_TEST_ENABLED==='true'
  const demoMode=import.meta.env.VITE_WHATSAPP_DEMO_MODE==='true'
  const canCompose=(canWrite||visualMock)&&!demoMode

  const refresh = useCallback(async (quiet=false, force=false) => {
    if(visualMock){setConversations(visualConversations);setSummary({conversations_open:visualConversations.length});setLoading(false);return visualConversations}
    if(!quiet)setLoading(true)
    try {
      auditFrontend('frontend_sent','list_conversations',{payload:{limit:200},force})
      const rows=await listConversations({}, {force})
      auditFrontend('frontend_received','list_conversations',{body_received:rows,row_count:rows.length})
      setConversations(rows);setSummary({conversations_open:rows.length});setError('')
      setSelectedId(current=>current&&rows.some(item=>conversationKey(item)===current&&hasValidConversationIdentifier(item))?current:'')
      return rows
    } catch (cause) { handleOperationError(cause) } finally { if(!quiet)setLoading(false) }
  },[visualMock,visualConversations])
  const loadContacts=useCallback(async()=>{setContactsLoading(true);try{setWhatsappContacts(await listCrmWhatsAppContacts({limit:200}))}catch(cause){setError(cause.message||'Não foi possível carregar os contatos do WhatsApp.')}finally{setContactsLoading(false)}},[])
  const loadHistory=useCallback(async (conversation,force=false)=>{
    if(visualMock){setMessages(whatsappVisualMessages);setMessagesLoading(false);return}
    const requestId=++historyRequestRef.current
    historyControllerRef.current?.abort()
    const controller=new AbortController()
    historyControllerRef.current=controller
    if(!hasValidConversationIdentifier(conversation)){if(conversation)setError('Identificador da conversa ausente.');return}
    setMessagesLoading(true)
    try{
      auditFrontend('frontend_sent','get_conversation_messages',{frontend_request_id:requestId,payload:{conversation_id:conversation.id||null,wa_id:getConversationIdentifier(conversation),limit:80},force})
      const rows=await listMessages(conversation,80,{force,signal:controller.signal})
      auditFrontend('frontend_received','get_conversation_messages',{frontend_request_id:requestId,body_received:rows,row_count:rows.length})
      if(requestId===historyRequestRef.current){setMessages(current=>mergeMessages(current,rows));setError('')}
    }
    catch(cause){if(cause.name!=='AbortError'&&requestId===historyRequestRef.current){if(cause.status===403)setConnection('auth-error');setError(cause.status===403?'Sua sessão expirou. Entre novamente no CRM.':cause.message)}}
    finally{if(requestId===historyRequestRef.current)setMessagesLoading(false)}
  },[visualMock])
  useEffect(()=>{refresh();Promise.allSettled([listCollectionAlerts(),getOrganizationSettings(),listConversationLinks()]).then(([alertsResult,settingsResult,linksResult])=>{if(alertsResult.status==='fulfilled')setCollectionAlerts(alertsResult.value);if(settingsResult.status==='fulfilled')setSettings(settingsResult.value);if(linksResult.status==='fulfilled')setConversationLinks(linksResult.value)})},[refresh])
  useEffect(()=>setTab(presentation.tabs[0][0]),[section,presentation])
  useEffect(()=>{if(tab==='contacts'||tab==='templates')loadContacts()},[tab,loadContacts])
  useEffect(()=>{let active=true;health().then(()=>active&&setConnection('connected')).catch(error=>active&&setConnection(error.code==='UPSTREAM_COLD_START'?'initializing':error.code==='UPSTREAM_UNAUTHORIZED'?'auth-error':'unavailable'));return()=>{active=false}},[])
  useEffect(()=>{conversationsRef.current=conversations},[conversations])
  useEffect(()=>{selectedIdRef.current=selectedId},[selectedId])
  useEffect(()=>{setMessages([]);shouldAutoScrollRef.current=true;const conversation=conversationsRef.current.find(item=>conversationKey(item)===selectedId);if(conversation){loadHistory(conversation);if(canWrite)markConversationRead(conversation).then(()=>setConversations(current=>current.map(item=>conversationKey(item)===selectedId?{...item,unread:0}:item))).catch(()=>{})}},[selectedId,loadHistory,canWrite])
  useEffect(()=>{
    if(!selectedId||visualMock)return
    let active=true,timer
    const poll=async()=>{
      const conversation=conversationsRef.current.find(item=>conversationKey(item)===selectedId)
      if(document.visibilityState==='visible'&&conversation)await loadHistory(conversation,true)
      if(active)timer=setTimeout(poll,realtimeConnectedRef.current?60000:30000)
    }
    realtimeLog('fallback_polling',{resource:'active_conversation'})
    timer=setTimeout(poll,30000)
    return()=>{active=false;clearTimeout(timer)}
  },[selectedId,loadHistory,visualMock])
  useEffect(()=>{
    if(visualMock)return
    let active=true,timer
    const poll=async()=>{if(document.visibilityState==='visible')await refresh(true,true);if(active)timer=setTimeout(poll,realtimeConnectedRef.current?60000:30000)}
    realtimeLog('fallback_polling',{resource:'conversation_list'})
    timer=setTimeout(poll,30000)
    return()=>{active=false;clearTimeout(timer)}
  },[refresh,visualMock])
  useEffect(()=>{
    if(visualMock)return
    const supabase=getSupabaseClient()
    if(!supabase)return
    const onChange=payload=>{realtimeLog(payload.table==='whatsapp_messages'?'message_change':'conversation_update',{eventType:payload.eventType});refresh(true,true);const conversation=conversationsRef.current.find(item=>conversationKey(item)===selectedIdRef.current);if(conversation)loadHistory(conversation,true)}
    // O tópico precisa ser único por montagem. supabase-js reaproveita canais pelo tópico
    // (RealtimeClient.channel devolve a instância existente), então um nome fixo faz uma
    // remontagem via navegação SPA cair numa instância anterior ainda em teardown e
    // chamar .on()/.subscribe() nela lança — o erro subia até o AppErrorBoundary.
    // Um teardown que não terminou também deixa canais órfãos; removemo-los aqui.
    for(const stale of [...supabase.getChannels()])
      if(typeof stale?.topic==='string'&&stale.topic.startsWith('realtime:whatsapp-crm'))supabase.removeChannel(stale)
    const channel=supabase.channel(`whatsapp-crm-${crypto.randomUUID()}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'whatsapp_messages'},onChange)
      .on('postgres_changes',{event:'*',schema:'public',table:'whatsapp_conversations'},onChange)
      .on('postgres_changes',{event:'*',schema:'public',table:'whatsapp_collection_alerts'},onChange)
      .on('postgres_changes',{event:'*',schema:'public',table:'whatsapp_conversation_links'},onChange)
      .subscribe(status=>{
        const next=status==='SUBSCRIBED'?'online':status==='CHANNEL_ERROR'||status==='TIMED_OUT'?'fallback':status==='CLOSED'?'unavailable':'reconnecting'
        realtimeConnectedRef.current=next==='online'
        setRealtimeState(next)
        realtimeLog(next,{status})
      })
    return()=>{realtimeConnectedRef.current=false;realtimeLog('disconnected');supabase.removeChannel(channel)}
  },[loadHistory,refresh,visualMock])
  useEffect(()=>{if(shouldAutoScrollRef.current)historyEndRef.current?.scrollIntoView({block:'end'})},[messages])
  useEffect(()=>{if(selectedId)auditFrontend('react_rendered','get_conversation_messages',{selected_id:selectedId,row_count:messages.length,message_ids:messages.map(item=>item.id)})},[selectedId,messages])
  useEffect(()=>()=>historyControllerRef.current?.abort(),[])
  useEffect(()=>{if(!isAdmin||!selectedId)return;let active=true;Promise.allSettled([getAttendanceMeta(),listWhatsAppUsers()]).then(([metaResult,usersResult])=>{if(!active)return;if(metaResult.status==='fulfilled')setMeta(metaResult.value);if(usersResult.status==='fulfilled')setUsers(usersResult.value)});return()=>{active=false}},[isAdmin,selectedId])

  const selected=conversations.find(item=>conversationKey(item)===selectedId)
  const selectedIdentifier=getConversationIdentifier(selected)
  const selectedLink=conversationLinks.find(item=>item.wa_id===selectedIdentifier)
  const client=clients.find(item=>item.id===selectedLink?.client_id)||clients.find(item=>samePhone(item.phone,selected?.phone)||samePhone(item.billing_contact_phone,selected?.phone))
  const clientContracts=contracts.filter(item=>item.client_id===client?.id),clientProposals=proposals.filter(item=>item.client_id===client?.id)
  const clientInstallments=installments.filter(item=>item.client_id===client?.id),openInstallments=clientInstallments.filter(item=>['pending','overdue'].includes(item.status))
  const overdue=openInstallments.filter(item=>item.status==='overdue'||(item.due_date&&new Date(item.due_date)<new Date()))
  const activeAlert=collectionAlerts.find(item=>samePhone(item.wa_id,selected?.phone)),activeCollectionInstallment=installments.find(item=>item.id===activeAlert?.installment_id)
  const filtered=useMemo(()=>conversations.filter(item=>{const haystack=`${item.name} ${item.phone} ${item.preview}`.toLowerCase();if(query&&!haystack.includes(query.toLowerCase()))return false;if(filter==='collection'&&!item.collection)return false;if(filter!=='all'&&filter!=='collection'&&item.status!==filter)return false;return true}),[conversations,query,filter])

  function handleOperationError(cause){const message=cause.status===403&&['AUTH_SESSION_MISSING','AUTH_INVALID_TOKEN','AUTH_BLOCKED'].includes(cause.code)?'Sua sessão expirou. Entre novamente no CRM.':cause.code==='UPSTREAM_TIMEOUT'||cause.status===504?'O MugoZap demorou mais que o esperado. Os dados anteriores foram preservados.':cause.message;setError(`${message}${cause.requestId?` Protocolo: ${cause.requestId}.`:''}`);if(['AUTH_SESSION_MISSING','AUTH_INVALID_TOKEN','AUTH_BLOCKED'].includes(cause.code))setConnection('auth-error');else if(cause.code==='UPSTREAM_TIMEOUT'||cause.status===504)setConnection('unstable')}
  async function signInAgain(){await getSupabaseClient()?.auth.signOut();window.location.reload()}
  async function mutate(action,success='Ação concluída.'){if(demoMode){setActionFeedback('Modo demonstração: esta ação não foi executada.');return}if(!selected||!canWrite||actionRef.current||typeof action!=='function')return;actionRef.current=true;try{setError('');setActionFeedback('');await action();setActionFeedback(success);await refresh(true,true)}catch(cause){handleOperationError(cause)}finally{actionRef.current=false}}
  async function linkClient(clientId,options){const link=await linkConversationToClient(selected,clientId,options);setConversationLinks(current=>[...current.filter(item=>item.wa_id!==link.wa_id),link]);setActionFeedback('Conversa vinculada ao cliente.')}
  async function unlinkClient(){if(!selectedLink||!window.confirm('Desvincular esta conversa do cliente?'))return;await unlinkConversation(selected);setConversationLinks(current=>current.filter(item=>item.wa_id!==selectedIdentifier));setActionFeedback('Vínculo removido.')}
  function handleTabKey(event,index){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setTab(tabs[next][0]);event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus()}
  async function send(event, retryMessage=null){
    event?.preventDefault()
    const text=(retryMessage?.text||draft).trim()
    if(demoMode){setActionFeedback('Modo demonstração: nenhuma mensagem foi enviada.');return}
    if(!selected||!hasValidConversationIdentifier(selected)||!text||sendingRef.current||!canWrite)return
    if(selected.serviceWindowOpen===false){setError('A janela de atendimento está encerrada. Use um modelo aprovado para retomar a conversa.');setTemplateDrawerOpen(true);return}
    sendingRef.current=true;setSending(true);optimisticIdRef.current+=1
    const idempotencyKey=retryMessage?.idempotencyKey||crypto.randomUUID()
    const optimistic={id:retryMessage?.id||`optimistic-${optimisticIdRef.current}`,text,createdAt:new Date().toISOString(),direction:'out',status:'sending',idempotencyKey}
    setMessages(current=>[...current.filter(item=>item.id!==optimistic.id),optimistic])
    try{
      const result=await sendManualMessage(selected,text,idempotencyKey)
      const providerMessageId=result?.provider_message_id||result?.message_id||result?.messages?.[0]?.id
      setMessages(current=>current.map(item=>item.id===optimistic.id?{...item,id:providerMessageId||item.id,provider_message_id:providerMessageId||'',status:'sent'}:item))
      setDraft('');if(composerTextareaRef.current)composerTextareaRef.current.style.height='44px';setError('');await loadHistory(selected,true)
    }catch(cause){
      const ambiguous=cause.code==='UPSTREAM_TIMEOUT'||cause.status===504
      setMessages(current=>current.map(item=>item.id===optimistic.id?{...item,status:ambiguous?'unknown':'failed',error_message:cause.message}:item))
      handleOperationError(cause)
    }finally{sendingRef.current=false;setSending(false)}
  }
  function handleDraftChange(event){setDraft(event.target.value);event.target.style.height='44px';event.target.style.height=`${Math.min(event.target.scrollHeight,120)}px`}
  function handleComposerKeyDown(event){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send(event)}}
  const collections=installments.filter(item=>['pending','overdue'].includes(item.status)).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)))
  async function openCollection(item){
    const targetClient=clients.find(row=>row.id===item.client_id)
    if(!targetClient){setError('O cliente desta cobrança não foi encontrado.');return}
    const phone=normalizeBrazilianPhone(targetClient.billing_contact_phone||targetClient.phone)
    const target={installment:item,client:targetClient,phone}
    setCollectionTarget(target);setError('')
    if(!phone){setPhoneModal(true);return}
    try{if(isTemplateSyncStale()){const result=await refreshTemplateStatuses(),template=result.templates.find(row=>row.name==='mugo_alerta_pagamento_pendente');if(template)setTemplateStatus(template)}const conversation=await findConversationByPhone(phone);if(conversation){await refresh(true);setSelectedId(conversationKey(conversation));onNavigate('inbox')}else{setStartModal(true);setError('Nenhuma conversa anterior encontrada. Você pode iniciar uma nova conversa.')}}catch(cause){setError(cause.message)}
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
      const recipient=collectionTarget.client.contact_name||collectionTarget.client.company_name||'o cliente'
      const startedConversation=result?.conversation
        ? {...result.conversation,name:result.conversation.name||recipient}
        : null
      const waId=getConversationIdentifier(startedConversation||{phone:collectionTarget.phone})

      setStartModal(false)
      setActionFeedback(
        result?.already_sent
          ? `Envio anterior para ${recipient} reconciliado sem reenvio.`
          : `Alerta enviado com sucesso para ${recipient}.`
      )

      // A resposta do backend já contém a conversa persistida.
      // Colocamos essa conversa na Inbox e abrimos imediatamente.
      if(startedConversation){
        const key=conversationKey(startedConversation)

        setConversations(current=>[
          startedConversation,
          ...current.filter(item=>conversationKey(item)!==key),
        ])

        conversationsRef.current=[
          startedConversation,
          ...conversationsRef.current.filter(item=>conversationKey(item)!==key),
        ]

        setSelectedId(key)
      }
      onNavigate('inbox')

      // Depois reconciliamos silenciosamente com o banco.
      const rows=await refresh(true,true)
      const canonical=rows?.find(item=>item.waId===waId)

      if(canonical){
        setSelectedId(conversationKey(canonical))
      }else if(startedConversation){
        // Se a leitura ainda não enxergou a conversa recém-criada,
        // preserva a conversa devolvida pelo backend e mantém o chat aberto.
        const key=conversationKey(startedConversation)

        setConversations(current=>[
          startedConversation,
          ...current.filter(item=>conversationKey(item)!==key),
        ])

        conversationsRef.current=[
          startedConversation,
          ...conversationsRef.current.filter(item=>conversationKey(item)!==key),
        ]

        setSelectedId(key)
      }
    }catch(cause){setError(cause.message||'Não foi possível iniciar a conversa pelo WhatsApp.')}finally{setStarting(false)}
  }
  async function syncCollectionTemplate(){
    if(templateSyncing)return
    setTemplateSyncing(true);setError('')
    try{const result=await refreshTemplateStatuses({force:true}),template=result.templates.find(row=>row.name==='mugo_alerta_pagamento_pendente'&&row.language==='pt_BR');if(template)setTemplateStatus(template)}
    catch(cause){setError(cause.message||'Não foi possível consultar o template na Meta.')}
    finally{setTemplateSyncing(false)}
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
  async function createWhatsAppContact(payload){setContactSaving(true);try{await createCrmWhatsAppContact(payload);await loadContacts();setNewContactOpen(false);setActionFeedback('Contato do WhatsApp cadastrado.')}finally{setContactSaving(false)}}
  async function sendApprovedTemplate(payload){
    const templateAuthorized=canWrite&&(templateSendEnabled||(templateTestEnabled&&isAdmin))
    if(!templateAuthorized)throw Object.assign(new Error('Envio de modelos ainda não está liberado para este usuário.'),{code:'TEMPLATE_SEND_DISABLED'})
    // A origem da tentativa é dona da chave. Gerar fallback aqui recriaria a brecha:
    // cada nova invocação poderia se tornar, indevidamente, um novo envio lógico.
    const idempotencyKey=String(payload.idempotency_key||'')
    if(!/^[A-Za-z0-9_-]{16,120}$/.test(idempotencyKey))throw Object.assign(new Error('Não foi possível identificar esta tentativa de envio.'),{code:'IDEMPOTENCY_KEY_MISSING'})
    const optimisticId=`template-${idempotencyKey}`,targetsSelected=samePhone(payload.recipient,selectedIdentifier)
    const optimistic={id:optimisticId,idempotencyKey,conversation_id:targetsSelected?selectedIdentifier:'',text:payload.preview?.body||`Modelo: ${payload.template_name}`,template_name:payload.template_name,template_display:payload.template?.display||payload.template_name,template:true,type:'template',direction:'out',status:'sending',createdAt:new Date().toISOString()}
    if(targetsSelected)setMessages(current=>mergeMessages(current,[optimistic]))
    let result
    const requestClientId=payload.client_id||(targetsSelected?client?.id:'')
    const requestPayload={recipient:normalizeBrazilianPhone(payload.recipient),template_name:payload.template_name,language:payload.language||'pt_BR',components:Array.isArray(payload.components)?payload.components:[],idempotency_key:idempotencyKey,contract_mode:'minimal',...(requestClientId?{client_id:requestClientId}:{})}
    try{result=await sendTemplateMessage(requestPayload)}
    catch(cause){if(targetsSelected)setMessages(current=>current.map(item=>item.id===optimisticId?{...item,status:isAmbiguousTemplateSendOutcome(cause)?'unknown':'failed',error_message:cause.message}:item));throw cause}
    const waId=getConversationIdentifier(result?.conversation||{phone:payload.recipient})
    const providerMessageId=result?.provider_message_id||result?.message_id
    if(targetsSelected)setMessages(current=>mergeMessages(current,[{...optimistic,id:providerMessageId||optimisticId,provider_message_id:providerMessageId||'',conversation_id:waId,status:'sent'}]))
    setActionFeedback(`Modelo enviado · ${providerMessageId}`)
    const rows=await refresh(true,true)
    const canonical=waId?rows?.find(item=>item.waId===waId):null
    if(canonical){setSelectedId(conversationKey(canonical));await loadHistory(canonical,true)}
    return result
  }
  const checkTemplateTestAccess=template=>getTemplateTestAccess(selectedIdentifier,template.name,template.language||'pt_BR',{force:true})

  const showChannelStatus = section === 'channel' || section === 'inbox'
  return <section className={`whatsapp-page section-${section}`}>
    <header className="whatsapp-compact-header"><div className="whatsapp-page-heading"><ProductBreadcrumbs page={page} compact/><div><h1>{presentation.title}</h1>{showChannelStatus&&<span className={`whatsapp-status-badge ${connection}`}>{loading?'Verificando':connection==='connected'?'Conectado':connection==='unstable'?'Instável':connection==='auth-error'?'Indisponível':connection==='initializing'?'Verificando':'Indisponível'}</span>}</div><p>{presentation.description}</p>{showChannelStatus&&<small>Realtime: {realtimeState==='online'?'online':realtimeState==='connecting'?'conectando':realtimeState==='reconnecting'?'reconectando':realtimeState==='fallback'?'modo fallback':'indisponível'}</small>}</div>{section==='inbox'&&<dl><div><dt>Conversas</dt><dd>{summary.conversations_open??conversations.length}</dd></div><div><dt>Aguardando</dt><dd>{summary.waiting_human??conversations.filter(x=>x.awaitingHuman).length}</dd></div><div><dt>Bot ativo</dt><dd>{summary.bot_active??conversations.filter(x=>modeLabel(x)==='Bot ativo').length}</dd></div></dl>}<button className="button secondary" onClick={()=>refresh(false,true)} disabled={loading}><RefreshCw className={loading?'spin':''} size={15}/><span>{loading?'Atualizando…':'Atualizar'}</span></button></header>
    {tabs.length>1&&<nav className="whatsapp-tabs" role="tablist" aria-label="Áreas do canal WhatsApp">{tabs.map(([id,label],index)=><button key={id} role="tab" aria-selected={tab===id} tabIndex={tab===id?0:-1} className={tab===id?'active':''} onKeyDown={event=>handleTabKey(event,index)} onClick={()=>setTab(id)}>{label}</button>)}</nav>}
    {error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}
    {connection==='auth-error'&&<button className="button whatsapp-sign-in-again" onClick={signInAgain}>Entrar novamente</button>}
    {actionFeedback&&<FeedbackMessage type="success">{actionFeedback}</FeedbackMessage>}
    {loading?<PageSkeleton type="dashboard"/>:tab==='inbox'?<div className={`whatsapp-workspace${selected?' has-selection':''}${client?' has-context':''}`}>
      <aside className="conversation-list">
        <div className="conversation-tools"><label><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar conversa"/></label><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todas</option><option value="collection">Cobranças</option><option value="waiting_customer">Aguardando cliente</option><option value="customer_replied">Cliente respondeu</option><option value="waiting_finance">Aguardando financeiro</option><option value="negotiating">Em negociação</option><option value="paid">Pagas</option><option value="failed">Falha de envio</option></select></div>
        <div className="conversation-scroll">{filtered.length?filtered.map(item=>{const valid=hasValidConversationIdentifier(item);return <button key={conversationKey(item)} disabled={!valid} className={`conversation-item status-${item.status}${selectedId===conversationKey(item)?' active':''}`} onClick={()=>valid&&setSelectedId(conversationKey(item))}><span className="contact-avatar">{item.name.slice(0,1).toUpperCase()}</span><span className="conversation-copy"><span><strong>{item.name}</strong><time>{fmtTime(item.updatedAt)}</time></span><small>{valid?formatPhoneForDisplay(getConversationIdentifier(item)):'Identificador da conversa ausente'}</small><p>{item.preview||'Sem prévia de mensagem'}</p><span className="conversation-badges"><i>{modeLabel(item)}</i>{item.owner&&<i>{item.owner}</i>}{item.collection&&<i className="collection">Cobrança</i>}</span></span>{item.unread>0&&<b>{item.unread}</b>}</button>}):<div className="whatsapp-empty">Nenhuma conversa encontrada.</div>}</div>
      </aside>
      <main className="chat-panel">{selected?<><header><div className="chat-contact"><button className="mobile-back" onClick={()=>setSelectedId('')}>Voltar</button><span className="contact-avatar">{selected.name.slice(0,1).toUpperCase()}</span><div><strong>{selected.name}</strong><small>{formatPhoneForDisplay(selectedIdentifier)} · {modeLabel(selected)}{selected.owner?` · ${selected.owner}`:''}</small></div></div><div className="chat-actions"><button onClick={onAskAI} aria-label="Pergunte à Mugô" title="Pergunte à Mugô"><Sparkles size={16}/></button><button className="context-toggle" onClick={()=>setContextOpen(true)}>Contato</button>{canWrite&&<div className="chat-action-menu"><button aria-label="Mais ações" aria-expanded={actionsOpen} onClick={()=>setActionsOpen(current=>!current)}><MoreHorizontal size={17}/></button>{actionsOpen&&<div><button disabled={actionRef.current} onClick={()=>mutate(()=>assignConversation(selected,''),'Conversa assumida.')}>Assumir</button><button disabled={actionRef.current} onClick={()=>mutate(()=>pauseAutomation(selected),'Automação pausada.')}>Pausar bot</button><button disabled={actionRef.current} onClick={()=>mutate(()=>resumeAutomation(selected),'Automação retomada.')}>Retomar bot</button><button disabled={actionRef.current} onClick={()=>mutate(()=>closeConversation(selected),'Conversa encerrada.')}>Encerrar</button><button disabled={actionRef.current} onClick={()=>setLinkModal(true)}><Link2 size={13}/>{client?'Alterar vínculo':'Vincular cliente'}</button>{selectedLink&&<button disabled={actionRef.current} onClick={unlinkClient}>Desvincular</button>}<button onClick={()=>navigator.clipboard.writeText(`+${selectedIdentifier}`)}><Copy size={13}/>Copiar número</button><a className="whatsapp-action-link" href={`https://wa.me/${selectedIdentifier}`} target="_blank" rel="noreferrer"><ExternalLink size={13}/>Abrir WhatsApp</a></div>}</div>}</div></header>
        <div className="chat-management">{isAdmin&&users.length>0&&<><label>Responsável<select value={selected.owner||''} onChange={e=>mutate(()=>assignConversation(selected,e.target.value))}><option value="">Sem responsável</option>{users.map(user=><option key={user.id||user.email} value={user.name||user.email}>{user.name||user.email}</option>)}</select></label>{meta.statuses?.length>0&&<small>Status disponíveis: {meta.statuses.join(', ')}</small>}</>}</div>
        <div className="message-history" ref={historyContainerRef} onScroll={event=>{const element=event.currentTarget;shouldAutoScrollRef.current=element.scrollHeight-element.scrollTop-element.clientHeight<120}}>{messagesLoading&&!messages.length?<div className="whatsapp-empty">Carregando histórico…</div>:messages.length?messages.map(message=><article key={message.provider_message_id||message.idempotencyKey||message.id} className={`${message.direction==='out'?'out':'in'} status-${message.status||'unknown'}`}><p>{message.text||`Mensagem ${message.type||'sem conteúdo textual'}`}</p><footer>{message.template&&<span>Modelo: {message.template_display||message.template_name||'WhatsApp'}</span>}{message.collection&&<span>Cobrança</span>}<time>{fmtTime(message.createdAt)}</time>{message.direction==='out'&&<><CheckCheck size={13} aria-label={message.status||'enviada'}/><em>{message.status==='sending'?'enviando':message.status==='sent'||message.status==='accepted'?'enviado':message.status==='delivered'?'entregue':message.status==='read'?'lido':message.status==='unknown'?'resultado desconhecido':message.status==='failed'?'falhou':message.status}</em></>}</footer>{message.error_message&&<small>{message.error_message}</small>}</article>):<div className="whatsapp-empty whatsapp-chat-empty"><MessageCircle/><strong>Nenhuma mensagem registrada.</strong><span>O histórico canônico do CRM ainda não possui mensagens para esta conversa.</span></div>}<span ref={historyEndRef}/></div>
        {selected.serviceWindowOpen===false&&<FeedbackMessage type="warning">A janela de atendimento está encerrada. Use um modelo aprovado para retomar a conversa.</FeedbackMessage>}
        <form className={`message-composer${selected.serviceWindowOpen===false?' window-closed':''}`} onSubmit={send}><button type="button" className="composer-attachment" aria-label="Anexar arquivo" title="Anexos ainda não disponíveis">+</button><button type="button" className="composer-template" onClick={()=>setTemplateDrawerOpen(true)} aria-label="Abrir modelos aprovados"><FileText size={15}/><span>Modelos</span></button><textarea ref={composerTextareaRef} rows="1" value={draft} onChange={handleDraftChange} onKeyDown={handleComposerKeyDown} placeholder={!canCompose?'Seu perfil possui acesso somente para leitura.':selected.serviceWindowOpen===false?'Use um modelo aprovado para retomar a conversa.':'Escreva uma resposta manual…'} disabled={!canCompose||sending||selected.serviceWindowOpen===false} maxLength={4000} aria-label="Mensagem"/><button className="button button-primary" aria-label="Enviar mensagem" disabled={!canCompose||sending||selected.serviceWindowOpen===false||!draft.trim()}><Send size={16}/><span>{sending?'Enviando…':'Enviar'}</span></button></form></>:<div className="whatsapp-empty">Selecione uma conversa para abrir o atendimento.</div>}</main>
      {contextOpen&&<button className="client-context-backdrop" onClick={()=>setContextOpen(false)} aria-label="Fechar informações do contato"/>}<aside className={`client-context${contextOpen?' open':''}`}>{selected?<><button className="client-context-close" onClick={()=>setContextOpen(false)}>Fechar</button><header><span>Contexto do cliente</span><strong>{client?.trade_name||client?.company_name||selected.name}</strong><small>{client?'Cliente cadastrado':'Contato não vinculado ao CRM'}</small></header>{client?<><dl><div><dt>Contato</dt><dd>{client.contact_name||'Não informado'}</dd></div><div><dt>Status comercial</dt><dd>{client.status||'Não informado'}</dd></div><div><dt>Contratos</dt><dd>{clientContracts.length}</dd></div><div><dt>Propostas</dt><dd>{clientProposals.length}</dd></div><div><dt>Parcelas pendentes</dt><dd>{openInstallments.length}</dd></div><div><dt>Total em atraso</dt><dd>{money(overdue.reduce((sum,item)=>sum+Number(item.amount||0),0))}</dd></div><div><dt>Próximo vencimento</dt><dd>{openInstallments[0]?.due_date||'Nenhum'}</dd></div></dl>{activeAlert&&activeCollectionInstallment&&<section className="collection-context"><h3>Cobrança vinculada</h3><dl><div><dt>Parcela</dt><dd>{activeCollectionInstallment.reference_month}</dd></div><div><dt>Vencimento</dt><dd>{activeCollectionInstallment.due_date}</dd></div><div><dt>Valor pendente</dt><dd>{money(Math.max(Number(activeCollectionInstallment.amount||0)-Number(activeCollectionInstallment.received_amount||0),0))}</dd></div><div><dt>Status</dt><dd>{activeAlert.status}</dd></div><div><dt>Último alerta</dt><dd>{fmtTime(activeAlert.sent_at)}</dd></div></dl><div className="context-actions"><button onClick={()=>navigator.clipboard.writeText(settings.pix_key||'')} disabled={!settings.pix_key}>Copiar PIX</button><button onClick={suggestCollectionDetails}>Enviar detalhes</button><button onClick={async()=>{await updateCollectionStage(activeAlert.id,'negotiating');await refresh(true)}}>Marcar em negociação</button><button onClick={markPaid}>Marcar como pago</button></div></section>}<div className="context-actions"><button onClick={()=>onNavigate('clients')}>Abrir cliente</button>{clientContracts.length>0&&<button onClick={()=>onNavigate('contracts')}>Abrir contrato</button>}<button onClick={()=>onNavigate('finance')}>Abrir financeiro</button></div></>:<div className="context-empty"><AlertCircle size={18}/><p>O telefone não corresponde a um cliente cadastrado.</p><button onClick={()=>onNavigate('clients')}>Criar cliente</button></div>}</>:null}</aside>
    </div>:tab==='collections'?<div className="whatsapp-table-card"><header><div><CircleDollarSign/><div><strong>Cobranças</strong><small>Base financeira oficial: parcelas do CRM. O primeiro contato utiliza exclusivamente o template aprovado.</small></div></div></header>{collections.length?<div className="whatsapp-table">{collections.map(item=>{const rowClient=clients.find(row=>row.id===item.client_id),phone=rowClient?.billing_contact_phone||rowClient?.phone,known=conversations.some(c=>samePhone(c.phone,phone));return <article key={item.id}><div><strong>{rowClient?.company_name||item.clients?.company_name||'Cliente não informado'}</strong><small>{item.due_date} · {item.status}</small></div><strong>{money(item.amount)}</strong><button onClick={()=>openCollection(item)} disabled={!canWrite} title={!canWrite?'Seu perfil possui acesso somente para leitura.':phone?(known?'Abrir a conversa existente':'Localizar ou iniciar conversa'):'Cadastrar número e continuar'}>{phone?(known?'Abrir conversa':'Iniciar conversa'):'Cadastrar número'}</button><button onClick={()=>openCollection(item)} disabled={!canWrite} title={!canWrite?'Seu perfil não pode enviar alertas.':'Revisar e enviar o template aprovado'}>Enviar alerta</button></article>})}</div>:<div className="whatsapp-empty">Nenhuma parcela pendente encontrada.</div>}</div>:tab==='contacts'?<div className="whatsapp-table-card"><header><div><UsersRound/><div><strong>Contatos</strong><small>Contatos canônicos do CRM vinculados ao canal WhatsApp desta organização.</small></div></div><button className="button" disabled={!canWrite} onClick={()=>setNewContactOpen(true)}>+ Novo contato</button></header>{contactsLoading?<div className="whatsapp-empty">Carregando contatos…</div>:whatsappContacts.length?<div className="whatsapp-table">{whatsappContacts.map(item=>{const conversation=conversations.find(c=>samePhone(c.phone,item.waId)),linkedClient=clients.find(client=>client.id===item.client_id);return <article key={item.id}><div><strong>{item.name}</strong><small>{formatPhoneForDisplay(item.waId)}{linkedClient?` · ${linkedClient.trade_name||linkedClient.company_name}`:' · Sem cliente vinculado'}</small></div><span>{conversation?'Com conversa':'Somente contato'}</span><button disabled={!conversation} onClick={()=>{setSelectedId(conversationKey(conversation));onNavigate('inbox')}}>Abrir conversa</button>{linkedClient&&<button onClick={()=>onNavigate('clients')}>Abrir cliente</button>}</article>})}</div>:<div className="whatsapp-empty">Nenhum contato cadastrado.</div>}</div>:null}
    {tab==='collections'&&<button className="button secondary whatsapp-batch-trigger" onClick={()=>setBatchOpen(true)}>Envio em lote</button>}
    {tab==='templates'&&<WhatsAppTemplatesPanel clients={clients} contacts={whatsappContacts} onSendTemplate={sendApprovedTemplate} onStatusesChanged={templates=>{const template=templates.find(item=>item.name==='mugo_alerta_pagamento_pendente');if(template)setTemplateStatus(template)}}/>}
    {tab==='usage'&&<WhatsAppUsagePanel/>}
    {tab==='automations'&&<WhatsAppAutomationPanel canWrite={canWrite}/>}
    {tab==='status'&&<WhatsAppSystemStatusPanel/>}
    {phoneModal&&collectionTarget&&<WhatsAppPhoneModal client={collectionTarget.client} onClose={()=>setPhoneModal(false)} onSave={savePhone}/>}
    {startModal&&collectionTarget&&<StartWhatsAppConversationModal client={collectionTarget.client} installment={collectionTarget.installment} phone={collectionTarget.phone} canWrite={canWrite} loading={starting} syncing={templateSyncing} templateConfigured={isTemplateAvailable('mugo_alerta_pagamento_pendente',[templateStatus])} templateStatus={templateStatus.status} templateError={templateStatus.error} onClose={()=>setStartModal(false)} onStart={startCollection} onSync={syncCollectionTemplate}/>}
    {batchOpen&&<WhatsAppBatchModal installments={installments} clients={clients} contracts={contracts} alerts={collectionAlerts} templateStatus={templateStatus.status} templateAvailable={isTemplateAvailable('mugo_alerta_pagamento_pendente',[templateStatus])} onClose={()=>setBatchOpen(false)} onSend={sendBatch}/>}
    {linkModal&&selected&&<WhatsAppClientLinkModal conversation={selected} clients={clients} onClose={()=>setLinkModal(false)} onLink={linkClient}/>}
    {newContactOpen&&<WhatsAppNewContactModal clients={clients} saving={contactSaving} onClose={()=>setNewContactOpen(false)} onSave={createWhatsAppContact}/>}
    <WhatsAppConversationTemplateDrawer open={templateDrawerOpen} conversation={selected} client={client||{contact_name:selected?.name}} contract={clientContracts[0]} installment={openInstallments[0]} owner={selected?.owner} enabled={templateSendEnabled||templateTestEnabled} testMode={!templateSendEnabled&&templateTestEnabled} authorized={canWrite&&(templateSendEnabled||isAdmin)} templatesOverride={visualMock?whatsappVisualTemplates:null} onCheckAccess={checkTemplateTestAccess} onClose={()=>setTemplateDrawerOpen(false)} onSend={sendApprovedTemplate}/>
  </section>
}
