import {db,isSupabaseProvider,organizationId,unwrap} from './provider'

export async function listOperationalIntegrations(){
  if(!isSupabaseProvider())return[]
  const [whatsapp,tasks]=await Promise.all([
    db().from('whatsapp_connections').select('id,status,updated_at,last_error_code').order('updated_at',{ascending:false}).limit(1),
    db().from('task_integration_settings').select('provider,enabled,configuration,last_synced_at,last_error'),
  ])
  const connection=whatsapp.data?.[0]
  return[
    {provider:'whatsapp',enabled:['active','degraded'].includes(connection?.status),status:connection?.status||'not_configured',last_synced_at:connection?.updated_at,last_error:connection?.last_error_code||whatsapp.error?.message},
    ...['trello','notion'].map((provider)=>tasks.data?.find((item)=>item.provider===provider)||{provider,enabled:false,status:'not_configured',last_error:tasks.error?.message}),
  ]
}
export async function saveTaskIntegration(provider,values){
  return unwrap(await db().from('task_integration_settings').upsert({organization_id:await organizationId(),provider,...values},{onConflict:'organization_id,provider'}).select().single())
}
