const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES=new Set(['draft','pending_signature','active','expired','terminated','cancelled'])
const METHODS=new Set(['pix','transfer','ted','boleto','card','cash','other'])
const allowed={
  client_id:'uuid',proposal_id:'nullableUuid',responsible_id:'nullableUuid',contract_number:'text',status:'status',signed:'boolean',signed_at:'date',start_date:'date',end_date:'date',minimum_term_months:'integer',billing_day:'billingDay',setup_value:'money',monthly_value:'money',total_value:'money',auto_renew:'boolean',renewal_status:'nullableText',termination_date:'date',termination_reason:'nullableText',notes:'nullableText',setup_received_amount:'money',setup_received_at:'timestamp',setup_payment_method:'paymentMethod',setup_payment_notes:'nullableText',
}
const nullable=(value)=>value===''||value===undefined?null:value
const number=(value,key,{integer=false,min=0,max=Infinity}={})=>{const normalized=nullable(value);if(normalized===null)return null;const parsed=Number(normalized);if(!Number.isFinite(parsed)||parsed<min||parsed>max||integer&&!Number.isInteger(parsed))throw new Error(`Valor inválido para ${key}.`);return parsed}
const date=(value,key)=>{const normalized=nullable(value);if(normalized===null)return null;const result=String(normalized).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||Number.isNaN(new Date(`${result}T12:00:00`).getTime()))throw new Error(`Data inválida para ${key}.`);return result}
const convert=(type,value,key)=>{
  if(type==='uuid'||type==='nullableUuid'){const result=nullable(value);if(result===null&&type==='nullableUuid')return null;if(!UUID.test(String(result)))throw new Error(`UUID inválido para ${key}.`);return result}
  if(type==='money')return number(value,key)
  if(type==='integer')return number(value,key,{integer:true})
  if(type==='billingDay')return number(value,key,{integer:true,min:1,max:31})
  if(type==='boolean')return Boolean(value)
  if(type==='date')return date(value,key)
  if(type==='timestamp'){const result=nullable(value);if(result===null)return null;const parsed=new Date(result);if(Number.isNaN(parsed.getTime()))throw new Error(`Data e hora inválidas para ${key}.`);return parsed.toISOString()}
  if(type==='status'){if(!STATUSES.has(value))throw new Error('Status de contrato inválido.');return value}
  if(type==='paymentMethod'){const result=nullable(value);if(result!==null&&!METHODS.has(result))throw new Error('Forma de pagamento inválida.');return result}
  if(type==='nullableText'){const result=nullable(value);return result===null?null:String(result).trim()||null}
  return String(value??'').trim()||null
}
export function buildContractPayload(values,{partial=false}={}){
  const payload={}
  for(const [key,type] of Object.entries(allowed)){if(partial&&!Object.prototype.hasOwnProperty.call(values,key))continue;const value=values[key];if(value===undefined&&!partial)continue;payload[key]=convert(type,value,key)}
  if(!partial&&!payload.client_id)throw new Error('Cliente é obrigatório.')
  return payload
}
export function contractToForm(contract){return Object.fromEntries(Object.keys(allowed).map((key)=>[key,contract[key]??'']))}
export function assertContractId(value){if(!UUID.test(String(value||'')))throw new Error('ID de contrato inválido.');return value}
export const CONTRACT_DB_FIELDS=Object.freeze(Object.keys(allowed))
