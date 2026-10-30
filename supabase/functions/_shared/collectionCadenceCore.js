// Régua de cobrança: decide se agora é hora de enviar a cobrança de uma parcela.

const toMinutes = (value) => { const match = String(value || '').match(/^(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : null }
const pad = (value) => String(value).padStart(2, '0')
export const normalizeTimes = (times, fallback) => {
  const list = (Array.isArray(times) ? times : []).map(toMinutes).filter((value) => value != null && value >= 0 && value < 24 * 60)
  const unique = [...new Set(list.length ? list : fallback.map(toMinutes))].sort((a, b) => a - b)
  return unique.map((value) => `${pad(Math.floor(value / 60))}:${pad(value % 60)}`)
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

// Último horário da régua que já passou hoje (com tolerância), ou null.
// Só o mais recente: se o robô ficou parado, não dispara três mensagens de uma vez.
export function currentCollectionSlot({ dueDate, today, now, dueDayTimes, overdueTimes, maxOverdueDays = 15, graceMinutes = 180 }) {
  if (!dueDate || !today || dueDate > today) return null
  const late = daysBetween(dueDate, today)
  if (late > maxOverdueDays) return null
  const times = late === 0 ? normalizeTimes(dueDayTimes, ['09:00', '12:00', '18:00']) : normalizeTimes(overdueTimes, ['09:00'])
  const current = toMinutes(now)
  const passed = times.filter((time) => toMinutes(time) <= current)
  if (!passed.length) return null
  const slot = passed[passed.length - 1]
  if (current - toMinutes(slot) > graceMinutes) return null
  return { slotKey: `${today}@${slot}`, time: slot, daysLate: late }
}

// "Já realizei o pagamento" depois do vencimento suspende a régua daquela parcela até a conferência.
export function paymentClaimBlocks(claims, installment) {
  return (Array.isArray(claims) ? claims : []).some((claim) => {
    const details = claim?.details || {}
    if (details.installment_id && details.installment_id !== installment.id) return false
    if (!details.installment_id && details.client_id && details.client_id !== installment.client_id) return false
    const claimedDay = String(details.claimed_at || claim.created_at || '').slice(0, 10)
    return claimedDay >= String(installment.due_date)
  })
}
