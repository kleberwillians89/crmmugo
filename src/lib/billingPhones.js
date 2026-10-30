import { isValidBrazilianPhone, normalizeBrazilianPhone } from './whatsapp.js'

const clean = (value) => String(value ?? '').trim()

// Lista de números para cobrança: contatos cadastrados (principal primeiro) e, como reserva,
// os campos antigos do cliente — sem repetir o mesmo número.
export function billingPhoneOptions(client = {}, contacts = []) {
  const seen = new Set(), options = []
  const add = (name, phone, source, isPrimary = false) => {
    if (!isValidBrazilianPhone(phone)) return
    const key = normalizeBrazilianPhone(phone)
    if (seen.has(key)) return
    seen.add(key)
    options.push({ name: clean(name) || 'Contato', phone: clean(phone), source, isPrimary })
  }
  [...contacts].filter((item) => item.active !== false).sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))).forEach((item) => add(item.name, item.phone, item.role || (item.is_primary ? 'Principal' : 'Contato'), item.is_primary))
  add(client.billing_contact_name || client.contact_name || client.company_name, client.billing_contact_phone, 'contato financeiro')
  add(client.contact_name || client.company_name, client.phone, 'telefone principal')
  if (options.length && !options.some((item) => item.isPrimary)) options[0].isPrimary = true
  return options
}
