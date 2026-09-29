// Resumo diário de tarefas por WhatsApp para cada membro ativo da equipe. Proativo (fora de qualquer
// janela de atendimento de 24h) — por isso depende de um template Meta aprovado (nunca texto livre).
// Deploy e cron são manuais. Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_ACCESS_TOKEN,
// TEAM_DAILY_BRIEF_WORKER_KEY e, opcionalmente, TEAM_DAILY_BRIEF_HOUR (default 8, America/Sao_Paulo).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizePhoneForWhatsApp } from '../_shared/internalCommandCore.js'
import { buildDailyBriefDisplayText, buildDailyBriefSummary, selectDailyBriefTasks, shouldRunDailyBrief, todayInSaoPaulo } from '../_shared/teamDailyBriefCore.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const clean = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)
const log = (event: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...details }))
const TEMPLATE = 'mugo_resumo_diario_equipe', LANGUAGE = 'pt_BR'

// Nunca atualiza um contato/conversa já existente (essa conversa pertence ao fluxo do assistente
// interno) — só encontra ou, na primeira vez, cria o mínimo necessário para ter um conversation_id.
async function findOrCreateInternalConversation(admin: any, organizationId: string, connectionId: string, phone: string, member: any) {
  const existingContact = await admin.from('whatsapp_contacts').select('id').eq('connection_id', connectionId).eq('wa_id', phone).maybeSingle()
  if (existingContact.error) throw existingContact.error
  let contactId = existingContact.data?.id
  if (!contactId) {
    const created = await admin.from('whatsapp_contacts').insert({ organization_id: organizationId, connection_id: connectionId, wa_id: phone, contact_type: 'internal', team_member_id: member.id, display_name: member.name }).select('id').single()
    if (created.error) {
      if (created.error.code !== '23505') throw created.error
      const retry = await admin.from('whatsapp_contacts').select('id').eq('connection_id', connectionId).eq('wa_id', phone).single()
      if (retry.error) throw retry.error
      contactId = retry.data.id
    } else contactId = created.data.id
  }
  const existingConversation = await admin.from('whatsapp_conversations').select('id').eq('connection_id', connectionId).eq('wa_id', phone).maybeSingle()
  if (existingConversation.error) throw existingConversation.error
  if (existingConversation.data) return existingConversation.data.id
  const created = await admin.from('whatsapp_conversations').insert({ organization_id: organizationId, connection_id: connectionId, contact_id: contactId, wa_id: phone }).select('id').single()
  if (created.error) {
    if (created.error.code !== '23505') throw created.error
    const retry = await admin.from('whatsapp_conversations').select('id').eq('connection_id', connectionId).eq('wa_id', phone).single()
    if (retry.error) throw retry.error
    return retry.data.id
  }
  return created.data.id
}

