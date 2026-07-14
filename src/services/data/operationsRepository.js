import {db,isSupabaseProvider,legacyUnavailable,unwrap} from './provider'
import {observed} from '../../lib/observability'

const requireSupabase=(feature)=>{if(!isSupabaseProvider())throw new Error(legacyUnavailable(feature).message)}

const rpc=(name,args)=>observed(async()=>unwrap(await db().rpc(name,args)),{service:'supabase',rpc:name})
export async function runOperationalAudit(){requireSupabase('Auditoria');return rpc('crm_operational_audit')}
export async function runFinancialReconciliation(){requireSupabase('Reconciliação financeira');return rpc('crm_financial_reconciliation')}
export async function getCrmHealth(){requireSupabase('Saúde do CRM');return rpc('crm_health_snapshot')}
export async function listAuditTimeline({limit=200}={}){requireSupabase('Histórico');return unwrap(await db().from('audit_log').select('id,entity_type,record_id,action,before_data,after_data,source,ip_address,created_at,profiles:actor_id(name,email)').order('created_at',{ascending:false}).limit(limit))}
export async function listPermissionAudit(){requireSupabase('Permissões');return rpc('crm_permission_audit')}
export async function listArchivedRecords(){requireSupabase('Restauração');return rpc('crm_archived_records')}
export async function restoreArchivedRecord(entity,id){requireSupabase('Restauração');return rpc('restore_archived_record',{entity_name:entity,target_id:id})}

const EXPORTS={clients:'clients',contracts:'contracts',proposals:'proposals',finance:'invoice_installments',services:'contract_services',dashboard:'crm_health_snapshot'}
export async function loadBackupDataset(scope){
  requireSupabase('Backup')
  if(scope==='complete'){
    const entries=await Promise.all(Object.keys(EXPORTS).filter((key)=>key!=='dashboard').map(async(key)=>[key,await loadBackupDataset(key)]))
    return Object.fromEntries(entries)
  }
  if(scope==='dashboard')return getCrmHealth()
  const table=EXPORTS[scope]
  if(!table)throw new Error('Escopo de backup inválido.')
  return unwrap(await db().from(table).select('*').order('created_at',{ascending:true}))
}
