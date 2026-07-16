import { Component } from 'react'
export class AppErrorBoundary extends Component {
  constructor(props){super(props);this.state={error:null}}
  static getDerivedStateFromError(error){return{error}}
  componentDidCatch(error,info){if(import.meta.env.DEV)console.error('[CRM] Runtime error',{name:error?.name,message:error?.message,componentStack:info?.componentStack||'',suspectedProp:/is not a function/i.test(error?.message||'')?'callback prop or handler':null})}
  render(){if(!this.state.error)return this.props.children;return <main className="runtime-error-page"><section><span>CRM Mugô</span><h1>Não foi possível carregar esta página.</h1><p>Tente novamente. Se o problema continuar, volte ao painel ou recarregue a aplicação.</p><div><button onClick={()=>this.setState({error:null})}>Tentar novamente</button><button onClick={()=>{window.history.pushState({},'','/');this.setState({error:null});window.dispatchEvent(new PopStateEvent('popstate'))}}>Voltar ao painel</button><button onClick={()=>window.location.reload()}>Recarregar aplicação</button></div></section></main>}
}
