import {db,isSupabaseProvider,unwrap} from './provider'
import {getSupabaseClient} from '../../lib/supabase/client'
export const COMMERCIAL_STAGES=['new_lead','in_service','qualifying','qualified','meeting','proposal','negotiation','won','lost']
export async function listCommercialOpportunities(){if(!isSupabaseProvider())return[];return unwrap(await db().from('commercial_opportunities').select('*,clients(company_name,contact_name,phone,email),team_members(name),commercial_qualifications(*),commercial_briefing_outbox(status,external_url,last_error),crm_tasks(id,title,status,due_date,priority,task_type)').order('updated_at',{ascending:false}))}
export async function updateOpportunityStage(id,stage){if(!COMMERCIAL_STAGES.includes(stage))throw new Error('Etapa comercial inválida.');return unwrap(await db().from('commercial_opportunities').update({stage,...(['won','lost'].includes(stage)?{closed_at:new Date().toISOString()}:{closed_at:null})}).eq('id',id).select().single())}
export async function commercialAction(action,payload={}){const {data,error}=await getSupabaseClient().functions.invoke('commercial-actions',{body:{action,...payload}});if(error)throw error;if(!data?.ok)throw Object.assign(new Error(data?.message||'Ação comercial indisponível.'),{code:data?.code});return data.data}
export const getConversationCommercialContext=conversationId=>commercialAction('get_context',{conversation_id:conversationId})
export const handoffCommercialConversation=conversationId=>commercialAction('handoff',{conversation_id:conversationId})
export const requestNotionBriefing=opportunityId=>commercialAction('generate_briefing',{opportunity_id:opportunityId})
