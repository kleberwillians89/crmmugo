import {db,isSupabaseProvider,organizationId,unwrap} from './provider'
import {invalidateCrmData} from '../../lib/dataInvalidation'
const select='*, team_members(name), clients(company_name), proposals(title), contracts(contract_number), invoice_installments(reference_month)'
const unavailable=(error)=>error?.code==='PGRST205'||error?.code==='42P01'||/crm_tasks|schema cache/i.test(`${error?.message||''} ${error?.details||''}`)
export async function listTasks(){if(!isSupabaseProvider())return{available:false,items:[]};const response=await db().from('crm_tasks').select(select).order('due_date',{ascending:true});if(response.error&&unavailable(response.error))return{available:false,items:[]};return{available:true,items:unwrap(response)}}
export async function createTask(values){const record=unwrap(await db().from('crm_tasks').insert({...values,organization_id:await organizationId()}).select(select).single());invalidateCrmData({resources:['dashboard','intelligence']});return record}
export async function updateTask(id,values){const record=unwrap(await db().from('crm_tasks').update({...values,completed_at:values.status==='completed'?new Date().toISOString():null}).eq('id',id).select(select).single());invalidateCrmData({resources:['dashboard','intelligence']});return record}
