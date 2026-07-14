import {invalidateCrmData} from '../../lib/dataInvalidation'
import {db,isSupabaseProvider,legacyUnavailable,unwrap} from './provider'

const allowed=new Set(['proposal_services','contract_services'])
const table=(value)=>{if(!allowed.has(value))throw new Error('Tipo de serviço inválido.');return value}
const changed=()=>invalidateCrmData({resources:['proposals','contracts','installments','finance','dashboard','clients','intelligence']})
export async function getProposalServices(proposalId){if(!isSupabaseProvider())return legacyUnavailable('Serviços da proposta');return unwrap(await db().from('proposal_services').select('*').eq('proposal_id',proposalId).order('created_at'))}
export async function getContractServices(contractId){if(!isSupabaseProvider())return legacyUnavailable('Serviços do contrato');return unwrap(await db().from('contract_services').select('*').eq('contract_id',contractId).order('created_at'))}
export async function saveServiceFinancialBreakdown(source,id,values){const payload={billing_type:values.billingType||null,quantity:Number(values.quantity||0),unit_price:Number(values.unitPrice||0),setup_value:Number(values.setupValue||0),monthly_value:Number(values.monthlyValue||0),one_time_value:Number(values.oneTimeValue||0),discount:Number(values.discount||0),total_value:values.totalValue==null?null:Number(values.totalValue),duration_months:values.durationMonths==null?null:Number(values.durationMonths)};if(Object.values(payload).some((value)=>typeof value==='number'&&!Number.isFinite(value)))throw new Error('Os valores financeiros do serviço são inválidos.');const result=unwrap(await db().from(table(source)).update(payload).eq('id',id).select().single());changed();return result}
