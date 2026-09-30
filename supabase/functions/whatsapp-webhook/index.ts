import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  META_STATUS_RANK as statusRank,
  debtAmount,
  formatFinanceCheckAmountReply,
  hashWebhookPayload as hashPayload,
  inboundEventKey,
  isFinanceCheckAmountIntent,
  isPaymentClaimIntent,
  shouldApplyMetaStatus,
  statusEventKey,
  verifyMetaSignature as verifySignature,
  verifyWebhookChallenge,
  webhookDigits as digits,
  webhookMessageContent as messageContent,
  webhookText as text,
  webhookTimestamp as timestamp,
} from '../_shared/whatsappWebhookCore.js'
import { findInternalMemberByPhone } from '../_shared/internalCommandCore.js'
import { classifyConversationKind, extractLeadAttribution } from '../_shared/commercialAgentCore.js'

const jsonHeaders = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders })
const claimWebhookEvent = async (admin: any, connection: any, eventKey: string, eventType: string, payloadHash: string) => {
  const now = new Date().toISOString()
  const inserted = await admin.from('whatsapp_webhook_events').insert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    event_key: eventKey,
    event_type: eventType,
    payload_hash: payloadHash,
    processing_status: 'processing',
    attempts: 1,
    processing_started_at: now,
    processed_at: now,
  }).select('id,processing_status,processing_started_at,updated_at,attempts').single()
  if (!inserted.error) return { claimed: true, id: inserted.data.id }
  if (inserted.error.code !== '23505') throw inserted.error

  const existing = await admin.from('whatsapp_webhook_events')
    .select('id,processing_status,processing_started_at,updated_at,attempts')
    .eq('connection_id', connection.id).eq('event_key', eventKey).single()
  if (existing.error) throw existing.error
  if (existing.data.processing_status === 'completed') return { claimed: false, id: existing.data.id }
  const startedAt = existing.data.processing_started_at || existing.data.updated_at
  const recent = existing.data.processing_status === 'processing'
    && startedAt && Date.now() - new Date(startedAt).getTime() < 2 * 60 * 1000
  if (recent) return { claimed: false, id: existing.data.id }

  const reclaimed = await admin.from('whatsapp_webhook_events').update({
    processing_status: 'processing',
    processing_started_at: now,
    processing_completed_at: null,
    attempts: Number(existing.data.attempts || 0) + 1,
    last_error_code: null,
    last_error_message: null,
  }).eq('id', existing.data.id).eq('updated_at', existing.data.updated_at).select('id').maybeSingle()
  if (reclaimed.error) throw reclaimed.error
  return { claimed: Boolean(reclaimed.data), id: existing.data.id }
}
const completeWebhookEvent = async (admin: any, id: string) => {
  const completed = await admin.from('whatsapp_webhook_events').update({
    processing_status: 'completed',
    processing_completed_at: new Date().toISOString(),
    last_error_code: null,
    last_error_message: null,
  }).eq('id', id).eq('processing_status', 'processing')
  if (completed.error) throw completed.error
}
const failWebhookEvent = async (admin: any, id: string, error: any) => {
  const failed = await admin.from('whatsapp_webhook_events').update({
    processing_status: 'failed',
    last_error_code: text(error?.code || error?.name || 'WEBHOOK_PROCESSING_FAILED', 120),
    last_error_message: text(error?.message || 'Falha ao processar webhook.', 500),
  }).eq('id', id).neq('processing_status', 'completed')
  if (failed.error) throw failed.error
}
const dispatchTaskCommandWorker = async (eventId: string) => {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const workerKey = Deno.env.get('TASK_COMMAND_WORKER_KEY') || ''
  if (!url || !serviceKey || !workerKey) return false
  try {
    const response = await fetch(`${url}/functions/v1/task-command-worker`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'X-Task-Command-Worker-Key': workerKey,
      },
      body: JSON.stringify({ source: 'whatsapp-webhook', event_id: eventId }),
      signal: AbortSignal.timeout(10_000),
    })
    return response.ok
  } catch {
    return false
  }
}
const dispatchCommercialAiWorker = async () => {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const workerKey = Deno.env.get('COMMERCIAL_AI_WORKER_KEY') || ''
  if (!url || !serviceKey || !workerKey) return false
  try {
    const response = await fetch(`${url}/functions/v1/commercial-ai-worker`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'X-Commercial-AI-Worker-Key': workerKey,
      },
      body: JSON.stringify({ source: 'whatsapp-webhook' }),
      signal: AbortSignal.timeout(10_000),
    })
    return response.ok
  } catch {
    return false
  }
}
const processStatus = async (admin: any, connection: any, status: any, payloadHash: string) => {
  const providerMessageId = text(status?.id, 240)
  const nextStatus = text(status?.status, 30).toLowerCase()
  if (!providerMessageId || !(nextStatus in statusRank)) return false
  const eventKey = statusEventKey(providerMessageId, nextStatus, status?.timestamp)
  const ledger = await claimWebhookEvent(admin, connection, eventKey, `message_${nextStatus}`, payloadHash)
  if (!ledger.claimed) return false

  try {
    const current = await admin
    .from('whatsapp_messages')
    .select('id,status')
    .eq('connection_id', connection.id)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()
    if (current.error) throw current.error
    if (!current.data || !shouldApplyMetaStatus(current.data.status, nextStatus)) {
      await completeWebhookEvent(admin, ledger.id)
      return true
    }

  const occurredAt = timestamp(status?.timestamp)
  const error = Array.isArray(status?.errors) ? status.errors[0] : null
  const patch: Record<string, unknown> = {
    status: nextStatus,
    error_code: error ? text(error.code, 120) : null,
    error_message: error ? text(error.error_data?.details || error.message || error.title, 500) : null,
    pricing: status?.pricing && typeof status.pricing === 'object' ? status.pricing : {},
  }
  if (nextStatus === 'sent') patch.sent_at = occurredAt
  if (nextStatus === 'delivered') patch.delivered_at = occurredAt
  if (nextStatus === 'read') patch.read_at = occurredAt
  if (nextStatus === 'failed') patch.failed_at = occurredAt
    const updated = await admin.from('whatsapp_messages').update(patch).eq('id', current.data.id)
    if (updated.error) throw updated.error
    await completeWebhookEvent(admin, ledger.id)
    return true
  } catch (error) {
    await failWebhookEvent(admin, ledger.id, error)
    throw error
  }
}

