// Dados das áreas novas: Base da IA, Prospecção e E-mail marketing.
import { db, unwrap } from './provider'

async function invoke(name, body) {
  const { data, error } = await db().functions.invoke(name, { body })
  if (error) {
    let message = error.message
    try { const parsed = await error.context?.json?.(); if (parsed?.message) message = parsed.message } catch { /* corpo não-JSON */ }
    throw new Error(message || 'Falha ao falar com o servidor.')
  }
  if (!data?.ok) throw Object.assign(new Error(data?.message || 'Operação indisponível.'), { code: data?.code })
  return data.data
}

// ---------------------------------------------------------------- Base da IA / atendimento
export const KNOWLEDGE_CATEGORIES = [
  ['empresa', 'Sobre a Mugô'],
  ['servicos', 'Serviços'],
  ['precos', 'Preços que podem ser ditos'],
  ['cases', 'Cases e resultados'],
  ['faq', 'Perguntas frequentes'],
  ['regras', 'O que a IA não pode dizer'],
  ['tom', 'Tom de voz'],
]
export const listKnowledge = async () => unwrap(await db().from('ai_knowledge_entries').select('*').order('category').order('sort_order').order('created_at'))
export const saveKnowledge = async (entry) => {
  const values = { category: entry.category, title: entry.title.trim(), content: entry.content.trim(), active: entry.active !== false, sort_order: Number(entry.sort_order || 0) }
  if (entry.id) return unwrap(await db().from('ai_knowledge_entries').update(values).eq('id', entry.id).select().single())
  return unwrap(await db().from('ai_knowledge_entries').insert(values).select().single())
}
export const deleteKnowledge = async (id) => unwrap(await db().from('ai_knowledge_entries').delete().eq('id', id))

export const getCommercialSettings = async () => unwrap(await db().from('commercial_settings').select('*').maybeSingle())
export const updateCommercialSettings = async (organizationId, patch) => unwrap(await db().from('commercial_settings').update(patch).eq('organization_id', organizationId).select().single())

// Rascunhos do modo copiloto
export const listPendingDrafts = async (conversationId) => unwrap(await db().from('commercial_reply_drafts').select('*').eq('conversation_id', conversationId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1))
export const decideDraft = async (id, status, finalText = null) => unwrap(await db().from('commercial_reply_drafts').update({ status, final_text: finalText, decided_at: new Date().toISOString(), decided_by: (await db().auth.getUser()).data.user?.id || null }).eq('id', id).eq('status', 'pending'))

// ---------------------------------------------------------------- Prospecção
export const PROSPECT_STATUSES = [
  ['new', 'Novo'], ['ready', 'Pronto para abordar'], ['contacted', 'Abordado'], ['replied', 'Respondeu'],
  ['meeting', 'Reunião'], ['converted', 'Virou cliente'], ['disqualified', 'Sem perfil'], ['do_not_contact', 'Não contatar'],
]
export const listProspects = async () => unwrap(await db().from('prospects').select('*,prospect_lists(name)').order('updated_at', { ascending: false }).limit(1000))
export const listProspectLists = async () => unwrap(await db().from('prospect_lists').select('*').order('created_at', { ascending: false }))
export const createProspectList = async (values) => unwrap(await db().from('prospect_lists').insert(values).select().single())
export const listProspectActivities = async (prospectId) => unwrap(await db().from('prospect_activities').select('*').eq('prospect_id', prospectId).order('created_at', { ascending: false }).limit(50))
export const listProspectQueue = async (prospectId) => unwrap(await db().from('outreach_email_queue').select('*').eq('prospect_id', prospectId).order('step'))
export const updateProspect = async (id, patch) => unwrap(await db().from('prospects').update(patch).eq('id', id).select('*,prospect_lists(name)').single())
export const createProspect = async (values) => unwrap(await db().from('prospects').insert(values).select('*,prospect_lists(name)').single())
export async function importProspects(rows, listId) {
  const payload = rows.map((row) => ({ ...row, list_id: listId || null, source: 'csv' }))
  let inserted = 0, duplicates = 0
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200)
    const { error, data } = await db().from('prospects').insert(chunk).select('id')
    if (!error) { inserted += data.length; continue }
    if (error.code !== '23505') throw error
    // tem duplicado no lote: insere um a um e conta os repetidos
    for (const row of chunk) {
      const single = await db().from('prospects').insert(row)
      if (single.error?.code === '23505') duplicates += 1
      else if (single.error) throw single.error
      else inserted += 1
    }
  }
  return { inserted, duplicates }
}
export const logProspectActivity = async (prospectId, channel, activityType, content = null) => unwrap(await db().from('prospect_activities').insert({ prospect_id: prospectId, channel, activity_type: activityType, content }))
export const getOutreachSettings = async () => unwrap(await db().from('outreach_settings').select('*').maybeSingle())
export const saveOutreachSettings = async (values) => unwrap(await db().from('outreach_settings').upsert(values, { onConflict: 'organization_id' }).select().single())

export const researchProspects = (ids) => invoke('prospecting', { action: 'research', prospect_ids: ids })
export const approveProspectEmails = (ids) => invoke('prospecting', { action: 'approve_email', prospect_ids: ids })
export const stopProspectSequence = (id) => invoke('prospecting', { action: 'stop_sequence', prospect_ids: [id] })
export const convertProspect = (id, channel, note) => invoke('prospecting', { action: 'convert', prospect_id: id, channel, note })
export const sendProspectTest = (id) => invoke('prospecting', { action: 'send_test', prospect_id: id })

// ---------------------------------------------------------------- E-mail marketing
export const listEmailContacts = async () => unwrap(await db().from('email_contacts').select('*').order('created_at', { ascending: false }).limit(5000))
export const addEmailContact = async (values) => unwrap(await db().from('email_contacts').insert({ ...values, email: values.email.trim().toLowerCase() }).select().single())
export const updateEmailContact = async (id, patch) => unwrap(await db().from('email_contacts').update(patch).eq('id', id).select().single())
export const syncContactsFromCrm = async () => unwrap(await db().rpc('sync_email_contacts_from_crm'))
export const listCampaigns = async () => unwrap(await db().from('email_campaigns').select('*').order('created_at', { ascending: false }))
export const saveCampaign = async (campaign) => {
  const values = { name: campaign.name, subject: campaign.subject, preheader: campaign.preheader || null, html: campaign.html, from_name: campaign.from_name || null, from_email: campaign.from_email || null, reply_to: campaign.reply_to || null, audience: campaign.audience || { tags: [], sources: [] }, scheduled_for: campaign.scheduled_for || null }
  if (campaign.id) return unwrap(await db().from('email_campaigns').update(values).eq('id', campaign.id).select().single())
  return unwrap(await db().from('email_campaigns').insert(values).select().single())
}
export const scheduleCampaign = async (id, when) => unwrap(await db().from('email_campaigns').update({ status: 'scheduled', scheduled_for: when }).eq('id', id).select().single())
export const unscheduleCampaign = async (id) => unwrap(await db().from('email_campaigns').update({ status: 'draft', scheduled_for: null }).eq('id', id).eq('status', 'scheduled').select().single())
export const campaignAudienceCount = (id) => invoke('email-campaigns', { action: 'audience_count', campaign_id: id })
export const sendCampaignTest = (id, emails) => invoke('email-campaigns', { action: 'send_test', campaign_id: id, emails })
export const sendCampaignNow = (id) => invoke('email-campaigns', { action: 'send_now', campaign_id: id })
export const refreshCampaignStats = (id) => invoke('email-campaigns', { action: 'refresh_stats', campaign_id: id })
