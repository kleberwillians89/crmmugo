import { useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'

const seed=[
  {id:'demo-inactive-30d',name:'Reativação após 30 dias',trigger:'customer_inactive_30d',status:'draft',runs:0},
  {id:'demo-handoff',name:'Transferência por baixa confiança',trigger:'message_received',status:'paused',runs:0},
]

export function WhatsAppAutomationPanel(){
  const [items,setItems]=useState(seed),[selected,setSelected]=useState(seed[0]?.id),[feedback,setFeedback]=useState('')
  const act=(id,action)=>{
    if(action==='duplicate'){const source=items.find(item=>item.id===id);setItems(current=>[...current,{...source,id:`${id}-copy-${current.length}`,name:`${source.name} (cópia)`,status:'draft'}])}
    else setItems(current=>current.map(item=>item.id===id?{...item,status:action==='activate'?'active':action==='pause'?'paused':action==='archive'?'archived':item.status}:item))
    setFeedback('Modo demonstração: configuração alterada somente nesta tela; nenhuma automação foi executada.')
  }
  return <section className="dashboard-panel"><header className="templates-header"><div><span>Preparação estrutural</span><h2>Automações</h2><p>Fluxos versionados, sem execução real no modo demonstração.</p></div><button className="button" onClick={()=>{const id=`draft-${Date.now()}`;setItems(current=>[...current,{id,name:'Novo fluxo',trigger:'lead_created',status:'draft',runs:0}]);setSelected(id)}}>Criar automação</button></header>{feedback&&<FeedbackMessage type="info">{feedback}</FeedbackMessage>}<div className="whatsapp-table">{items.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.trigger} · {item.status} · {item.runs} execuções</small></div><button onClick={()=>setSelected(item.id)}>Editar</button><button onClick={()=>act(item.id,item.status==='active'?'pause':'activate')}>{item.status==='active'?'Pausar':'Ativar'}</button><button onClick={()=>act(item.id,'duplicate')}>Duplicar</button><button onClick={()=>act(item.id,'archive')}>Arquivar</button><button onClick={()=>setFeedback(`Execuções de ${item.name}: nenhuma execução real.`)}>Execuções</button></article>)}</div>{selected&&<FeedbackMessage type="warning">Editor visual completo não faz parte desta entrega. O fluxo selecionado permanece sem executor.</FeedbackMessage>}</section>
}