// READ ONLY sobre financeiro: nunca escreve em invoice_installments/whatsapp_collection_alerts, nunca
// dispara template novo. Resolve o débito atual do cliente (nunca por nome, só pelo client_id já
// vinculado ao contato) e responde por texto livre — a janela de 24h sempre está aberta porque o
// próprio clique/mensagem do cliente acabou de chegar.
const handleFinanceCheckAmount = async (admin: any, connection: any, conversation: any, clientId: string | null, waId: string, providerMessageId: string, phoneNumberId: string) => {
  const idempotencyKey = `finance-check-amount:${providerMessageId}`
  const existing = await admin.from('whatsapp_messages').select('id').eq('connection_id', connection.id).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return
  const org = connection.organization_id
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  let items: any[] = []
  if (clientId) {
    const due = await admin.from('invoice_installments')
      .select('id,reference_month,due_date,amount,original_amount,currency')
      .eq('organization_id', org).eq('client_id', clientId)
      .in('status', ['pending', 'overdue']).eq('received_amount', 0).is('paid_at', null)
      .lte('due_date', today).order('due_date', { ascending: true })
    if (due.error) throw due.error
    items = due.data || []
  }
  let alreadyPaid = false
  if (!items.length && clientId) {
    const lastAlert = await admin.from('whatsapp_collection_alerts').select('installment_id')
      .eq('organization_id', org).eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (lastAlert.error) throw lastAlert.error
    if (lastAlert.data?.installment_id) {
      const installment = await admin.from('invoice_installments').select('status,paid_at').eq('id', lastAlert.data.installment_id).eq('organization_id', org).maybeSingle()
      if (installment.error) throw installment.error
      alreadyPaid = installment.data?.status === 'paid' || Boolean(installment.data?.paid_at)
    }
  }
  const reply = formatFinanceCheckAmountReply(items, alreadyPaid)
  const token = Deno.env.get('META_ACCESS_TOKEN') || ''
  const now = new Date().toISOString()
  const metadata = { source: 'finance', intent: 'FINANCE_CHECK_AMOUNT', client_id: clientId, installment_id: items.length === 1 ? items[0].id : null, currency: items.length === 1 ? items[0].currency : null, amount_used: items.length === 1 ? debtAmount(items[0]) : null }
  if (!token || !phoneNumberId) {
    await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'failed', failed_at: now, text_content: reply, error_code: 'META_CONFIGURATION_MISSING', error_message: 'Transporte Meta não configurado.', metadata })
    return
  }
  let response: Response
  try {
    response = await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION') || 'v23.0'}/${phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, type: 'text', text: { preview_url: false, body: reply.slice(0, 4000) } }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'failed', failed_at: now, text_content: reply, error_code: 'META_UNREACHABLE', error_message: 'Não foi possível contatar a Meta para responder.', metadata })
    throw error
  }
  const body = await response.json().catch(() => ({}))
  const providerId = text(body?.messages?.[0]?.id, 240)
  if (!response.ok || !providerId) {
    await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'failed', failed_at: now, text_content: reply, error_code: String(response.status), error_message: text(body?.error?.message, 500) || 'A Meta recusou o envio da resposta financeira.', metadata })
    return
  }
  const inserted = await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, provider_message_id: providerId, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'accepted', text_content: reply, sent_at: now, metadata })
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error
  await admin.from('whatsapp_conversations').update({ last_message_at: now, last_outbound_at: now, last_outbound_source: 'finance' }).eq('id', conversation.id)
}

