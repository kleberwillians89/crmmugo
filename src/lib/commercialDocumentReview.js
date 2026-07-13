export const DOCUMENT_TYPE_LABELS={proposal:'Proposta',signed_contract:'Contrato assinado',unsigned_contract:'Contrato sem assinatura',amendment:'Aditivo',other:'Outro'}

export const TECHNICAL_VALUE_LABELS={one_time:'Pagamento único',monthly:'Mensal',recurring:'Recorrente',included:'Incluso',project:'Projeto',hybrid:'Híbrido'}

const categoryLabels={'social media':'Social Media','mídia paga e site':'Mídia paga e ajustes no site','midia paga e site':'Mídia paga e ajustes no site','branding e ativações':'Branding e ativações','branding e ativacoes':'Branding e ativações','relatórios e business review':'Relatórios e análise executiva','relatorios e business review':'Relatórios e análise executiva',onboarding:'Onboarding'}

const normalize=(value)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()

export function humanizeTechnicalValue(value){return TECHNICAL_VALUE_LABELS[value]||categoryLabels[normalize(value)]||value||'Não informado'}

export function confirmationsForDocument(type){
  if(type==='proposal')return [['values','Confirmo os valores.'],['status','Confirmo o status.'],['dates','Confirmo as datas.'],['services','Confirmo os serviços.']]
  if(['signed_contract','unsigned_contract'].includes(type))return [['values','Confirmo os valores.'],['dates','Confirmo as datas.'],['signature','Confirmo a assinatura.'],['status','Confirmo o status contratual.'],['financial','Confirmo as condições financeiras.'],['renewal','Confirmo a renovação.']]
  if(type==='amendment')return [['values','Confirmo os novos valores.'],['dates','Confirmo o novo prazo.'],['services','Confirmo os serviços alterados.'],['contract_link','Confirmo o contrato relacionado.']]
  return [['client','Confirmo o cliente.'],['document_type','Confirmo o tipo do documento.']]
}

export function missingFieldsForSection(section={}){return Object.entries(section).filter(([,field])=>field?.value==null||field.value==='').map(([name])=>name)}

export function monthlyValueComposition(reviewed){
  const services=(reviewed?.services||[]).filter((service)=>['monthly','recurring'].includes(service.billing_type?.value)&&Number(service.monthly_value?.value)>0)
  const calculated=services.reduce((sum,service)=>sum+Number(service.monthly_value.value),0)
  const monthlyField=reviewed?.proposal?.monthly_value||reviewed?.contract?.monthly_value
  return {services:services.map((service)=>({name:service.service_name?.value||'Serviço',value:Number(service.monthly_value.value)})),calculated,declared:monthlyField?.value==null?null:Number(monthlyField.value),origin:monthlyField?.valueOrigin||(!monthlyField?.value?'missing':'explicit')}
}

export function validateReview({type,reviewed,clientAction,clientId,entityAction,entityId,confirmations}){
  const missing=[]
  if(clientAction==='create'&&!reviewed?.client?.company_name?.value)missing.push('Empresa')
  if(clientAction==='link'&&!clientId)missing.push('Cliente existente')
  if(['signed_contract','unsigned_contract'].includes(type)&&!reviewed?.contract?.status?.value)missing.push('Status do contrato')
  if(type==='amendment'&&(entityAction!=='link'||!entityId))missing.push('Contrato relacionado')
  const required=confirmationsForDocument(type).map(([key])=>key)
  if(required.some((key)=>!confirmations[key]))missing.push('Confirmações obrigatórias')
  return {valid:missing.length===0,missing}
}
