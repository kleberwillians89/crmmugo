import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  META_STATUS_RANK as statusRank,
  hashWebhookPayload as hashPayload,
  inboundEventKey,
  shouldApplyMetaStatus,
  statusEventKey,
  verifyMetaSignature as verifySignature,
  verifyWebhookChallenge,
  webhookDigits as digits,
  webhookMessageContent as messageContent,
  webhookText as text,
  webhookTimestamp as timestamp,
} from '../_shared/whatsappWebhookCore.js'

const jsonHeaders = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders })
const processStatus = async (admin: any, connection: any, status: any, payloadHash: string) => {
  const providerMessageId = text(status?.id, 240)
  const nextStatus = text(status?.status, 30).toLowerCase()
  if (!providerMessageId || !(nextStatus in statusRank)) return false
  const eventKey = statusEventKey(providerMessageId, nextStatus, status?.timestamp)
  const ledger = await admin.from('whatsapp_webhook_events').insert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    event_key: eventKey,
    event_type: `message_${nextStatus}`,
    payload_hash: payloadHash,
  })
  if (ledger.error?.code === '23505') return false
  if (ledger.error) throw ledger.error

  const current = await admin
    .from('whatsapp_messages')
    .select('id,status')
    .eq('connection_id', connection.id)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()
  if (current.error) throw current.error
  if (!current.data) return true
  if (!shouldApplyMetaStatus(current.data.status, nextStatus)) return true

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
  return true
}

const processInbound = async (admin: any, connection: any, value: any, message: any, payloadHash: string) => {
  const providerMessageId = text(message?.id, 240)
  const waId = digits(message?.from)
  if (!providerMessageId || !waId) return false
  const ledger = await admin.from('whatsapp_webhook_events').insert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    event_key: inboundEventKey(providerMessageId),
    event_type: 'message_received',
    payload_hash: payloadHash,
  })
  if (ledger.error?.code === '23505') return false
  if (ledger.error) throw ledger.error

  const profileName = text((value?.contacts || []).find((item: any) => digits(item?.wa_id) === waId)?.profile?.name, 240)
  const contactResult = await admin.from('whatsapp_contacts').upsert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    wa_id: waId,
    display_name: profileName || null,
    profile_name: profileName || null,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,wa_id' }).select('id,client_id').single()
  if (contactResult.error) throw contactResult.error

  const occurredAt = timestamp(message?.timestamp)
  const conversationResult = await admin.from('whatsapp_conversations').upsert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    contact_id: contactResult.data.id,
    wa_id: waId,
    status: 'open',
    service_window_expires_at: new Date(new Date(occurredAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    last_message_at: occurredAt,
    last_inbound_at: occurredAt,
  }, { onConflict: 'connection_id,wa_id' }).select('id,attendance_mode,automation_paused').single()
  if (conversationResult.error) throw conversationResult.error

  const content = messageContent(message)
  const saved = await admin.from('whatsapp_messages').insert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    conversation_id: conversationResult.data.id,
    provider_message_id: providerMessageId,
    direction: 'in',
    message_type: content.type,
    status: 'received',
    text_content: content.body || null,
    media: content.media,
    provider_timestamp: occurredAt,
  })
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
    },
    dedupe_key: dedupeKey,
    status: 'pending',
  })
  if (queued.error && queued.error.code !== '23505') throw queued.error
  return true
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
