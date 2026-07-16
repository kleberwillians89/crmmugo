const raw = value => String(value ?? '').trim()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizePhoneToDigits(value) {
  const input = raw(value)
  if (!input || uuid.test(input)) return null
  const withoutJid = input.replace(/@(s\.whatsapp\.net|c\.us)$/i, '')
  const digits = withoutJid.replace(/\D/g, '')
  return /^\d{10,15}$/.test(digits) ? digits : null
}

export function normalizeBrazilianPhone(value) {
  let phone = normalizePhoneToDigits(value)
  if (!phone) return null
  if (phone.startsWith('00')) phone = phone.slice(2)
  if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) phone = `55${phone}`
  return /^55[1-9]{2}\d{8,9}$/.test(phone) ? phone : null
}

export function normalizePhoneToE164(value) {
  const digits = normalizeBrazilianPhone(value) || normalizePhoneToDigits(value)
  return digits ? `+${digits}` : null
}

export function isValidPhoneNumber(value) {
  return Boolean(normalizePhoneToE164(value))
}

export function formatPhoneForDisplay(value) {
  const phone = normalizePhoneToDigits(value)
  if (!phone) return 'Número não informado'
  if (phone.startsWith('55') && phone.length === 13) return `+55 (${phone.slice(2,4)}) ${phone.slice(4,9)}-${phone.slice(9)}`
  if (phone.startsWith('55') && phone.length === 12) return `+55 (${phone.slice(2,4)}) ${phone.slice(4,8)}-${phone.slice(8)}`
  return `+${phone}`
}
