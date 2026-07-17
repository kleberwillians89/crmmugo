import {normalizeServices} from './normalizeService.js'

const person=(value)=>value?{id:value.id||null,name:value.name||'Não definido',email:value.email||null,active:value.active!==false}:null
export function normalizeContract(row={}){
  const legacyCommercial=row.team_members||row.proposals?.team_members||null
  const commercialResponsible=person(row.commercial_responsible||legacyCommercial)
  const deliveryResponsible=person(row.delivery_responsible)
  const financialResponsible=person(row.financial_responsible)
  return{id:row.id,contractNumber:row.contract_number||row.contractNumber||'Sem número',status:row.status||'draft',statusLabel:{draft:'Rascunho',pending_signature:'Aguardando assinatura',active:'Ativo',expired:'Vencido',terminated:'Encerrado',cancelled:'Cancelado'}[row.status]||'Não informado',signed:Boolean(row.signed),clientId:row.client_id,clientName:row.clients?.company_name||'Cliente não informado',responsibleId:row.responsible_id||row.proposals?.responsible_id||null,responsibleName:commercialResponsible?.name||'Não definido',commercialResponsible,deliveryResponsible,financialResponsible,commercialResponsibleName:commercialResponsible?.name||'Não definido',deliveryResponsibleName:deliveryResponsible?.name||'Não definido',financialResponsibleName:financialResponsible?.name||'Não definido',responsibilitySource:row.commercial_responsible?'contracts.responsible_id':legacyCommercial?'legacy-commercial-responsible':'not-defined',startDate:row.start_date||null,endDate:row.end_date||null,minimumTermMonths:row.minimum_term_months==null?null:Number(row.minimum_term_months),billingDay:row.billing_day==null?null:Number(row.billing_day),setupValue:Number(row.setup_value||0),setupReceivedAmount:Number(row.setup_received_amount||0),monthlyValue:Number(row.monthly_value||0),totalValue:Number(row.total_value||0),services:normalizeServices(row.contract_services||row.services||[]),installments:row.invoice_installments||[],raw:row}
}
export const normalizeContracts=(rows=[])=>rows.map(normalizeContract)