async function sendDailyBrief(admin: any, organizationId: string, member: any, taskRows: any[]) {
  const phone = normalizePhoneForWhatsApp(member.phone)
  if (!phone) { log('team_daily_brief_skipped', { reason: 'INVALID_PHONE', team_member_id: member.id }); return false }
  const today = todayInSaoPaulo()
  const { todayTasks, overdueTasks } = selectDailyBriefTasks(taskRows, today)
  // Sem nenhuma demanda de hoje nem atrasada, o worker não envia mensagem nenhuma.
  if (!todayTasks.length && !overdueTasks.length) return false
  const idempotencyKey = `team-daily-brief:${member.id}:${today}`
  const connection = await admin.from('whatsapp_connections').select('id,phone_number_id,waba_id').eq('organization_id', organizationId).in('status', ['active', 'degraded']).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (connection.error) throw connection.error
  if (!connection.data) { log('team_daily_brief_skipped', { reason: 'NO_CONNECTION', team_member_id: member.id }); return false }
  // Uma pessoa nunca recebe o resumo duas vezes no mesmo dia — checa antes de qualquer outra coisa.
  const existing = await admin.from('whatsapp_messages').select('id').eq('connection_id', connection.data.id).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return false
  const template = await admin.from('whatsapp_message_templates').select('id').eq('organization_id', organizationId).eq('waba_id', connection.data.waba_id).eq('name', TEMPLATE).eq('language', LANGUAGE).eq('status', 'APPROVED').eq('is_active', true).maybeSingle()
  if (template.error) throw template.error
  if (!template.data) { log('team_daily_brief_skipped', { reason: 'TEMPLATE_NOT_APPROVED', team_member_id: member.id, template: TEMPLATE }); return false }
  const firstName = clean(member.name).split(/\s+/)[0] || clean(member.name)
  const summaryParameter = buildDailyBriefSummary({ todayTasks, overdueTasks })
  const components = [{ type: 'body', parameters: [{ type: 'text', text: firstName }, { type: 'text', text: summaryParameter }] }]
  const conversationId = await findOrCreateInternalConversation(admin, organizationId, connection.data.id, phone, member)
  const displayText = buildDailyBriefDisplayText({ firstName, todayTasks, overdueTasks })
  const reserved = await admin.from('whatsapp_messages').insert({ organization_id: organizationId, connection_id: connection.data.id, conversation_id: conversationId, team_member_id: member.id, idempotency_key: idempotencyKey, direction: 'out', message_type: 'template', status: 'queued', template_name: TEMPLATE, template_language: LANGUAGE, template_components: components, text_content: displayText }).select('id').single()
  if (reserved.error) { if (reserved.error.code === '23505') return false; throw reserved.error }
  const token = Deno.env.get('META_ACCESS_TOKEN') || ''
  if (!token) throw new Error('META_ACCESS_TOKEN ausente.')
  const now = new Date().toISOString()
  const response = await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION') || 'v23.0'}/${connection.data.phone_number_id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'template', template: { name: TEMPLATE, language: { code: LANGUAGE }, components } }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => ({})), providerId = clean(body?.messages?.[0]?.id, 240)
  if (!response.ok || !providerId) {
    await admin.from('whatsapp_messages').update({ status: 'failed', failed_at: now, error_code: String(response.status), error_message: clean(body?.error?.message) }).eq('id', reserved.data.id)
    log('team_daily_brief_send_failed', { team_member_id: member.id, status: response.status, error: clean(body?.error?.message) })
    return false
  }
  await Promise.all([
    admin.from('whatsapp_messages').update({ provider_message_id: providerId, status: 'accepted', sent_at: now }).eq('id', reserved.data.id),
    admin.from('whatsapp_conversations').update({ last_message_at: now, last_outbound_at: now }).eq('id', conversationId),
  ])
  return true
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const expected = Deno.env.get('TEAM_DAILY_BRIEF_WORKER_KEY') || ''
  if (!expected || request.headers.get('X-Team-Daily-Brief-Worker-Key') !== expected) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
  const url = Deno.env.get('SUPABASE_URL') || '', service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !service) return json({ ok: false, code: 'CONFIGURATION_MISSING' }, 503)
  // Nunca hardcoda o horário na regra de negócio: TEAM_DAILY_BRIEF_HOUR (default 8) e o relógio de
  // America/Sao_Paulo decidem se este disparo do cron deve efetivamente enviar algo. Fim de semana nunca
  // envia; a idempotência por membro+data cobre o cron rodando várias vezes na mesma janela.
  const configuredHour = Number(Deno.env.get('TEAM_DAILY_BRIEF_HOUR') || 8)
  if (!shouldRunDailyBrief(new Date(), configuredHour)) return json({ ok: true, skipped: 'outside_window' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const members = await admin.from('team_members').select('id,name,phone,organization_id').eq('active', true).not('phone', 'is', null)
  if (members.error) return json({ ok: false, code: 'MEMBERS_READ_FAILED' }, 500)
  const today = todayInSaoPaulo()
  let eligible = 0, sent = 0
  for (const member of members.data || []) {
    eligible += 1
    try {
      // Nunca mistura tarefas entre membros: assigned_to=member.id é a única fonte de verdade.
      const rows = await admin.from('crm_tasks').select('id,title,due_date,due_time,priority,client_id,clients(company_name,trade_name)')
        .eq('organization_id', member.organization_id).eq('assigned_to', member.id)
        .not('status', 'in', '(completed,cancelled)').lte('due_date', today).order('due_date').order('due_time')
      if (rows.error) throw rows.error
      if (await sendDailyBrief(admin, member.organization_id, member, rows.data || [])) sent += 1
    } catch (error) {
      log('team_daily_brief_failed', { team_member_id: member.id, error: clean((error as any)?.message) })
    }
  }
  return json({ ok: true, eligible, sent })
})
