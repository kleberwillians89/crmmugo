// Aceita "2500", "2.500", "2.500,50", "R$ 2500,00", "2500.5".
export function parseMoneyInput(value) {
  let raw = String(value ?? '').replace(/[^\d,.]/g, '')
  if (!raw) return null
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.')
  else if (/\.\d{3}$/.test(raw) || (raw.match(/\./g) || []).length > 1) raw = raw.replace(/\./g, '')
  const amount = Math.round(Number(raw) * 100) / 100
  return Number.isFinite(amount) && amount > 0 ? amount : null
}