// "Já realizei o pagamento" é uma ALEGAÇÃO, nunca uma confirmação — jamais escreve em
// invoice_installments (status/received_amount/paid_at ficam intocados até conferência financeira
// real, fora deste fluxo). Só registra o evento, notifica o responsável e responde ao cliente.
const handlePaymentClaim = async (admin: any, connection: any, conversation: any, clientId: string | null, waId: string, providerMessageId: string, phoneNumberId: string) => {
  const idempotencyKey = `payment-claim:${providerMessageId}`
  const existing = await admin.from('whatsapp_messages').select('id').eq('connection_id', connection.id).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return
  const org = connection.organization_id
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  let claimedItem: any = null
  let clientName = ''
  if (clientId) {
    const [clientResult, due] = await Promise.all([
      admin.from('clients').select('contact_name,trade_name,company_name').eq('id', clientId).eq('organization_id', org).maybeSingle(),
      admin.from('invoice_installments').select('id,reference_month,due_date,amount,original_amount,currency')
        .eq('organization_id', org).eq('client_id', clientId)
        .in('status', ['pending', 'overdue']).eq('received_amount', 0).is('paid_at', null)
        .lte('due_date', today).order('due_date', { ascending: true }).limit(1),
    ])
    if (clientResult.error) throw clientResult.error
    if (due.error) throw due.error
    clientName = text(clientResult.data?.contact_name || clientResult.data?.trade_name || clientResult.data?.company_name, 240)
    claimedItem = due.data?.[0] || null
  }
  const now = new Date().toISOString()
  const eventDetails = {
    kind: 'payment_claimed', provider_message_id: providerMessageId, client_id: clientId, client_name: clientName || null,
    installment_id: claimedItem?.id || null, amount: claimedItem ? debtAmount(claimedItem) : null, currency: claimedItem?.currency || null,
    due_date: claimedItem?.due_date || null, phone: waId, claimed_at: now,
  }
  const eventInserted = await admin.from('whatsapp_conversation_events').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, event_type: 'payment_claimed', details: eventDetails })
  if (eventInserted.error) throw eventInserted.error
  let responsibleId = conversation.assigned_team_member_id
  if (!responsibleId) {
    const settings = await admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id', org).maybeSingle()
    if (settings.error && !['42P01', 'PGRST205'].includes(settings.error.code)) throw settings.error
    responsibleId = settings.data?.commercial_owner_id || null
  }
  if (responsibleId) {
    const notified = await admin.from('team_notification_outbox').insert({
      organization_id: org, team_member_id: responsibleId, notification_type: 'operational_alert',
      idempotency_key: `payment-claim:${providerMessageId}`,
      payload: { kind: 'payment_claimed', conversation_id: conversation.id, ...eventDetails },
    })
    if (notified.error && notified.error.code !== '23505') throw notified.error
  }
  const reply = 'Obrigado. Registramos sua informação e vamos conferir o pagamento.'
  const token = Deno.env.get('META_ACCESS_TOKEN') || ''
  const metadata = { source: 'finance', intent: 'PAYMENT_CLAIMED', client_id: clientId, installment_id: claimedItem?.id || null, currency: claimedItem?.currency || null, amount_used: claimedItem ? debtAmount(claimedItem) : null }
  if (!token || !phoneNumberId) {
    await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'failed', failed_at: now, text_content: reply, error_code: 'META_CONFIGURATION_MISSING', error_message: 'Transporte Meta não configurado.', metadata })
    return
  }
  let response: Response
  try {
    response = await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION') || 'v23.0'}/${phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, type: 'text', text: { preview_url: false, body: reply.slice(0, 4000) } }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'failed', failed_at: now, text_content: reply, error_code: 'META_UNREACHABLE', error_message: 'Não foi possível contatar a Meta para responder.', metadata })
    throw error
  }
  const body = await response.json().catch(() => ({}))
  const providerId = text(body?.messages?.[0]?.id, 240)
  if (!response.ok || !providerId) {
    await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'failed', failed_at: now, text_content: reply, error_code: String(response.status), error_message: text(body?.error?.message, 500) || 'A Meta recusou o envio da resposta.', metadata })
    return
  }
  const inserted = await admin.from('whatsapp_messages').insert({ organization_id: org, connection_id: connection.id, conversation_id: conversation.id, provider_message_id: providerId, idempotency_key: idempotencyKey, direction: 'out', message_type: 'text', status: 'accepted', text_content: reply, sent_at: now, metadata })
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error
  await admin.from('whatsapp_conversations').update({ last_message_at: now, last_outbound_at: now, last_outbound_source: 'finance' }).eq('id', conversation.id)
}

