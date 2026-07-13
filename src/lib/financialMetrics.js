const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
export const validContracts = (contracts = []) => contracts.filter((contract) => contract.status !== 'cancelled' || number(contract.setup_received_amount) > 0)
export const setupStatus = (contract) => { const total = number(contract?.setup_value); const received = number(contract?.setup_received_amount); if (received <= 0) return 'Não recebido'; if (total > 0 && received >= total) return 'Recebido integralmente'; return 'Recebimento parcial' }
export const calculateFinancialSummary = (contracts = [], installments = []) => {
  const eligible = validContracts(contracts)
  const setupContracted = eligible.reduce((sum, contract) => sum + (contract.status === 'cancelled' ? number(contract.setup_received_amount) : number(contract.setup_value)), 0)
  const setupReceived = eligible.reduce((sum, contract) => sum + number(contract.setup_received_amount), 0)
  const setupPending = eligible.reduce((sum, contract) => sum + (contract.status === 'cancelled' ? 0 : Math.max(number(contract.setup_value) - number(contract.setup_received_amount), 0)), 0)
  const balance=(item)=>Math.max(number(item.amount)-number(item.received_amount),0)
  const monthlyReceived = installments.reduce((sum,item)=>sum+number(item.received_amount),0)
  const monthlyPending = installments.filter((item) => ['pending','partial','overdue'].includes(item.status)).reduce((sum,item)=>sum+balance(item),0)
  const monthlyOverdue = installments.filter((item) => item.status==='overdue'||(item.status==='partial'&&item.due_date&&new Date(item.due_date)<new Date())).reduce((sum,item)=>sum+balance(item),0)
  return { setupContracted, setupReceived, setupPending, monthlyReceived, monthlyPending, monthlyOverdue, totalReceived: setupReceived + monthlyReceived, totalOpen: setupPending + monthlyPending }
}
