import { db,isSupabaseProvider,legacyUnavailable,organizationId,unwrap } from './provider'
import {invalidateCrmData} from '../../lib/dataInvalidation'
const receiptMutations=new Map()
const installmentMutations=new Map()
const installmentFields=['client_id','contract_id','proposal_id','reference_month','installment_number','due_date','amount','received_amount','status','provider','provider_invoice_id','idempotency_key','payment_url','pix_copy_paste','boleto_url','paid_at','cancelled_at','operational_notes','installment_type','description','source','revenue_type','currency','original_amount','exchange_rate','projected_brl_amount','actual_brl_amount','destination','financial_origin']
export function sanitizeInstallmentPayload(values){return Object.fromEntries(installmentFields.filter((key)=>Object.prototype.hasOwnProperty.call(values,key)).map((key)=>[key,values[key]===''?null:values[key]]))}
export const INSTALLMENT_CONTRACT_EMBED='contracts(contract_number,responsible_id,commercial_responsible:team_members!contracts_responsible_id_fkey(id,name,email,active),delivery_responsible:team_members!contracts_delivery_responsible_id_fkey(id,name,email,active),financial_responsible:team_members!contracts_financial_responsible_id_fkey(id,name,email,active),contract_services(service_name))'
export async function listInstallments(){if(!isSupabaseProvider())return [];const response=await db().from('invoice_installments').select(`*, clients(company_name,contact_name,phone,billing_contact_name,billing_contact_phone), ${INSTALLMENT_CONTRACT_EMBED}, invoice_installment_allocations(amount,percentage,contract_services(service_name,service_category))`).order('due_date');if(response.error?.code==='PGRST201'){if(import.meta.env.DEV)console.error('[Contracts relationship error]',{code:response.error.code,message:response.error.message});throw new Error('Não foi possível carregar os responsáveis dos contratos.')}return unwrap(response)}
export async function getRevenueByService(){if(!isSupabaseProvider())return [];const rows=unwrap(await db().from('invoice_installment_allocations').select('amount,invoice_installments(status,received_amount,amount,due_date),contract_services(service_name,service_category)'));const groups=new Map();rows.forEach((row)=>{const key=row.contract_services?.service_name||'Serviço não informado',current=groups.get(key)||{service:key,expected:0,received:0};current.expected+=Number(row.amount||0);const installment=row.invoice_installments,ratio=Number(installment?.amount)>0?Math.min(Number(installment.received_amount||0)/Number(installment.amount),1):0;current.received+=Number(row.amount||0)*ratio;groups.set(key,current)});return[...groups.values()]}
const installmentConflict=(existing)=>Object.assign(new Error(existing
  ? `Já existe uma parcela ${existing.installment_type==='monthly'?'mensal':'de setup'} neste contrato para ${String(existing.reference_month).slice(0,7)} (nº ${existing.installment_number}). Revise a parcela existente; nenhum valor foi alterado.`
  : 'Um registro existente conflita com este lançamento. Atualize a lista e confira as parcelas antes de tentar novamente.'),{code:'INSTALLMENT_ALREADY_EXISTS',existingInstallment:existing||null})
export async function createInstallment(values){
  if(!isSupabaseProvider())return legacyUnavailable('Financeiro')
  const payload=sanitizeInstallmentPayload(values),org=await organizationId()
  if(payload.installment_type&&!['monthly','setup'].includes(payload.installment_type))throw Object.assign(new Error('Selecione mensalidade ou setup. Para receita extraordinária, use a natureza Extra.'),{code:'INVALID_INSTALLMENT_TYPE'})
  const key=JSON.stringify([org,payload])
  if(installmentMutations.has(key))return installmentMutations.get(key)
  const mutation=(async()=>{
    const findConflict=async()=>{
      const result=await db().from('invoice_installments').select('id,client_id,contract_id,installment_type,reference_month,installment_number,due_date,amount,received_amount,status').eq('organization_id',org).eq('contract_id',payload.contract_id).eq('reference_month',payload.reference_month)
      if(result.error)throw result.error
      return (result.data||[]).find(row=>row.installment_type===(payload.installment_type||'monthly')||Number(row.installment_number)===Number(payload.installment_number||1))||null
    }
    const existing=await findConflict()
    if(existing)throw installmentConflict(existing)
    const result=await db().from('invoice_installments').insert({...payload,provider:payload.provider||'manual',organization_id:org}).select().single()
    if(result.error?.code==='23505')throw installmentConflict(await findConflict())
    const created=unwrap(result)
    invalidateCrmData({resources:['installments','dashboard','clients','intelligence']})
    return created
  })().finally(()=>installmentMutations.delete(key))
  installmentMutations.set(key,mutation)
  return mutation
}
export async function updateInstallment(id,values){if(!isSupabaseProvider())return legacyUnavailable('Financeiro');return unwrap(await db().from('invoice_installments').update(sanitizeInstallmentPayload(values)).eq('id',id).select().single())}
export function confirmInstallmentReceipt(id,values){if(receiptMutations.has(id))return receiptMutations.get(id);const task=(async()=>{if(!isSupabaseProvider())return legacyUnavailable('Financeiro');const result=unwrap(await db().rpc('confirm_installment_receipt',{target_id:id,new_received_amount:Number(values.received_amount),received_on:values.received_on,payment_method_name:values.payment_method,payment_note:values.notes||null}));invalidateCrmData({resources:['installments','dashboard','clients','intelligence']});return result})().finally(()=>receiptMutations.delete(id));receiptMutations.set(id,task);return task}
export async function recordBillingPrepared({clientId,contractId,description,newValue}){if(!isSupabaseProvider())return;const {data:{user}}=await db().auth.getUser();return unwrap(await db().from('commercial_events').insert({organization_id:await organizationId(),client_id:clientId,contract_id:contractId,event_type:'billing_whatsapp_prepared',title:'Cobrança preparada no WhatsApp',description,new_value:newValue,created_by:user?.id}).select().single())}
