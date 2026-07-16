import {db,isSupabaseProvider,legacyUnavailable,unwrap} from './provider'
import {observed} from '../../lib/observability'
const requireProvider=()=>{if(!isSupabaseProvider())legacyUnavailable('Mugô Intelligence')}
const rpc=(name,args)=>observed(async()=>unwrap(await db().rpc(name,args)),{service:'supabase',rpc:name})
let pulseSyncBlocked=false
export async function syncPulseAlerts(alerts){
  requireProvider()
  if(pulseSyncBlocked)return null
  try{return await rpc('sync_pulse_alerts',{detected_alerts:alerts})}
  catch(error){
    if(/usuário inativo|user inactive/i.test(`${error?.message||''} ${error?.details||''}`)){
      pulseSyncBlocked=true
      if(import.meta.env.DEV)console.warn('[Mugô Pulse] Sincronização interrompida para usuário inativo.')
    }
    throw error
  }
}
export async function listPulseAlerts({status='active'}={}){requireProvider();let query=db().from('pulse_alerts').select('*, assignee:assigned_to(name), resolver:resolved_by(name), pulse_alert_events(id,event_type,note,created_at,actor:actor_id(name))').order('score',{ascending:false}).order('detected_at',{ascending:false});if(status==='active')query=query.in('status',['open','snoozed']);else if(status!=='all')query=query.eq('status',status);return unwrap(await query)}
export async function actOnPulseAlert(id,action,{note=null,assignedTo=null,snoozedUntil=null,idempotencyKey=null}={}){requireProvider();return rpc('act_on_pulse_alert',{target_id:id,action_name:action,action_note:note,assignee_id:assignedTo,snooze_until:snoozedUntil,idempotency_key:idempotencyKey})}
