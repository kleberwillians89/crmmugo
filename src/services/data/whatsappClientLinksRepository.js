import { db, organizationId, unwrap } from './provider'
import { invalidateCrmData } from '../../lib/dataInvalidation'
import { getConversationIdentifier } from '../whatsapp/operationContracts.js'
import { normalizePhoneToDigits, normalizePhoneToE164 } from '../whatsapp/phoneNormalization.js'

const mutations = new Map()
const singleFlight = (key, operation) => {
  if (mutations.has(key)) return mutations.get(key)
  const task = Promise.resolve().then(operation).finally(() => mutations.delete(key))
  mutations.set(key, task)
  return task
}

export async function listConversationLinks() {
  return unwrap(await db().from('whatsapp_conversation_links').select('*'))
}

export function linkConversationToClient(conversation, clientId, { updatePhone = false } = {}) {
  const waId = getConversationIdentifier(conversation)
  const phone = normalizePhoneToDigits(waId)
  if (!waId || !phone || !clientId) throw new Error('Conversa ou cliente inválido para vínculo.')
  return singleFlight(`link:${waId}`, async () => {
    const organization_id = await organizationId()
    const existing = unwrap(await db().from('whatsapp_conversation_links').select('id,client_id').eq('organization_id', organization_id).eq('wa_id', waId).maybeSingle())
    if (existing && existing.client_id !== clientId) throw new Error('Esta conversa já está vinculada a outro cliente. Desfaça o vínculo antes de continuar.')
    const link = unwrap(await db().from('whatsapp_conversation_links').upsert({
      organization_id,
      client_id: clientId,
      wa_id: waId,
      phone,
      conversation_id: String(conversation.id || waId),
    }, { onConflict: 'organization_id,wa_id' }).select().single())
    if (updatePhone) unwrap(await db().from('clients').update({ phone: normalizePhoneToE164(phone) }).eq('id', clientId).select('id').single())
    invalidateCrmData({ resources: ['clients'] })
    return link
  })
}

export function unlinkConversation(conversation) {
  const waId = getConversationIdentifier(conversation)
  if (!waId) throw new Error('Identificador da conversa ausente.')
  return singleFlight(`unlink:${waId}`, async () => unwrap(await db().from('whatsapp_conversation_links').delete().eq('organization_id', await organizationId()).eq('wa_id', waId).select().maybeSingle()))
}
