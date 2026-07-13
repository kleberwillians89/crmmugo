import { createProposal as legacyCreate,getProposals,updateProposal as legacyUpdate } from '../../lib/api'
import { db,isSupabaseProvider,organizationId,unwrap } from './provider'
export async function listProposals(){if(!isSupabaseProvider())return getProposals();return unwrap(await db().from('proposals').select('*, clients(company_name,contact_name), proposal_services(*)').order('created_at',{ascending:false}))}
export async function getProposal(id){if(!isSupabaseProvider())return (await getProposals()).find((p)=>String(p.id)===String(id));return unwrap(await db().from('proposals').select('*, clients(*), proposal_services(*), documents(*)').eq('id',id).single())}
export async function createProposal(values){if(!isSupabaseProvider())return legacyCreate(values);return unwrap(await db().from('proposals').insert({...values,organization_id:await organizationId()}).select().single())}
export async function updateProposal(id,values){if(!isSupabaseProvider())return legacyUpdate(id,values);return unwrap(await db().from('proposals').update(values).eq('id',id).select().single())}
export const updateStatus=(id,status)=>updateProposal(id,{status})
export const associateDocument=(proposalId,documentId)=>db().from('documents').update({proposal_id:proposalId}).eq('id',documentId).then(unwrap)
