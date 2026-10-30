import { db, isSupabaseProvider, legacyUnavailable, organizationId, unwrap } from './provider'
import { invalidateCrmData } from '../../lib/dataInvalidation'
import { isValidBrazilianPhone, normalizeBrazilianPhone } from '../../lib/whatsapp'

const FIELDS = 'id,client_id,name,phone,email,role,is_primary,active,notes,created_at'
const clean = (value) => String(value ?? '').trim()

// Guarda sempre em E.164 ("+5511992000357", "+34632881089") para não haver dúvida de país.
export function storablePhone(value) {
  const raw = clean(value)
  if (!raw) return null
  if (!isValidBrazilianPhone(raw)) throw new Error('Telefone inválido. Use DDD (ex.: 11 99999-9999) ou + e o código do país.')
  return `+${normalizeBrazilianPhone(raw)}`
}

function payload(values) {
  const name = clean(values.name)
  if (!name) throw new Error('Informe o nome do contato.')
  return { name, phone: storablePhone(values.phone), email: clean(values.email) || null, role: clean(values.role) || null, notes: clean(values.notes) || null }
}

export async function listClientContacts(clientId) {
  if (!isSupabaseProvider() || !clientId) return []
  const response = await db().from('client_contacts').select(FIELDS).eq('client_id', clientId).eq('active', true)
    .order('is_primary', { ascending: false }).order('created_at')
  // Antes da migration de 30/10/2026 a tabela não existe: segue com os campos antigos do cliente.
  if (response.error?.code === '42P01' || response.error?.code === 'PGRST205') return []
  return unwrap(response)
}

export async function createClientContact(clientId, values) {
  if (!isSupabaseProvider()) return legacyUnavailable('Contatos')
  const row = unwrap(await db().from('client_contacts').insert({ ...payload(values), client_id: clientId, organization_id: await organizationId(), is_primary: false }).select(FIELDS).single())
  if (values.is_primary) await setPrimaryClientContact(row.id)
  invalidateCrmData({ resources: ['clients'] })
  return row
}

export async function updateClientContact(id, values) {
  if (!isSupabaseProvider()) return legacyUnavailable('Contatos')
  const row = unwrap(await db().from('client_contacts').update(payload(values)).eq('id', id).select(FIELDS).single())
  invalidateCrmData({ resources: ['clients'] })
  return row
}

export async function removeClientContact(id) {
  if (!isSupabaseProvider()) return legacyUnavailable('Contatos')
  unwrap(await db().from('client_contacts').update({ active: false, is_primary: false }).eq('id', id))
  invalidateCrmData({ resources: ['clients'] })
}

export async function setPrimaryClientContact(id) {
  if (!isSupabaseProvider()) return legacyUnavailable('Contatos')
  const row = unwrap(await db().rpc('set_primary_client_contact', { p_contact_id: id }))
  invalidateCrmData({ resources: ['clients'] })
  return row
}

export { billingPhoneOptions } from '../../lib/billingPhones'
