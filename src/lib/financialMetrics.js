const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const money = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100
const inactiveStatuses = new Set(['cancelled', 'refunded', 'failed'])
const openStatuses = new Set(['pending', 'open', 'overdue', 'partial', 'partially_paid'])

const installmentType = (item) => item.installment_type === 'setup' ? 'setup' : 'monthly'
const isActiveInstallment = (item) => !inactiveStatuses.has(item.status)
const installmentReceived = (item) => Math.max(number(item.received_amount), 0)
const installmentBalance = (item) => isActiveInstallment(item) ? Math.max(number(item.amount) - installmentReceived(item), 0) : 0
const dueBefore = (item, today) => Boolean(item.due_date) && new Date(`${String(item.due_date).slice(0, 10)}T12:00:00`) < today

export const validContracts = (contracts = []) => contracts.filter((contract) => contract.status !== 'cancelled' || number(contract.setup_received_amount) > 0)
export const setupStatus = (contract) => { const total = number(contract?.setup_value); const received = number(contract?.setup_received_amount); if (received <= 0) return 'Não recebido'; if (total > 0 && received >= total) return 'Recebido integralmente'; return 'Recebimento parcial' }

function summarizeRows(rows, today) {
  return rows.reduce((summary, item) => {
    const received = installmentReceived(item)
    const balance = installmentBalance(item)
    if (isActiveInstallment(item)) summary.expected += number(item.amount)
    summary.received += received
    if (openStatuses.has(item.status)) summary.open += balance
    if (balance > 0 && isActiveInstallment(item)) {
      if (dueBefore(item, today)) summary.overdue += balance
      else summary.future += balance
    }
    return summary
  }, { expected: 0, received: 0, open: 0, overdue: 0, future: 0 })
}

export function calculateFinancialSummary(contracts = [], installments = [], options = {}) {
  const today = options.today ? new Date(`${String(options.today).slice(0, 10)}T12:00:00`) : new Date()
  const rowsByContract = new Map()
  installments.forEach((item) => {
    const key = item.contract_id ?? (contracts.length === 1 ? contracts[0].id : null)
    const group = rowsByContract.get(key) || { setup: [], monthly: [] }
    group[installmentType(item)].push(item)
    rowsByContract.set(key, group)
  })

  const totals = {
    setupContracted: 0, setupReceived: 0, setupPending: 0, setupOverdue: 0, setupFuture: 0,
    monthlyExpected: 0, monthlyEstimated: 0, monthlyReceived: 0, monthlyPending: 0, monthlyOverdue: 0, monthlyFuture: 0,
    legacySetupContracts: [], legacyMonthlyContracts: [],
  }

  contracts.forEach((contract) => {
    const group = rowsByContract.get(contract.id) || { setup: [], monthly: [] }
    if (group.setup.length) {
      const setup = summarizeRows(group.setup, today)
      totals.setupContracted += setup.expected
      totals.setupReceived += setup.received
      totals.setupPending += setup.open
      totals.setupOverdue += setup.overdue
      totals.setupFuture += setup.future
    } else {
      const expected = ['cancelled', 'terminated'].includes(contract.status) ? 0 : Math.max(number(contract.setup_value), 0)
      const received = Math.max(number(contract.setup_received_amount), 0)
      totals.setupContracted += expected
      totals.setupReceived += received
      totals.setupPending += ['cancelled', 'terminated'].includes(contract.status) ? 0 : Math.max(expected - received, 0)
      if (number(contract.setup_value) || received) totals.legacySetupContracts.push(contract.id)
    }

    if (group.monthly.length) {
      const monthly = summarizeRows(group.monthly, today)
      totals.monthlyExpected += monthly.expected
      totals.monthlyReceived += monthly.received
      totals.monthlyPending += monthly.open
      totals.monthlyOverdue += monthly.overdue
      totals.monthlyFuture += monthly.future
    } else if (!['cancelled', 'terminated'].includes(contract.status) && number(contract.monthly_value) > 0) {
      const cycles = Math.max(Math.trunc(number(contract.minimum_term_months)) || 1, 1)
      totals.monthlyEstimated += number(contract.monthly_value) * cycles
      totals.legacyMonthlyContracts.push(contract.id)
    }
  })

  Object.keys(totals).forEach((key) => { if (typeof totals[key] === 'number') totals[key] = money(totals[key]) })
  totals.legacySetupCount = totals.legacySetupContracts.length
  totals.legacyMonthlyCount = totals.legacyMonthlyContracts.length
  totals.totalExpected = money(totals.setupContracted + totals.monthlyExpected + totals.monthlyEstimated)
  totals.totalReceived = money(totals.setupReceived + totals.monthlyReceived)
  totals.totalOpen = money(totals.setupPending + totals.monthlyPending)
  totals.totalOverdue = money(totals.setupOverdue + totals.monthlyOverdue)
  totals.totalFuture = money(totals.setupFuture + totals.monthlyFuture)
  totals.hasEstimatedMonthlyRevenue = totals.legacyMonthlyCount > 0
  return totals
}

export function calculateAllocationIntegrity(installments = []) {
  return installments.map((item) => {
    const allocated = money((item.invoice_installment_allocations || []).reduce((sum, allocation) => sum + number(allocation.amount), 0))
    const difference = money(number(item.amount) - allocated)
    return { installmentId: item.id, amount: money(item.amount), allocated, difference, valid: difference === 0 }
  })
}
