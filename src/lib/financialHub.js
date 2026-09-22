const value=(input)=>Number.isFinite(Number(input))?Number(input):0
export const competenceKey=(input)=>String(input||'').slice(0,7)
export const firstOfMonth=(input)=>`${competenceKey(input)}-01`
export const uniqueFinancialRows=(rows=[])=>[...new Map(rows.filter((row)=>row?.id).map((row)=>[row.id,row])).values()]

export function buildFinancialOverview({receivables=[],payables=[],debts=[],freelance=[],goals=[],plans=[],pipeline=[]},period){
  const income=uniqueFinancialRows(receivables).filter((row)=>competenceKey(row.reference_month||row.due_date)===period&&row.status!=='cancelled')
  const expenses=uniqueFinancialRows(payables).filter((row)=>competenceKey(row.reference_month||row.due_date)===period&&row.status!=='cancelled')
  const forecastRevenue=income.reduce((sum,row)=>sum+value(row.projected_brl_amount??row.amount),0)
  const receivedRevenue=income.reduce((sum,row)=>sum+value(row.actual_brl_amount??row.received_amount),0)
  const forecastExpense=expenses.reduce((sum,row)=>sum+value(row.amount),0)
  const paidExpense=expenses.reduce((sum,row)=>sum+Math.min(value(row.paid_amount),value(row.amount)),0)
  const byArea=(area)=>expenses.filter((row)=>(row.expenses?.area||row.expenses?.scope)===area).reduce((sum,row)=>sum+Math.min(value(row.paid_amount),value(row.amount)),0)
  const freelanceIncome=freelance.filter((row)=>row.type==='income'&&row.status==='received').reduce((sum,row)=>sum+value(row.amount),0)
  const freelanceApplied=freelance.filter((row)=>row.type!=='income'&&row.applied&&row.status!=='cancelled').reduce((sum,row)=>sum+value(row.amount),0)
  const plan=plans.find((row)=>competenceKey(row.competence)===period&&row.scope==='business')||{}
  const capSpend=expenses.filter((row)=>row.expenses?.impacts_monthly_cap&&row.expenses?.financial_scope==='business').reduce((sum,row)=>sum+Math.min(value(row.paid_amount),value(row.amount)),0)
  const debtPaid=debts.flatMap((row)=>row.debt_payments||[]).filter((row)=>competenceKey(row.competence||row.paid_on)===period).reduce((sum,row)=>sum+value(row.amount),0)
  return{income,expenses,forecastRevenue,receivedRevenue,contractedReceivable:Math.max(forecastRevenue-receivedRevenue,0),forecastExpense,paidExpense,realBalance:receivedRevenue-paidExpense,projectedBalance:forecastRevenue-forecastExpense,businessExpense:byArea('business'),householdExpense:byArea('household')+byArea('shared'),freelanceBalance:freelanceIncome-freelanceApplied,debtBalance:debts.reduce((sum,row)=>sum+value(row.current_balance),0),reserveBalance:goals.reduce((sum,row)=>sum+value(row.current_amount),0),pipelinePotential:pipeline.filter((row)=>!['won','lost'].includes(row.stage)).reduce((sum,row)=>sum+value(row.estimated_value),0),wonPotential:pipeline.filter((row)=>row.stage==='won').reduce((sum,row)=>sum+value(row.estimated_value),0),monthlyCap:value(plan.monthly_cap),capSpend,capAvailable:Math.max(value(plan.monthly_cap)-capSpend,0),debtTarget:value(plan.debt_target),debtPaid,reserveTarget:value(plan.reserve_target),otherGoalsTarget:value(plan.other_goals_target)}
}

export function buildFinancialCalendar({receivables=[],payables=[],debts=[],freelance=[]},period){
  return[
    ...uniqueFinancialRows(receivables).filter((row)=>competenceKey(row.due_date)===period).map((row)=>({id:`income:${row.id}`,date:row.due_date,kind:row.status==='paid'?'received':'receivable',scope:'business',label:row.clients?.company_name||row.description||'Recebimento',amount:value(row.actual_brl_amount??row.received_amount)||value(row.projected_brl_amount??row.amount),source:row})),
    ...uniqueFinancialRows(payables).filter((row)=>competenceKey(row.due_date)===period).map((row)=>({id:`expense:${row.id}`,date:row.due_date,kind:'expense',scope:row.expenses?.financial_scope||'business',label:row.expenses?.name||'Despesa',amount:value(row.amount),source:row})),
    ...debts.filter((row)=>competenceKey(row.due_date)===period&&row.status!=='paid').map((row)=>({id:`debt:${row.id}`,date:row.due_date,kind:'debt',scope:row.owner_scope,label:row.name,amount:value(row.current_balance),source:row})),
    ...freelance.filter((row)=>competenceKey(row.movement_date)===period&&row.status!=='cancelled').map((row)=>({id:`freelance:${row.id}`,date:row.movement_date,kind:'freelance',scope:row.scope,label:row.project_source,amount:value(row.amount),source:row})),
  ].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
}

export function budgetComparison(budgets=[],payables=[],period){return budgets.filter((row)=>competenceKey(row.competence)===period).map((budget)=>{const actual=payables.filter((row)=>competenceKey(row.reference_month||row.due_date)===period&&row.expenses?.category_id===budget.category_id&&row.status!=='cancelled').reduce((sum,row)=>sum+Math.min(value(row.paid_amount),value(row.amount)),0);return{...budget,actual,balance:value(budget.planned_amount)-actual}})}

export function monthlyClosingPreview(data,period){const overview=buildFinancialOverview(data,period),fixed=data.receivables.filter((row)=>competenceKey(row.reference_month)===period&&(row.revenue_type||'fixed')==='fixed'&&row.status!=='cancelled'),freelance=data.freelance.filter((row)=>competenceKey(row.competence)===period&&row.type==='income'&&row.status==='received'),extra=data.receivables.filter((row)=>competenceKey(row.reference_month)===period&&row.revenue_type==='extra'&&row.status!=='cancelled');return{...overview,fixedRevenue:fixed.reduce((s,r)=>s+value(r.projected_brl_amount??r.amount),0),freelanceRevenue:freelance.reduce((s,r)=>s+value(r.amount),0),extraRevenue:extra.reduce((s,r)=>s+value(r.projected_brl_amount??r.amount),0),allFixedPaid:fixed.every((row)=>row.status==='paid'),withinCap:overview.monthlyCap<=0||overview.capSpend<=overview.monthlyCap,debtTargetMet:overview.debtPaid>=overview.debtTarget}}
