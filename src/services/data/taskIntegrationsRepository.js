import {db,isSupabaseProvider} from './provider'

export async function listOperationalIntegrations(){
  if(!isSupabaseProvider())return[]
  const whatsapp=await db().from('whatsapp_connections').select('id,status,updated_at,last_error_code').order('updated_at',{ascending:false}).limit(1)
  const connection=whatsapp.data?.[0]
  return[{provider:'whatsapp',enabled:['active','degraded'].includes(connection?.status),status:connection?.status||'not_configured',last_synced_at:connection?.updated_at,last_error:connection?.last_error_code||whatsapp.error?.message}]
}
