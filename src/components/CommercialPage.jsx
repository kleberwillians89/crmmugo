import {useEffect,useMemo,useState} from 'react'
import {CalendarClock,ExternalLink,Flame,MessageCircle,RefreshCw,Target,X} from 'lucide-react'
import {PageHeader} from './PageHeader'
import {FeedbackMessage} from './FeedbackMessage'
import {COMMERCIAL_STAGES,listCommercialOpportunities,requestNotionBriefing,updateOpportunityStage} from '../services/data/commercialRepository'
import {useAuth} from '../contexts/AuthContext'

const labels={new_lead:'Novo lead',in_service:'Em atendimento',qualifying:'Qualificando',qualified:'Qualificado',meeting:'Reunião',proposal:'Proposta',negotiation:'Negociação',won:'Fechado',lost:'Perdido'}
const temperatureLabels={cold:'Frio',warm:'Morno',hot:'Quente'}
const money=value=>value==null?'Não informado':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value))
const dateTime=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'Não informado'
const yesNo=value=>value===true?'Sim':value===false?'Não':'Não informado'

function DetailRow({label,value}){if(value===null||value===undefined||value==='')return null;return <div><dt>{label}</dt><dd>{value}</dd></div>}

export function CommercialPage({onNavigate}){
  const {canWrite}=useAuth()
  const [items,setItems]=useState([]),[selected,setSelected]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[feedback,setFeedback]=useState('')
  const load=()=>{setLoading(true);setError('');return listCommercialOpportunities().then(rows=>{setItems(rows);setSelected(current=>current?rows.find(item=>item.id===current.id)||null:null)}).catch(cause=>setError(cause.message)).finally(()=>setLoading(false))}
  useEffect(()=>{let active=true;listCommercialOpportunities().then(rows=>active&&setItems(rows)).catch(cause=>active&&setError(cause.message)).finally(()=>active&&setLoading(false));return()=>{active=false}},[])
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const metrics=useMemo(()=>{
    const tasks=items.flatMap(item=>item.crm_tasks||[]).filter(task=>task.task_type==='follow_up'&&!['completed','cancelled'].includes(task.status))
    return{
      newLeads:items.filter(item=>['new_lead','in_service'].includes(item.stage)).length,
      qualifying:items.filter(item=>item.stage==='qualifying').length,
      hot:items.filter(item=>item.temperature==='hot'&&!['won','lost'].includes(item.stage)).length,
      followups:tasks.filter(task=>task.due_date===today).length,
      overdue:tasks.filter(task=>task.due_date&&task.due_date<today).length,
      pipeline:items.filter(item=>!['won','lost'].includes(item.stage)&&item.estimated_value!=null).reduce((sum,item)=>sum+Number(item.estimated_value||0),0),
    }
  },[items,today])
  async function move(item,stage){try{await updateOpportunityStage(item.id,stage);await load()}catch(cause){setError(cause.message)}}
  async function briefing(item){try{await requestNotionBriefing(item.id);setFeedback('Briefing enfileirado para o Notion.');await load()}catch(cause){setError(cause.message)}}
  function openConversation(item){window.history.replaceState({},'',`/comunicacao/caixa-de-entrada?conversation=${item.conversation_id}`);onNavigate('inbox')}
  const selectedQualification=selected?.commercial_qualifications?.[0]||{}

  return <div className="commercial-page">
    <PageHeader eyebrow="Central Comercial" title="Comercial" description="Leads e oportunidades do primeiro contato ao fechamento, com o CRM como fonte da verdade." actions={<button className="button secondary" onClick={load} disabled={loading}><RefreshCw size={15}/>Atualizar</button>}/>
    {error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}{feedback&&<FeedbackMessage type="success">{feedback}</FeedbackMessage>}
    <section className="commercial-summary">
      <article><MessageCircle/><span><b>{metrics.newLeads}</b> novos</span></article>
      <article><Target/><span><b>{metrics.qualifying}</b> em qualificação</span></article>
      <article><Flame/><span><b>{metrics.hot}</b> quentes</span></article>
      <article><CalendarClock/><span><b>{metrics.followups}</b> follow-ups hoje</span></article>
      <article><CalendarClock/><span><b>{metrics.overdue}</b> atrasados</span></article>
      {metrics.pipeline>0&&<article><Target/><span><b>{money(metrics.pipeline)}</b> pipeline potencial</span></article>}
    </section>
    <section className="commercial-kanban" aria-label="Pipeline comercial">
      {COMMERCIAL_STAGES.map(stage=><div className="commercial-column" key={stage}>
        <header><strong>{labels[stage]}</strong><span>{items.filter(item=>item.stage===stage).length}</span></header>
        <div>{items.filter(item=>item.stage===stage).map(item=>{
          const q=item.commercial_qualifications?.[0]||{},brief=item.commercial_briefing_outbox?.[0]
          return <article className="commercial-card" key={item.id} role="button" tabIndex="0" onClick={()=>setSelected(item)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(item)}}}>
            <div className="commercial-card-heading"><small>{item.source||'Origem não informada'}</small><span className={`temperature ${item.temperature||'cold'}`}>{temperatureLabels[item.temperature]||'Frio'}</span></div>
            <h3>{item.clients?.company_name||item.name}</h3>
            <p>{item.clients?.contact_name||'Contato não informado'} · {(item.service_interests||[]).join(' + ')||'Interesse em descoberta'}</p>
            <p className="commercial-card-summary">{item.conversation_summary||item.main_problem||'Aguardando resumo da conversa.'}</p>
            <dl className="commercial-card-facts"><DetailRow label="Urgência" value={item.urgency||q.urgency}/><DetailRow label="Estimativa" value={item.estimated_value!=null?money(item.estimated_value):null}/><DetailRow label="Última interação" value={item.last_interaction_at?dateTime(item.last_interaction_at):null}/><DetailRow label="Próximo passo" value={item.next_action}/><DetailRow label="Prazo" value={item.next_action_at?dateTime(item.next_action_at):null}/><DetailRow label="Responsável" value={item.team_members?.name}/></dl>
            <label onClick={event=>event.stopPropagation()}>Etapa<select value={item.stage} disabled={!canWrite} onChange={event=>move(item,event.target.value)}>{COMMERCIAL_STAGES.map(option=><option value={option} key={option}>{labels[option]}</option>)}</select></label>
            <footer onClick={event=>event.stopPropagation()}>{item.conversation_id&&<button onClick={()=>openConversation(item)}>Abrir conversa</button>}{canWrite&&['qualified','meeting','proposal','negotiation'].includes(item.stage)&&!brief?.external_url&&<button onClick={()=>briefing(item)}>Gerar briefing</button>}{brief?.external_url&&<a href={brief.external_url} target="_blank" rel="noreferrer">Notion <ExternalLink size={12}/></a>}</footer>
          </article>
        })}</div>
      </div>)}
    </section>
    {selected&&<><button className="commercial-drawer-backdrop" aria-label="Fechar detalhes" onClick={()=>setSelected(null)}/><aside className="commercial-drawer" aria-label="Detalhes da oportunidade">
      <header><div><small>Oportunidade comercial</small><h2>{selected.clients?.company_name||selected.name}</h2><p>{selected.clients?.contact_name||'Contato não informado'}</p></div><button aria-label="Fechar" onClick={()=>setSelected(null)}><X size={18}/></button></header>
      <div className="commercial-drawer-scroll">
        <section><h3>Resumo operacional</h3><p className="structured-summary">{selected.conversation_summary||'Resumo ainda não disponível.'}</p></section>
        <section><h3>Qualificação</h3><dl><DetailRow label="Temperatura" value={`${temperatureLabels[selected.temperature]||'Frio'}${selected.temperature_reason?` — ${selected.temperature_reason}`:''}`}/><DetailRow label="Classificação" value={selected.lead_kind}/><DetailRow label="Situação atual" value={selectedQualification.current_situation}/><DetailRow label="Problema" value={selectedQualification.main_problem||selected.main_problem}/><DetailRow label="Objetivo" value={selectedQualification.objective}/><DetailRow label="Orçamento" value={selectedQualification.budget!=null?money(selectedQualification.budget):selected.budget!=null?money(selected.budget):null}/><DetailRow label="Prazo" value={selectedQualification.timeline||selected.timeline}/><DetailRow label="Urgência" value={selectedQualification.urgency||selected.urgency}/><DetailRow label="Participa da decisão" value={yesNo(selectedQualification.decision_maker)}/><DetailRow label="Próximo passo" value={selected.next_action}/><DetailRow label="Prazo do próximo passo" value={selected.next_action_at?dateTime(selected.next_action_at):null}/><DetailRow label="Tags" value={(selected.tags||[]).join(', ')}/></dl></section>
        <section><h3>Origem</h3><dl><DetailRow label="Origem" value={selected.source}/><DetailRow label="Campanha" value={selected.campaign}/><DetailRow label="Anúncio" value={selected.ad_name}/><DetailRow label="UTM source" value={selected.utm_source}/><DetailRow label="UTM medium" value={selected.utm_medium}/><DetailRow label="UTM campaign" value={selected.utm_campaign}/><DetailRow label="UTM content" value={selected.utm_content}/></dl></section>
        <section><h3>Tarefas</h3>{selected.crm_tasks?.length?<ul>{selected.crm_tasks.map(task=><li key={task.id}><strong>{task.title}</strong><span>{task.status} · {task.due_date||'sem prazo'} · {task.priority}</span></li>)}</ul>:<p>Nenhuma tarefa vinculada.</p>}</section>
      </div>
      <footer>{selected.conversation_id&&<button className="button" onClick={()=>openConversation(selected)}>Abrir conversa</button>}<button className="button secondary" onClick={()=>setSelected(null)}>Fechar</button></footer>
    </aside></>}
  </div>
}
