import {useState} from 'react'
import {Download} from 'lucide-react'
import {PageHeader} from './PageHeader'
import {loadBackupDataset} from '../services/data/operationsRepository'
import {downloadExport} from '../lib/exportData'
const scopes=[['clients','Clientes'],['contracts','Contratos'],['proposals','Propostas'],['finance','Financeiro'],['services','Serviços'],['dashboard','Dashboard'],['complete','Backup Completo']]
export function BackupPage(){const [busy,setBusy]=useState(''),[error,setError]=useState('');async function save(scope,format){setBusy(`${scope}-${format}`);setError('');try{downloadExport(await loadBackupDataset(scope),format,`mugo-${scope}`)}catch(cause){setError(cause.message)}finally{setBusy('')}}return <div className="operations-page"><PageHeader eyebrow="Sistema" title="Backup" description="Exportação manual e segura. O CRM não agenda nem aplica restaurações automaticamente."/>{error&&<p className="feedback-message error">{error}</p>}<div className="backup-grid">{scopes.map(([id,label])=><article key={id}><Download size={22}/><h2>{label}</h2><div>{['csv','xls','json'].map((format)=><button className="button secondary" disabled={Boolean(busy)||id==='complete'&&format!=='json'} onClick={()=>save(id,format)} key={format}>{busy===`${id}-${format}`?'Gerando…':format.toUpperCase()}</button>)}</div></article>)}</div></div>}