const processInbound = async (admin: any, connection: any, value: any, message: any, payloadHash: string) => {
  const providerMessageId = text(message?.id, 240)
  const waId = digits(message?.from)
  if (!providerMessageId || !waId) return false
  const ledger = await claimWebhookEvent(admin, connection, inboundEventKey(providerMessageId), 'message_received', payloadHash)
  if (!ledger.claimed) return false

  try {
  // A classificação acontece antes de qualquer automação. O escopo da organização
  // é obrigatório e variações brasileiras com/sem nono dígito são equivalentes.
  const members = await admin.from('team_members').select('id,name,phone,auth_profile_id')
    .eq('organization_id', connection.organization_id).eq('active', true).not('phone', 'is', null)
  if (members.error) throw members.error
  const internalMember = findInternalMemberByPhone(members.data || [], waId)
  const senderType = internalMember ? 'internal' : 'customer'

  const content = messageContent(message)
  const attribution = extractLeadAttribution({ referral: message?.referral?.source_type, metadata: message?.referral || {} })
  const priorContact = await admin.from('whatsapp_contacts').select('source,campaign,ad_name,utm').eq('organization_id',connection.organization_id).eq('connection_id',connection.id).eq('wa_id',waId).maybeSingle()
  if(priorContact.error)throw priorContact.error
  const preservedUtm = { ...(priorContact.data?.utm || {}), ...Object.fromEntries(Object.entries(attribution.utm).filter(([,item])=>item)) }
  const profileName = text((value?.contacts || []).find((item: any) => digits(item?.wa_id) === waId)?.profile?.name, 240)
  const contactResult = await admin.from('whatsapp_contacts').upsert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    wa_id: waId,
    display_name: profileName || null,
    profile_name: profileName || null,
    contact_type: senderType,
    team_member_id: internalMember?.id || null,
    ...(!internalMember ? { source: priorContact.data?.source || attribution.source, campaign: priorContact.data?.campaign || attribution.campaign, ad_name: priorContact.data?.ad_name || attribution.ad_name, utm: preservedUtm } : {}),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,wa_id' }).select('id,client_id').single()
  if (contactResult.error) throw contactResult.error

  const occurredAt = timestamp(message?.timestamp)
  // Uma automação pausada sem dono real (handoff manual antigo/de teste, nunca atribuído a um membro
  // do time) não pode travar um lead para sempre. Só reabre sozinha quando NÃO há
  // assigned_team_member_id (nenhum humano realmente dono da conversa) e o handoff está ausente ou já
  // passou da janela de atendimento de 24h (a mesma usada abaixo em service_window_expires_at) — um
  // handoff com responsável atribuído nunca é resetado por tempo, seja qual for o intervalo.
  const priorConversation = await admin.from('whatsapp_conversations').select('automation_paused,assigned_team_member_id,handoff_at')
    .eq('connection_id', connection.id).eq('wa_id', waId).maybeSingle()
  if (priorConversation.error) throw priorConversation.error
  const stalePause = Boolean(priorConversation.data?.automation_paused) && !priorConversation.data?.assigned_team_member_id
    && (!priorConversation.data?.handoff_at || Date.now() - new Date(priorConversation.data.handoff_at).getTime() > 24 * 60 * 60 * 1000)
  const conversationResult = await admin.from('whatsapp_conversations').upsert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    contact_id: contactResult.data.id,
    wa_id: waId,
    status: 'open',
    service_window_expires_at: new Date(new Date(occurredAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    last_message_at: occurredAt,
    last_inbound_at: occurredAt,
    ...(stalePause ? { attendance_mode: 'bot', automation_paused: false, handoff_reason: null, handoff_at: null } : {}),
  }, { onConflict: 'connection_id,wa_id' }).select('id,attendance_mode,automation_paused,assigned_team_member_id,opportunity_id,handoff_at,queue').single()
  if (conversationResult.error) throw conversationResult.error

  const saved = await admin.from('whatsapp_messages').insert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    conversation_id: conversationResult.data.id,
    provider_message_id: providerMessageId,
    direction: 'in',
    message_type: content.type,
    status: 'received',
    sender_type: senderType,
    team_member_id: internalMember?.id || null,
    text_content: content.body || null,
    media: content.media,
    provider_timestamp: occurredAt,
  }).select('id').single()
  if (saved.error && saved.error.code !== '23505') throw saved.error
  if (!saved.error) {
    const unread = await admin.rpc('increment_whatsapp_unread', { p_conversation_id: conversationResult.data.id })
    if (unread.error) throw unread.error
  }

  const pendingFollowUps = await admin.from('whatsapp_follow_ups').select('automation_run_id')
    .eq('conversation_id', conversationResult.data.id).in('status', ['scheduled', 'failed'])
  await admin.from('whatsapp_follow_ups').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    last_error_code: 'CONTACT_REPLIED',
  }).eq('conversation_id', conversationResult.data.id).in('status', ['scheduled', 'failed'])
  const runIds = (pendingFollowUps.data || []).map((item: any) => item.automation_run_id).filter(Boolean)
  if (runIds.length) {
    await admin.from('automation_events').update({ status: 'skipped', processed_at: new Date().toISOString() })
      .eq('event_type', 'automation_resume').in('subject_id', runIds)
  }
  await admin.from('whatsapp_conversations').update({ follow_up_at: null }).eq('id', conversationResult.data.id)

  if (internalMember) {
    const queuedCommand = await admin.from('task_command_events').insert({
      organization_id: connection.organization_id,
      connection_id: connection.id,
      provider_message_id: providerMessageId,
      message_id: saved.data?.id || null,
      message_type: content.type,
      media: content.media || {},
      conversation_id: conversationResult.data.id,
      wa_id: waId,
      team_member_id: internalMember.id,
      raw_text: content.body || '',
      status: 'pending',
    }).select('id').single()
    if (queuedCommand.error && queuedCommand.error.code !== '23505') throw queuedCommand.error
    let commandEventId=queuedCommand.data?.id
    if(!commandEventId){
      const existingCommand=await admin.from('task_command_events').select('id').eq('connection_id',connection.id).eq('provider_message_id',providerMessageId).single()
      if(existingCommand.error)throw existingCommand.error
      commandEventId=existingCommand.data.id
    }
    // A fila continua durável; o ledger só conclui depois que o dispatch imediato foi aceito.
    if (!(await dispatchTaskCommandWorker(commandEventId))) {
      throw Object.assign(new Error('Task command worker dispatch failed.'), { code: 'TASK_COMMAND_DISPATCH_FAILED' })
    }
    await completeWebhookEvent(admin,ledger.id)
    return true
  }

  // Prioridade absoluta do humano: se a conversa já está com uma pessoa (ou a automação foi pausada),
  // a mensagem só é persistida — nenhum evento automático é criado, para não haver corrida entre o
  // bot e quem já assumiu o atendimento.
  const humanControlled = conversationResult.data.attendance_mode === 'human' || conversationResult.data.automation_paused === true
  if (humanControlled) {
    let responsibleId=conversationResult.data.assigned_team_member_id
    if(!responsibleId){
      const settings=await admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id',connection.organization_id).maybeSingle()
      if(settings.error&&!['42P01','PGRST205'].includes(settings.error.code))throw settings.error
      responsibleId=settings.data?.commercial_owner_id||null
    }
    if(responsibleId){
      // Sinal só informativo (nunca cria opportunity nem retoma automação) — uma nova demanda comercial
      // chegando durante um handoff de suporte não pode ficar invisível para quem já está com a conversa.
      const commercialSignal=classifyConversationKind(content.body||'',{hasExistingClient:Boolean(contactResult.data.client_id)}).kind
      const notified=await admin.from('team_notification_outbox').insert({organization_id:connection.organization_id,team_member_id:responsibleId,notification_type:'human_mode_message',idempotency_key:`human-mode-message:${providerMessageId}`,payload:{kind:'human_mode_message',conversation_id:conversationResult.data.id,opportunity_id:conversationResult.data.opportunity_id,lead_name:profileName||null,lead_phone:waId,preview:content.body||content.type,commercial_signal:commercialSignal,candidate_items:[{index:1,type:'conversation',conversation_id:conversationResult.data.id,label:profileName||`Contato final ${waId.slice(-4)}`}]}})
      if(notified.error&&notified.error.code!=='23505')throw notified.error
    }
    await completeWebhookEvent(admin, ledger.id)
    return true
  }

  // FINANCE_CHECK_AMOUNT tem prioridade sobre a IA comercial dentro de contexto financeiro — nunca cai
  // no commercial-ai-worker nem responde "vou encaminhar para o comercial" para uma pergunta de valor.
  // Consulta é sempre READ ONLY sobre invoice_installments; nunca cria/altera cobrança ou installment.
  const financeContext = conversationResult.data.queue === 'finance_collection'
  if (financeContext && isFinanceCheckAmountIntent(content)) {
    await handleFinanceCheckAmount(admin, connection, conversationResult.data, contactResult.data.client_id, waId, providerMessageId, digits(value?.metadata?.phone_number_id))
    await completeWebhookEvent(admin, ledger.id)
    return true
  }
  // "Já realizei o pagamento" é alegação, não confirmação — mesma prioridade sobre a IA comercial, pelo
  // mesmo motivo: nunca deixa a IA responder algo genérico para quem já está no meio de uma cobrança.
  if (financeContext && isPaymentClaimIntent(content)) {
    await handlePaymentClaim(admin, connection, conversationResult.data, contactResult.data.client_id, waId, providerMessageId, digits(value?.metadata?.phone_number_id))
    await completeWebhookEvent(admin, ledger.id)
    return true
  }

  const conversationKind = classifyConversationKind(content.body || '', { hasExistingClient: Boolean(contactResult.data.client_id) })
  const commercial = await admin.from('commercial_settings').select('ai_mode').eq('organization_id', connection.organization_id).maybeSingle()
  if (commercial.error && !['42P01','PGRST205'].includes(commercial.error.code)) throw commercial.error
  // A classificação vai como CONTEXTO para o worker (que a recalcula com mais dados: cliente
  // existente, kind anterior, IA) — nunca é usada aqui como filtro que decide se o atendimento
  // acontece. Qualquer contato externo em modo bot recebe um evento de atendimento comercial.
  if (commercial.data?.ai_mode === 'controlled_auto') {
    const queuedCommercial = await admin.from('commercial_ai_events').insert({ organization_id: connection.organization_id, connection_id: connection.id, conversation_id: conversationResult.data.id, message_id: saved.data?.id || null, provider_message_id: providerMessageId })
    if (queuedCommercial.error && queuedCommercial.error.code !== '23505') throw queuedCommercial.error
    // Dispatch imediato é best-effort: falha aqui não perde o evento (ele já está pending, durável) —
    // o cron a cada minuto cobre a indisponibilidade transitória, igual ao padrão do task-command-worker.
    await dispatchCommercialAiWorker()
    await completeWebhookEvent(admin,ledger.id)
    return true
  }

  const dedupeKey = `whatsapp_message_received:${providerMessageId}`
  const queued = await admin.from('automation_events').insert({
    organization_id: connection.organization_id,
    event_type: 'whatsapp_message_received',
    subject_id: conversationResult.data.id,
    sanitized_payload: {
      subject_type: 'whatsapp_conversation',
      conversation_id: conversationResult.data.id,
      contact_id: contactResult.data.id,
      client_id: contactResult.data.client_id,
      connection_id: connection.id,
      wa_id: waId,
      message_type: content.type,
      text: content.body,
      commercial_classification: conversationKind,
    },
    dedupe_key: dedupeKey,
    status: 'pending',
  })
  if (queued.error && queued.error.code !== '23505') throw queued.error
    await completeWebhookEvent(admin,ledger.id)
    return true
  } catch(error) {
    await failWebhookEvent(admin,ledger.id,error)
    throw error
  }
}

