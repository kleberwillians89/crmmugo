export const MUGO_RESERVE_PERCENTAGE=10
export const REVENUE_SPLIT_MEMBERS=3
export const REVENUE_CATEGORIES=Object.freeze(['recurring','setup','other'])

const assertNonNegative=(value,label='Receita')=>{const number=Number(value);if(!Number.isFinite(number)||number<0)throw new RangeError(`${label} deve ser um valor não negativo.`);return number}
const toCents=(value)=>Math.round((assertNonNegative(value)+Number.EPSILON)*100)

export function calculateMugoReserve(grossCents,reservePercentage=MUGO_RESERVE_PERCENTAGE){assertNonNegative(grossCents,'Receita em centavos');assertNonNegative(reservePercentage,'Percentual da reserva');return Math.round(grossCents*reservePercentage/100)}
export function calculateAvailableRevenue(grossCents,reserveCents){assertNonNegative(grossCents,'Receita em centavos');assertNonNegative(reserveCents,'Reserva em centavos');return Math.max(grossCents-reserveCents,0)}
export function calculateRevenuePerPerson(availableCents,members=REVENUE_SPLIT_MEMBERS){assertNonNegative(availableCents,'Receita disponível em centavos');if(!Number.isInteger(members)||members<1)throw new RangeError('A quantidade de pessoas deve ser um inteiro positivo.');return{perPersonCents:Math.floor(availableCents/members),remainderCents:availableCents%members}}

export function calculateRevenueDistribution(grossRevenue,{reservePercentage=MUGO_RESERVE_PERCENTAGE,members=REVENUE_SPLIT_MEMBERS}={}){
  const grossCents=toCents(grossRevenue),reserveCents=calculateMugoReserve(grossCents,reservePercentage),availableCents=calculateAvailableRevenue(grossCents,reserveCents),{perPersonCents,remainderCents}=calculateRevenuePerPerson(availableCents,members)
  return{grossCents,reservePercentage,reserveCents,availableCents,members,perPersonCents,remainderCents}
}

export function formatRevenueDistribution(distribution,locale='pt-BR',currency='BRL'){
  const format=(cents)=>(cents/100).toLocaleString(locale,{style:'currency',currency})
  return{gross:format(distribution.grossCents),reserve:format(distribution.reserveCents),available:format(distribution.availableCents),perPerson:format(distribution.perPersonCents),remainder:format(distribution.remainderCents)}
}

const periodKey=(value)=>String(value||'').slice(0,7)
export function classifyInstallmentRevenue(installment={}){
  if(installment.installment_type==='monthly')return{category:'recurring',source:'installment_type:monthly',confidence:'exact',type:'monthly'}
  if(installment.installment_type==='setup')return{category:'setup',source:'installment_type:setup',confidence:'exact',type:'setup'}
  if(installment.installment_type==='project')return{category:'setup',source:'installment_type:project',confidence:'exact',type:'project'}
  return{category:'other',source:installment.installment_type?'installment_type:unsupported':'installment_type:missing',confidence:'fallback',type:'other'}
}

export function installmentRevenueValue(item,period,mode='realized'){
  if(mode==='realized'){
    const receivedDate=item.manual_confirmation_at||item.paid_at
    return periodKey(receivedDate)===periodKey(period)?Math.max(Number(item.received_amount)||0,0):0
  }
  if(mode!=='forecast')throw new RangeError('Visão financeira inválida.')
  if(['cancelled','refunded','failed'].includes(item.status))return 0
  return periodKey(item.reference_month||item.due_date)===periodKey(period)?Math.max(Number(item.amount)||0,0):0
}

export function revenueForPeriod(installments=[],period,mode='realized'){
  return installments.reduce((total,item)=>total+installmentRevenueValue(item,period,mode),0)
}

export function calculateCategorizedRevenue(installments=[],period,mode='realized'){
  const groups=Object.fromEntries(REVENUE_CATEGORIES.map((category)=>[category,{category,grossRevenue:0,installmentCount:0,clients:new Set()}]))
  installments.forEach((item)=>{const value=installmentRevenueValue(item,period,mode);if(value<=0)return;const classification=classifyInstallmentRevenue(item),group=groups[classification.category];group.grossRevenue+=value;group.installmentCount+=1;if(item.client_id)group.clients.add(item.client_id)})
  const categories=Object.fromEntries(REVENUE_CATEGORIES.map((category)=>{const group=groups[category];return[category,{category,distribution:calculateRevenueDistribution(group.grossRevenue),installmentCount:group.installmentCount,clientCount:group.clients.size}]})),distributions=Object.values(categories).map((item)=>item.distribution),grossCents=distributions.reduce((sum,item)=>sum+item.grossCents,0),reserveCents=distributions.reduce((sum,item)=>sum+item.reserveCents,0),availableCents=distributions.reduce((sum,item)=>sum+item.availableCents,0),{perPersonCents,remainderCents}=calculateRevenuePerPerson(availableCents,REVENUE_SPLIT_MEMBERS)
  return{categories,total:{grossCents,reservePercentage:MUGO_RESERVE_PERCENTAGE,reserveCents,availableCents,members:REVENUE_SPLIT_MEMBERS,perPersonCents,remainderCents}}
}
