import {useEffect,useState} from 'react'
import {Columns3,MessageCircle,NotebookPen,RefreshCw} from 'lucide-react'
import {PageHeader} from './PageHeader'
import {FeedbackMessage} from './FeedbackMessage'
import {listOperationalIntegrations} from '../services/data/taskIntegrationsRepository'

const copy={whatsapp:{name:'WhatsApp',description:'Canal central, Inbox, automações e atendimento.',icon:MessageCircle},trello:{name:'Trello',description:'Projeção idempotente das tarefas do CRM para o board operacional.',icon:Columns3},notion:{name:'Notion',description:'Projeção idempotente das tarefas para a base operacional.',icon:NotebookPen}}
const state=(item)=>item?.last_error?'Erro':item?.enabled?(item.status==='degraded'?'Sincronizando':'Conectado'):'Não configurado'
export function IntegrationsPage({onNavigate}){
  const [items,setItems]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const load=()=>{setLoading(true);setError('');return listOperationalIntegrations().then(setItems).catch((cause)=>setError(cause.message)).finally(()=>setLoading(false))}
  useEffect(()=>{let active=true;listOperationalIntegrations().then((rows)=>{if(active)setItems(rows)}).catch((cause)=>{if(active)setError(cause.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[])
  return <div className="integrations-page"><PageHeader eyebrow="Administração" title="Integrações" description="Saúde das superfícies conectadas. O CRM permanece como fonte única da verdade." actions={<button className="button secondary" disabled={loading} onClick={load}><RefreshCw size={15}/> Atualizar</button>}/>{error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}<section className="integration-directory" aria-label="Integrações disponíveis">{['whatsapp','trello','notion'].map((provider)=>{const value=items.find((item)=>item.provider===provider),meta=copy[provider],Icon=meta.icon,current=state(value);return <article key={provider}><Icon size={18}/><div><strong>{meta.name}</strong><p>{meta.description}</p><small className={`integration-state ${current==='Conectado'?'online':current==='Erro'?'error':''}`}>{current}{value?.last_synced_at?` · última sincronização ${new Date(value.last_synced_at).toLocaleString('pt-BR')}`:''}</small>{value?.last_error&&<small>Verifique a configuração e os logs administrativos.</small>}</div>{provider==='whatsapp'?<button className="button secondary" onClick={()=>onNavigate?.('whatsapp')}>Abrir</button>:<span className="integration-server-note">Configuração server-side</span>}</article>})}</section></div>
}
