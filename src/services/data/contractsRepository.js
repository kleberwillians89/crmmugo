import { db,isSupabaseProvider,legacyUnavailable,organizationId,unwrap } from './provider'
export async function listContracts(){if(!isSupabaseProvider())return [];return unwrap(await db().from('contracts').select('*, clients(company_name), proposals(responsible), contract_services(*)').order('created_at',{ascending:false}))}
export async function getContract(id){if(!isSupabaseProvider())return legacyUnavailable('Contratos estruturados');return unwrap(await db().from('contracts').select('*, clients(*), contract_services(*), documents(*)').eq('id',id).single())}
export async function createContract(values){if(!isSupabaseProvider())return legacyUnavailable('Contratos estruturados');return unwrap(await db().from('contracts').insert({...values,organization_id:await organizationId()}).select().single())}
export async function updateContract(id,values){if(!isSupabaseProvider())return legacyUnavailable('Contratos estruturados');return unwrap(await db().from('contracts').update(values).eq('id',id).select().single())}
export const associateDocument=(contractId,documentId)=>db().from('documents').update({contract_id:contractId}).eq('id',documentId).then(unwrap)