const handle = async (request: Request) => {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || ''
    const valid = verifyWebhookChallenge(url.searchParams, verifyToken)
    return valid
      ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 })
      : new Response('Forbidden', { status: 403 })
  }
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)

  const appSecret = Deno.env.get('META_APP_SECRET') || ''
  if (!appSecret) return json({ ok: false, code: 'WEBHOOK_CONFIGURATION_MISSING' }, 503)
  const raw = new Uint8Array(await request.arrayBuffer())
  if (!(await verifySignature(raw, request.headers.get('X-Hub-Signature-256') || '', appSecret))) {
    return json({ ok: false, code: 'INVALID_SIGNATURE' }, 401)
  }
  const body = JSON.parse(new TextDecoder().decode(raw))
  if (body?.object !== 'whatsapp_business_account') return json({ ok: true, ignored: true })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ ok: false, code: 'SUPABASE_CONFIGURATION_MISSING' }, 503)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  let processed = 0
  let unknownConnections = 0

  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {}
      const phoneNumberId = digits(value?.metadata?.phone_number_id)
      if (!phoneNumberId) continue
      const connectionResult = await admin.from('whatsapp_connections')
        .select('id,organization_id,workspace_id,status')
        .eq('phone_number_id', phoneNumberId)
        .in('status', ['active', 'degraded'])
        .maybeSingle()
      if (connectionResult.error) throw connectionResult.error
      if (!connectionResult.data) { unknownConnections += 1; continue }
      const payloadHash = await hashPayload(value)
      for (const status of value?.statuses || []) {
        if (await processStatus(admin, connectionResult.data, status, payloadHash)) processed += 1
      }
      for (const message of value?.messages || []) {
        if (await processInbound(admin, connectionResult.data, value, message, payloadHash)) processed += 1
      }
    }
  }
  console.log(JSON.stringify({ event: 'meta_webhook_processed', processed, unknown_connections: unknownConnections }))
  return json({ ok: true, processed, unknown_connections: unknownConnections })
}

Deno.serve((request) => handle(request).catch((error) => {
  console.error(JSON.stringify({ event: 'meta_webhook_error', code: text(error?.code || error?.name, 80) || 'INTERNAL_ERROR' }))
  return json({ ok: false, code: 'WEBHOOK_PROCESSING_FAILED' }, 500)
}))
