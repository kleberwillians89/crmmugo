import {db,isSupabaseProvider,legacyUnavailable,organizationId,unwrap} from './provider'
export async function listTeamMembers({activeOnly=false}={}){if(!isSupabaseProvider())return[];let query=db().from('team_members').select('*').order('active',{ascending:false}).order('name');if(activeOnly)query=query.eq('active',true);return unwrap(await query)}
export async function createTeamMember(values){if(!isSupabaseProvider())return legacyUnavailable('Equipe Mugô');return unwrap(await db().from('team_members').insert({...values,organization_id:await organizationId()}).select().single())}
export async function updateTeamMember(id,values){if(!isSupabaseProvider())return legacyUnavailable('Equipe Mugô');return unwrap(await db().from('team_members').update(values).eq('id',id).select().single())}
