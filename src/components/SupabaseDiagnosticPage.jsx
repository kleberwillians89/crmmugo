import {useState} from 'react'
import {PageHeader} from './PageHeader'
import {FeedbackMessage} from './FeedbackMessage'
import {useAuth} from '../contexts/AuthContext'
import {AI_PROVIDER} from '../config/aiConfig'
import {testMugoAssistantConnection} from '../services/ai/aiAssistantService'
import {runSystemDiagnostics} from '../services/data/systemDiagnosticsRepository'
const ok=(label,detail)=>({label,status:'ok',detail}),fail=(label,error)=>({label,status:'error',detail:classify(error)})
function classify(error){const text=String(error?.message||error||'');if(/column|relation|function|schema cache/i.test(text))return 'A atualização estrutural correspondente ainda não foi aplicada.';if(/row-level|permission|42501/i.test(text))return 'A política de acesso precisa ser revisada.';if(/bucket/i.test(text))return 'O armazenamento privado não foi encontrado ou não está acessível.';return text&&!/object Object/i.test(text)?text:'Falha na verificação.'}
export function SupabaseDiagnosticPage(){
  const auth=useAuth(),[checks,setChecks]=useState([]),[running,setRunning]=useState(false),[aiRunning,setAiRunning]=useState(false),[financial,setFinancial]=useState(null)
  async function run(){if(running)return;setRunning(true);try{const result=await runSystemDiagnostics(auth);setChecks(result.checks);setFinancial(result.financial)}catch(error){setChecks([fail('Conexão',error)])}finally{setRunning(false)}}
  async function testAi(){setAiRunning(true);const result=await testMugoAssistantConnection();setChecks((current)=>[...current.filter((item)=>item.label!=='Teste da Mugô Intelligence'),result.ok?ok('Teste da Mugô Intelligence',result.detail):fail('Teste da Mugô Intelligence',result.detail)]);setAiRunning(false)}
  if(!auth.isAdmin)return <div><PageHeader eyebrow="Sistema" title="Diagnóstico Supabase" description="Acesso exclusivo de administradores."/><FeedbackMessage type="error">Você não tem permissão para acessar este diagnóstico.</FeedbackMessage></div>
  return <div><PageHeader eyebrow="Sistema" title="Diagnóstico Supabase" description="Verifica migrations, tabelas, colunas, funções, policies e views sem expor dados sensíveis." actions={<div className="diagnostic-actions"><button className="button secondary" onClick={testAi} disabled={aiRunning||AI_PROVIDER!=='supabase'}>{aiRunning?'Testando IA…':'Testar Mugô Intelligence'}</button><button className="button" onClick={run} disabled={running}>{running?'Verificando…':'Executar diagnóstico'}</button></div>}/><section className="dashboard-panel"><ul className="diagnostic-list" aria-live="polite" aria-busy={running||aiRunning}>{checks.map((check)=><li key={check.label}><span className={`check-status ${check.status}`}>{check.status==='ok'?'Aprovado':'Atenção'}</span><strong>{check.label}</strong><small>{check.detail}</small></li>)}{!checks.length&&<li>Execute o diagnóstico para verificar a configuração atual.</li>}</ul></section>{financial&&<section className="dashboard-panel"><h2>Integridade financeira</h2><pre>{JSON.stringify(financial,null,2)}</pre><p className="data-note">O diagnóstico não altera registros automaticamente.</p></section>}</div>
}
