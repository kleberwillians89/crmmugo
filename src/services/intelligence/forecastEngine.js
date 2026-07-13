const DAY = 86400000
const date = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : null

export function buildForecast(data = {}, now = new Date()) {
  const windows = [30, 60, 90, 180, 365]
  const active = (data.contracts || []).filter((contract) => contract.status === 'active' && contract.signed && Number(contract.monthly_value) > 0)
  return windows.map((days) => {
    const limit = new Date(now.getTime() + days * DAY)
    let recurring = 0
    let renewals = 0
    active.forEach((contract) => {
      const start = date(contract.start_date) || now
      const end = date(contract.end_date)
      const from = start > now ? start : now
      const until = end && end < limit ? end : limit
      if (until >= from) recurring += Math.max(1, Math.ceil((until - from) / DAY / 30)) * Number(contract.monthly_value)
      if (contract.auto_renew && end && end >= now && end <= limit) renewals += Number(contract.monthly_value)
    })
    return { days, recurring, renewals, total: recurring + renewals, contracts: active.length }
  })
}
