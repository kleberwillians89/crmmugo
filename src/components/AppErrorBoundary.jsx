import { Component } from 'react'
import { operationalLog } from '../lib/observability'

const SENSITIVE=/(?:bearer\s+)?eyJ[A-Za-z0-9._-]{20,}|(?:access|refresh|id)?[_-]?tokens?["'\s:=]+[^\s"',}]+|(?:api[_-]?key|apikey|authorization|password|secret|session)["'\s:=]+[^\s"',}]+/gi
const sanitize=value=>String(value??'').slice(0,4000).replace(SENSITIVE,'[redacted]').slice(0,600)
const suspectedCause=message=>/is not a function/i.test(message)?'callback prop ou handler indefinido'
  :/before initialization|is not defined|Cannot access/i.test(message)?'ordem de inicialização/hoisting de módulo'
  :/subscribe|channel|join multiple times|after `?subscribe/i.test(message)?'ciclo de vida de canal realtime'
  :/undefined|null/i.test(message)&&/reading|properties of/i.test(message)?'valor undefined/null tratado como objeto/array'
  :null
// Só nomes de componentes, sem caminhos de bundle nem args.
const componentTrail=stack=>sanitize(stack).split('\n').map(line=>line.trim().replace(/^(?:at\s+|in\s+)/,'').replace(/\s+\(.*$/,'').replace(/\s+@.*$/,'')).filter(Boolean).slice(0,8).join(' < ')

export class AppErrorBoundary extends Component {
  constructor(props){super(props);this.state={error:null}}
  static getDerivedStateFromError(error){return{error}}
  componentDidCatch(error,info){
    const message=sanitize(error?.message)
    const detail={
      name:sanitize(error?.name)||'Error',
      message,
      route:(typeof window!=='undefined'&&window.location?.pathname)||'',
      componentStack:componentTrail(info?.componentStack),
      suspectedCause:suspectedCause(message),
    }
    // Antes o erro real ficava escondido em produção (log só em DEV).
    console.error('[CRM] Runtime error',detail)
    try{operationalLog({service:'react',type:'error-boundary',status:'error',error:detail})}catch{/* observabilidade é best-effort */}
  }
  render(){if(!this.state.error)return this.props.children;return <main className="runtime-error-page"><section><span>CRM Mugô</span><h1>Não foi possível carregar esta página.</h1><p>Tente novamente. Se o problema continuar, volte ao painel ou recarregue a aplicação.</p><div><button onClick={()=>this.setState({error:null})}>Tentar novamente</button><button onClick={()=>{window.history.pushState({},'','/');this.setState({error:null});window.dispatchEvent(new PopStateEvent('popstate'))}}>Voltar ao painel</button><button onClick={()=>window.location.reload()}>Recarregar aplicação</button></div></section></main>}
}
