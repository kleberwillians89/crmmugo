// Cobrança pelo WhatsApp interno: escolha do número e valor editável antes do disparo.
import { foldText, normalizePhoneForWhatsApp } from './internalCommandCore.js'

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max)

// "2300", "2.300", "R$ 2.300,00", "valor 2300", "muda pra 2500", "2500 reais". Retorna null se a
// mensagem não for só um valor (para não sequestrar "sim", "não" ou outro pedido).
export function parseCollectionAmount(text) {
  const folded = foldText(text).replace(/[.!?]+$/, '').trim()
  const match = folded.match(/^(?:(?:o\s+)?valor\s*(?:e|eh|:|de|=)?\s*|(?:muda|altera|troca|coloca|bota|manda|cobra)\s*(?:o valor\s*)?(?:para|pra|pro|por|de)?\s*)?(?:r\$\s*)?(\d[\d.,]*)(?:\s*(?:reais|real|conto|contos))?$/)
  if (!match) return null
  let raw = match[1]
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.')
  else if (/\.\d{3}$/.test(raw) || (raw.match(/\./g) || []).length > 1) raw = raw.replace(/\./g, '')
  const amount = Math.round(Number(raw) * 100) / 100
  // Números de 1 dígito/2 dígitos são escolha de lista, não valor de cobrança.
  return Number.isFinite(amount) && amount >= 50 && amount <= 1_000_000 ? amount : null
}

// Números possíveis para a cobrança: contatos ativos (principal primeiro) e, como reserva, os campos
// antigos do cliente. Sem repetir número e só números válidos para WhatsApp.
export function collectionPhoneOptions(client = {}, contacts = []) {
  const seen = new Set(), options = []
  const add = (name, phone, isPrimary = false) => {
    const normalized = normalizePhoneForWhatsApp(phone)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    options.push({ name: clean(name, 120) || 'Contato', phone: `+${normalized}`, is_primary: isPrimary })
  }
  const sorted = [...(Array.isArray(contacts) ? contacts : [])].filter((row) => row && row.active !== false)
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))
  sorted.forEach((row) => add(row.name, row.phone, Boolean(row.is_primary)))
  add(client.billing_contact_name || client.contact_name || client.trade_name || client.company_name, client.billing_contact_phone)
  add(client.contact_name || client.trade_name || client.company_name, client.phone)
  if (options.length && !options.some((item) => item.is_primary)) options[0].is_primary = true
  return options
}

export function formatCollectionPhone(phone) {
  const digits = normalizePhoneForWhatsApp(phone)
  if (!digits) return clean(phone, 40)
  if (/^55\d{11}$/.test(digits)) return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`
  if (/^55\d{10}$/.test(digits)) return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`
  return `+${digits}`
}

export function collectionPhoneQuestion(clientName, options) {
  return `${clientName} tem ${options.length} números. Para qual envio a cobrança?\n\n${options.map((item, index) => `${index + 1}. ${item.name} — ${formatCollectionPhone(item.phone)}${item.is_primary ? ' (principal)' : ''}`).join('\n')}\n\nResponda com o número da lista.`
}

export function collectionConfirmation({ clientName, amountLabel, contactName, phone }) {
  return `Enviar cobrança de ${clientName} de ${amountLabel} para ${contactName} (${formatCollectionPhone(phone)})?\n\nResponda *sim*, *não* ou mande outro valor (ex.: 2300).`
}
