import {useEffect,useState} from 'react'
import {MessageCircle,RefreshCw} from 'lucide-react'
import {PageHeader} from './PageHeader'
import {FeedbackMessage} from './FeedbackMessage'
import {listOperationalIntegrations} from '../services/data/taskIntegrationsRepository'

const copy={whatsapp:{name:'WhatsApp',description:'Canal central, caixa de entrada, comandos internos, automações e atendimento.',icon:MessageCircle}}
const state=(_provider,item)=>item?.last_error?'Erro':item?.enabled?(item.status==='degraded'?'Sincronizando':'Conectado'):'Não configurado'
export function IntegrationsPage({onNavigate}){
  const [items,setItems]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const load=()=>{setLoading(true);setError('');return listOperationalIntegrations().then(setItems).catch((cause)=>setError(cause.message)).finally(()=>setLoading(false))}
  useEffect(()=>{let active=true;listOperationalIntegrations().then((rows)=>{if(active)setItems(rows)}).catch((cause)=>{if(active)setError(cause.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[])
  return <div className="integrations-page"><PageHeader eyebrow="Administração" title="Canal conectado" description="O CRMugo é a fonte única da verdade. O WhatsApp é o canal habilitado para atendimento e comandos internos." actions={<button className="button secondary" disabled={loading} onClick={load}><RefreshCw size={15}/> Atualizar</button>}/>{error&&<FeedbackMessage type="error">{error}</FeedbackMessage>}<section className="integration-directory" aria-label="Canal disponível">{['whatsapp'].map((provider)=>{const value=items.find((item)=>item.provider===provider),meta=copy[provider],Icon=meta.icon,current=state(provider,value);return <article key={provider}><Icon size={18}/><div><strong>{meta.name}</strong><p>{meta.description}</p><small className={`integration-state ${current==='Conectado'?'online':current==='Erro'?'error':''}`}>{current}{value?.enabled&&value?.last_synced_at?` · última atualização ${new Date(value.last_synced_at).toLocaleString('pt-BR')}`:''}</small>{value?.enabled&&value?.last_error&&<small>Verifique a configuração e os logs administrativos.</small>}</div><button className="button secondary" onClick={()=>onNavigate?.('whatsapp')}>Abrir</button></article>})}</section></div>
}
