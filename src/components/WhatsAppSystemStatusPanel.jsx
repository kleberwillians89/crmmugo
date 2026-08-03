import { useEffect, useState } from 'react'
import { getWhatsAppSystemHealth } from '../services/data/whatsappRepository'

const labels={edge_function:'WhatsApp API',supabase:'Banco',mugozap_backend:'Backend MugoZap',meta_configured:'Meta configurada',whatsapp_connection_found:'Conexão WhatsApp'}
export function WhatsAppSystemStatusPanel(){
  const [data,setData]=useState(null),[error,setError]=useState('')
  const load=()=>getWhatsAppSystemHealth({force:true}).then(setData).catch(cause=>setError(cause.message))
  useEffect(()=>{load()},[])
  const entries=data?Object.entries(labels).map(([key,label])=>[label,data[key]]):[['CRM','online'],['Banco','verificando'],['Realtime','verificando'],['WhatsApp API','verificando'],['Templates','verificando'],['Backend MugoZap','verificando'],['Automações','desativadas'],['IA','desativada']]
  return <section className="dashboard-panel"><header className="templates-header"><div><span>Demonstração segura</span><h2>Status do sistema</h2><p>Diagnóstico sanitizado, sem exibir credenciais.</p></div><button className="button secondary" onClick={load}>Atualizar</button></header>{error&&<p className="feedback-message error">{error}</p>}<div className="health-grid">{entries.map(([label,status])=><article key={label}><span>{label}</span><strong>{status===true?'online':status===false?'indisponível':String(status)}</strong></article>)}</div></section>
}
