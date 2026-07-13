import { db,isSupabaseProvider,legacyUnavailable,organizationId,unwrap } from './provider'
export async function listClients(){if(!isSupabaseProvider())return [];return unwrap(await db().from('clients').select('*, proposals(count), contracts(count)').neq('status','archived').order('created_at',{ascending:false}))}
export async function getClient(id){if(!isSupabaseProvider())return legacyUnavailable('Clientes');return unwrap(await db().from('clients').select('*, proposals(*,proposal_services(*)), contracts(*,contract_services(*)), documents(*), invoice_installments(*), commercial_events(*)').eq('id',id).single())}
export async function createClient(values){if(!isSupabaseProvider())return legacyUnavailable('Clientes');return unwrap(await db().from('clients').insert({...values,organization_id:await organizationId()}).select().single())}
export async function updateClient(id,values){if(!isSupabaseProvider())return legacyUnavailable('Clientes');return unwrap(await db().from('clients').update(values).eq('id',id).select().single())}
export const archiveClient=(id)=>updateClient(id,{status:'archived'})
export const reactivateClient=(id)=>updateClient(id,{status:'active'})
