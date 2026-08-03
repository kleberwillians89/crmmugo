const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const cents = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100
const nonNegative = (value) => Math.max(number(value), 0)

export function businessShare({ scope, amount, business_percentage: percentage = 0 }) {
  const safeAmount=nonNegative(amount),safePercentage=number(percentage)
  if (scope === 'business') return cents(safeAmount)
  if (scope === 'shared'&&safePercentage>0&&safePercentage<=100) return cents(safeAmount * safePercentage / 100)
  return 0
}

export function summarizeExpenses(installments = []) {
  return installments.reduce((summary, item) => {
    if (item.status === 'cancelled') return summary
    const official = item.expenses?.scope !== 'pending_review'
    const business = official ? nonNegative(item.business_amount) : 0
    summary.total += nonNegative(item.amount)
    summary.business += business
    summary.paid += item.status === 'paid' ? business : Math.min(number(item.paid_amount), business)
    summary.open += Math.max(business - Math.min(number(item.paid_amount), business), 0)
    return summary
  }, { total: 0, business: 0, paid: 0, open: 0 })
}

export function mergeCashFlow(receivables = [], payables = []) {
  const movements = [
    ...receivables.filter((item)=>item.status!=='cancelled').map((item)=>({ id:`in:${item.id}`, date:item.due_date, type:'in', label:item.clients?.company_name||'Recebimento', amount:number(item.amount)-number(item.received_amount) })),
    ...payables.filter((item)=>item.status!=='cancelled'&&item.expenses?.scope!=='pending_review').map((item)=>({ id:`out:${item.id}`, date:item.due_date, type:'out', label:item.expenses?.name||'Conta a pagar', amount:number(item.business_amount)-Math.min(number(item.paid_amount),number(item.business_amount)) })),
  ].filter((item)=>item.amount>0).sort((a,b)=>String(a.date).localeCompare(String(b.date)))
  let balance=0
  return movements.map((item)=>({...item,balance:cents(balance+=item.type==='in'?item.amount:-item.amount)}))
}
