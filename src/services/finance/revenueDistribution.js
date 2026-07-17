export const MUGO_RESERVE_PERCENTAGE=10
export const REVENUE_SPLIT_MEMBERS=3

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
export function revenueForPeriod(installments=[],period,mode='realized'){
  if(!['realized','forecast'].includes(mode))throw new RangeError('Visão financeira inválida.')
  return installments.reduce((total,item)=>{
    if(mode==='realized'){
      const receivedDate=item.manual_confirmation_at||item.paid_at
      return periodKey(receivedDate)===periodKey(period)?total+Math.max(Number(item.received_amount)||0,0):total
    }
    if(['cancelled','refunded','failed'].includes(item.status))return total
    const competence=item.reference_month||item.due_date
    return periodKey(competence)===periodKey(period)?total+Math.max(Number(item.amount)||0,0):total
  },0)
}
