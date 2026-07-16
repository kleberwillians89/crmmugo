import {db,unwrap} from './provider'
import {confirmInstallmentReceipt} from './financeRepository'
import {invalidateCrmData} from '../../lib/dataInvalidation'

export async function listCollectionAlerts(){
  return unwrap(await db().from('whatsapp_collection_alerts').select('*').order('created_at',{ascending:false}).limit(1000))
}
export async function updateCollectionStage(id,status){
  return unwrap(await db().from('whatsapp_collection_alerts').update({status,collection_stage:status,action:`marked_${status}`}).eq('id',id).select().single())
}
export async function markCollectionPaid(alert,installment){
  await confirmInstallmentReceipt(installment.id,{received_amount:Number(installment.amount),received_on:new Date().toISOString().slice(0,10),payment_method:'pix',notes:'Recebimento confirmado pelo módulo de cobrança do WhatsApp.'})
  const result=unwrap(await db().from('whatsapp_collection_alerts').update({status:'paid',collection_stage:'paid',action:'payment_confirmed',paid_at:new Date().toISOString()}).eq('id',alert.id).select().single())
  invalidateCrmData({resources:['installments','finance','dashboard','clients','intelligence']})
  return result
}
