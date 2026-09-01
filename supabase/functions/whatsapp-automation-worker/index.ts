// Worker do executor de automações do WhatsApp.
//
// BLOQUEIO EXTERNO: esta função precisa de deploy (`supabase functions deploy
// whatsapp-automation-worker`) e de um agendador chamando-a periodicamente
// (pg_cron + pg_net, scheduled function, ou cron externo com o header
// `X-Automation-Worker-Key`). A lógica de decisão vive em
// `src/services/whatsapp/automationExecutor.js` e é coberta por testes.
//
// Segredos necessários (secrets da edge function, nunca VITE_*):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   AUTOMATION_WORKER_KEY            — chave compartilhada com o agendador
//   META_ACCESS_TOKEN, PHONE_NUMBER_ID, WABA_ID, GRAPH_API_VERSION — envio com wamid
//   MUGOZAP_API_URL, PANEL_API_KEY   — espelho opcional de handoff

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  deadLetterDecision,
  deriveIdempotencyKey,
  evaluateConditions,
  executeGraphRun,
  executeRun,
  planRun,
  selectFlows,
} from '../../../src/services/whatsapp/automationExecutor.js'
import { compileFlowDefinition } from '../../../src/services/whatsapp/automationFlow.js'
import { isGraphDefinition, normalizeGraph } from '../../../src/services/whatsapp/automationGraph.js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-automation-worker-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders })
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)
const WORKER_ID = `edge-${crypto.randomUUID().slice(0, 8)}`
const MAX_ATTEMPTS = 6

const brazilianPhone = (value: unknown) => {
  let normalized = text(value, 40).replace(/\D/g, '')
  if (normalized.startsWith('00')) normalized = normalized.slice(2)
  if (!normalized.startsWith('55') && (normalized.length === 10 || normalized.length === 11)) normalized = `55${normalized}`
  return /^55[1-9]{2}\d{8,9}$/.test(normalized) ? normalized : ''
}

type MugoZap = { url: string; key: string }
type MetaTransport = { version: string; phoneNumberId: string; wabaId: string; accessToken: string }

const callMeta = async (config: MetaTransport, payload: unknown) => {
  let response: Response
  try {
    response = await fetch(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error: any) {
    const failure: any = new Error(error?.name === 'TimeoutError' ? 'A Meta demorou para responder.' : 'A Meta está indisponível.')
    failure.code = error?.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE'
    failure.retryable = true
    throw failure
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const failure: any = new Error(text(body?.error?.error_data?.details || body?.error?.message, 500) || `Meta respondeu ${response.status}.`)
    failure.code = response.status >= 500 || response.status === 429 ? 'META_TEMPORARY_ERROR' : `META_${body?.error?.code || response.status}`
    failure.retryable = response.status >= 500 || response.status === 429
    throw failure
  }
  const providerMessageId = text(body?.messages?.[0]?.id, 200)
  if (!providerMessageId) throw Object.assign(new Error('A Meta não confirmou o envio.'), { code: 'MESSAGE_SEND_UNCONFIRMED', retryable: false })
  return { providerMessageId }
}

const callMugoZap = async (config: MugoZap, path: string, method: string, body?: unknown) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${config.url}${path}`, {
      method,
      signal: controller.signal,
      headers: { 'X-Panel-Key': config.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error: any = new Error(text(payload?.detail || payload?.message, 400) || `MugoZap respondeu ${response.status}.`)
      error.code = response.status >= 500 ? 'MUGOZAP_TEMPORARY_ERROR' : `MUGOZAP_${response.status}`
      error.retryable = response.status >= 500
      error.provider_message = text(payload?.detail || payload?.error?.message, 400)
      throw error
    }
    return payload || {}
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      const timedOut: any = new Error('MugoZap demorou para responder.')
      timedOut.code = 'UPSTREAM_TIMEOUT'
      timedOut.retryable = true
      throw timedOut
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

// Constrói o contexto de execução (cliente, parcela) a partir do evento.
const buildContext = async (admin: any, organizationId: string, event: any) => {
  const payload = event.sanitized_payload || {}
  const context: Record<string, any> = {
    event: { event_name: payload.event_name || null, subject_type: payload.subject_type || null, ...payload },
  }
  let clientId = text(payload.client_id || (payload.subject_type === 'client' ? event.subject_id : ''), 80)
  const installmentId = text(payload.installment_id || (payload.subject_type === 'installment' ? event.subject_id : ''), 80)
  const conversationId = text(payload.conversation_id || (payload.subject_type === 'whatsapp_conversation' ? event.subject_id : ''), 80)

  if (conversationId) {
    const { data } = await admin.from('whatsapp_conversations')
      .select('id,connection_id,contact_id,wa_id,status,attendance_mode,automation_paused,service_window_expires_at')
      .eq('id', conversationId).eq('organization_id', organizationId).maybeSingle()
    if (data) {
      context.conversation = data
      context.conversation_id = data.id
      context.connection_id = data.connection_id
      context.recipient = brazilianPhone(data.wa_id)
      const connection = await admin.from('whatsapp_connections').select('phone_number_id')
        .eq('id', data.connection_id).eq('organization_id', organizationId).maybeSingle()
      if (connection.error || !connection.data?.phone_number_id) throw connection.error || Object.assign(new Error('Conexão canônica sem Phone Number ID.'), { code: 'CONNECTION_CONFIGURATION_MISSING' })
      context.phone_number_id = text(connection.data?.phone_number_id, 80)
    }
  }

  if (installmentId) {
    const { data } = await admin
      .from('invoice_installments')
      .select('id,client_id,contract_id,amount,received_amount,due_date,status')
      .eq('id', installmentId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (data) {
      const dueMs = data.due_date ? Date.parse(data.due_date) : NaN
      context.installment = {
        ...data,
        days_overdue: Number.isFinite(dueMs) ? Math.max(0, Math.floor((Date.now() - dueMs) / 86_400_000)) : 0,
      }
      if (!clientId && data.client_id) clientId = data.client_id
    }
  }
  if (clientId) {
    const { data } = await admin
      .from('clients')
      .select('id,company_name,trade_name,contact_name,phone,billing_contact_phone,status,segment,lead_source')
      .eq('id', clientId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (data) {
      context.client = data
      context.recipient = brazilianPhone(data.billing_contact_phone || data.phone)
      context.client_id = data.id
    }
  }
  return context
}

const persistAutomationOutbound = async (admin: any, organizationId: string, recipient: string, ctx: any, message: any, phoneNumberId = '') => {
  let connectionId = ctx.context?.connection_id
  if (!connectionId) {
    let connectionQuery = admin.from('whatsapp_connections').select('id')
      .eq('organization_id', organizationId).in('status', ['active', 'degraded'])
    if (phoneNumberId) connectionQuery = connectionQuery.eq('phone_number_id', phoneNumberId)
    const connections = await connectionQuery.order('updated_at', { ascending: false }).limit(2)
    if (connections.error) throw connections.error
    if ((connections.data || []).length !== 1) {
      throw Object.assign(new Error('A automação exige uma única conexão WhatsApp ativa.'), { code: 'CONNECTION_SELECTION_REQUIRED', retryable: false })
    }
    connectionId = connections.data[0].id
  }
  const contact = await admin.from('whatsapp_contacts').upsert({
    organization_id: organizationId, connection_id: connectionId, wa_id: recipient,
    ...(ctx.context?.client_id ? { client_id: ctx.context.client_id } : {}), last_seen_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,wa_id' }).select('id').single()
  if (contact.error) throw contact.error
  const now = new Date().toISOString()
  const conversation = await admin.from('whatsapp_conversations').upsert({
    organization_id: organizationId, connection_id: connectionId, contact_id: contact.data.id,
    wa_id: recipient, status: 'open', last_message_at: now, last_outbound_at: now,
  }, { onConflict: 'connection_id,wa_id' }).select('id').single()
  if (conversation.error) throw conversation.error
  const saved = await admin.from('whatsapp_messages').upsert({
    organization_id: organizationId, connection_id: connectionId, conversation_id: conversation.data.id,
    provider_message_id: message.providerMessageId, idempotency_key: message.idempotencyKey,
    direction: 'out', message_type: message.type, status: message.status || 'accepted', text_content: message.text || null,
    template_name: message.templateName || null, template_language: message.templateLanguage || null,
    sent_at: message.status === 'queued' ? null : now,
  }, { onConflict: 'connection_id,idempotency_key' })
  if (saved.error) throw saved.error
  return { connection_id: connectionId, conversation_id: conversation.data.id }
}

const findAutomationOutbound = async (admin: any, organizationId: string, idempotencyKey: string) => {
  const existing = await admin.from('whatsapp_messages')
    .select('provider_message_id,conversation_id,connection_id,status')
    .eq('organization_id', organizationId).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing.error) throw existing.error
  return existing.data || null
}

const buildHandlers = (admin: any, organizationId: string, mugoZap: MugoZap | null, meta: MetaTransport | null, event: any) => ({
  send_template: async (action: any, ctx: any) => {
    if (!meta) throw Object.assign(new Error('Transporte Meta não configurado.'), { code: 'META_CONFIGURATION_MISSING', retryable: false })
    const recipient = brazilianPhone(ctx.context?.recipient || ctx.recipient)
    if (!recipient) throw Object.assign(new Error('Destinatário sem telefone válido.'), { code: 'RECIPIENT_MISSING', retryable: false })
    if (ctx.context?.phone_number_id && ctx.context.phone_number_id !== meta.phoneNumberId) throw Object.assign(new Error('A credencial Meta não pertence à conexão da conversa.'), { code: 'CONNECTION_CREDENTIAL_MISMATCH', retryable: false })
    const idempotencyKey = `${ctx.step?.key || 'template'}-${deriveIdempotencyKey({ id: ctx.flow_id }, event)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
    const approved = await admin.from('whatsapp_message_templates').select('id').eq('organization_id', organizationId)
      .eq('waba_id', meta.wabaId).eq('name', action.template_name).eq('language', action.language || 'pt_BR').eq('status', 'APPROVED').eq('is_active', true).maybeSingle()
    if (approved.error || !approved.data) throw Object.assign(new Error('Template não aprovado para esta organização.'), { code: 'TEMPLATE_NOT_APPROVED', retryable: false })
    const previous = await findAutomationOutbound(admin, organizationId, idempotencyKey)
    if (previous?.provider_message_id) return { provider_message_id: previous.provider_message_id, template_name: action.template_name, conversation_id: previous.conversation_id, connection_id: previous.connection_id, already_sent: true }
    if (previous) throw Object.assign(new Error('Existe uma tentativa reservada sem confirmação. O envio não será repetido automaticamente.'), { code: 'SEND_OUTCOME_UNKNOWN', retryable: false })
    const reservation = await persistAutomationOutbound(admin, organizationId, recipient, ctx, {
      providerMessageId: null, idempotencyKey, type: 'template', templateName: action.template_name,
      templateLanguage: action.language || 'pt_BR', status: 'queued',
    }, meta.phoneNumberId)
    ctx.context.conversation_id = reservation.conversation_id
    ctx.context.connection_id = reservation.connection_id
    const parameters = (action.body_parameters || []).map((value: unknown) => ({ type: 'text', text: text(value, 1024) }))
    const result = await callMeta(meta, {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'template',
      template: { name: action.template_name, language: { code: action.language || 'pt_BR' }, components: parameters.length ? [{ type: 'body', parameters }] : [] },
    })
    const providerMessageId = result.providerMessageId
    const canonical = await persistAutomationOutbound(admin, organizationId, recipient, ctx, {
      providerMessageId, idempotencyKey, type: 'template', templateName: action.template_name,
      templateLanguage: action.language || 'pt_BR',
    }, meta.phoneNumberId)
    return { provider_message_id: providerMessageId, template_name: action.template_name, ...canonical }
  },
  send_message: async (action: any, ctx: any) => {
    if (!meta) throw Object.assign(new Error('Transporte Meta não configurado.'), { code: 'META_CONFIGURATION_MISSING', retryable: false })
    const recipient = brazilianPhone(ctx.context?.recipient || ctx.recipient)
    if (!recipient) throw Object.assign(new Error('Destinatário sem telefone válido.'), { code: 'RECIPIENT_MISSING', retryable: false })
    if (ctx.context?.phone_number_id && ctx.context.phone_number_id !== meta.phoneNumberId) throw Object.assign(new Error('A credencial Meta não pertence à conexão da conversa.'), { code: 'CONNECTION_CREDENTIAL_MISMATCH', retryable: false })
    const serviceWindow = Date.parse(ctx.context?.conversation?.service_window_expires_at || '')
    if (!Number.isFinite(serviceWindow) || serviceWindow <= Date.now()) {
      throw Object.assign(new Error('Mensagem livre fora da janela de atendimento de 24 horas.'), { code: 'SERVICE_WINDOW_CLOSED', retryable: false })
    }
    const idempotencyKey = `${ctx.step?.key || 'msg'}-${deriveIdempotencyKey({ id: ctx.flow_id }, event)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
    const previous = await findAutomationOutbound(admin, organizationId, idempotencyKey)
    if (previous?.provider_message_id) return { provider_message_id: previous.provider_message_id, conversation_id: previous.conversation_id, connection_id: previous.connection_id, already_sent: true }
    if (previous) throw Object.assign(new Error('Existe uma tentativa reservada sem confirmação. O envio não será repetido automaticamente.'), { code: 'SEND_OUTCOME_UNKNOWN', retryable: false })
    const reservation = await persistAutomationOutbound(admin, organizationId, recipient, ctx, {
      providerMessageId: null, idempotencyKey, type: 'text', text: action.text, status: 'queued',
    }, meta.phoneNumberId)
    ctx.context.conversation_id = reservation.conversation_id
    ctx.context.connection_id = reservation.connection_id
    const result = await callMeta(meta, { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'text', text: { preview_url: false, body: action.text } })
    const providerMessageId = result.providerMessageId
    const canonical = await persistAutomationOutbound(admin, organizationId, recipient, ctx, {
      providerMessageId, idempotencyKey, type: 'text', text: action.text,
    }, meta.phoneNumberId)
    return { provider_message_id: providerMessageId, ...canonical }
  },
  add_note: async (action: any, ctx: any) => {
    const { error } = await admin.from('commercial_events').insert({
      organization_id: organizationId,
      client_id: ctx.context?.client_id || null,
      event_type: 'automation_note',
      title: text(action.title, 240) || 'Automação',
      description: text(action.text, 4000) || null,
      new_value: { source: 'automation', event_id: event.id },
    })
    if (error) throw Object.assign(new Error(error.message), { code: 'AUDIT_WRITE_FAILED', retryable: true })
    return { recorded: true }
  },
  create_task: async (action: any, ctx: any) => {
    const dueDate = action.due_in_days != null
      ? new Date(Date.now() + Number(action.due_in_days) * 86_400_000).toISOString().slice(0, 10)
      : null
    const { data, error } = await admin.from('crm_tasks').insert({
      organization_id: organizationId,
      title: text(action.title, 240),
      priority: action.priority || 'medium',
      due_date: dueDate,
      client_id: ctx.context?.client_id || null,
      notes: 'Criada por automação do WhatsApp.',
    }).select('id').single()
    if (error) throw Object.assign(new Error(error.message), { code: 'TASK_WRITE_FAILED', retryable: true })
    return { task_id: data?.id }
  },
  handoff_to_human: async (_action: any, ctx: any) => {
    const recipient = brazilianPhone(ctx.context?.recipient || ctx.recipient)
    const conversationId = ctx.context?.conversation_id
    if (!conversationId || !ctx.context?.connection_id) throw Object.assign(new Error('Handoff exige uma conversa canônica.'), { code: 'CANONICAL_CONVERSATION_REQUIRED', retryable: false })
    const changed = await admin.from('whatsapp_conversations').update({
      attendance_mode: 'human', automation_paused: true,
      handoff_reason: text(_action.note, 500) || 'automation_handoff',
    }).eq('id', conversationId).eq('organization_id', organizationId)
    if (changed.error) throw Object.assign(new Error(changed.error.message), { code: 'HANDOFF_WRITE_FAILED', retryable: true })
    const recorded = await admin.from('whatsapp_conversation_events').insert({
      organization_id: organizationId, connection_id: ctx.context.connection_id,
      conversation_id: conversationId, event_type: 'human_handoff',
      details: { source: 'automation', note: text(_action.note, 500) || null, event_id: event.id },
    })
    if (recorded.error) throw Object.assign(new Error(recorded.error.message), { code: 'HANDOFF_AUDIT_FAILED', retryable: true })
    if (!mugoZap || !recipient) return { handoff: true, upstream_skipped: true }
    await callMugoZap(mugoZap, `/api/conversations/${encodeURIComponent(recipient)}`, 'PATCH', {
      attendance_mode: 'human', automation_paused: true, bot_enabled: false,
    })
    return { handoff: true, upstream_updated: true }
  },
})

const loadActiveFlows = async (admin: any, organizationId: string, eventType: string) => {
  const { data: flows, error } = await admin
    .from('automation_flows')
    .select('id,organization_id,name,trigger_type,trigger_config,status,active_version_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .eq('trigger_type', eventType)
  if (error) throw error
  if (!flows?.length) return []
  const { data: versions } = await admin
    .from('automation_versions')
    .select('id,version,definition')
    .in('id', flows.map((row: any) => row.active_version_id).filter(Boolean))
  const byId = new Map((versions || []).map((row: any) => [row.id, row]))
  return flows.map((row: any) => {
    const version = byId.get(row.active_version_id)
    return {
      id: row.id,
      organization_id: row.organization_id,
      name: row.name,
      status: row.status,
      triggerType: row.trigger_type,
      triggerConfig: row.trigger_config || {},
      activeVersionId: row.active_version_id,
      definition: version?.definition ? (isGraphDefinition(version.definition) ? normalizeGraph(version.definition) : compileFlowDefinition(version.definition)) : { trigger: {}, conditions: [], actions: [] },
      versionId: row.active_version_id,
    }
  })
}

const persistSteps = async (admin: any, organizationId: string, runId: string, steps: any[]) => {
  if (!steps.length) return
  const result = await admin.from('automation_run_steps').insert(
    steps.map((step) => ({
      organization_id: organizationId,
      run_id: runId,
      step_key: step.key,
      run_index: step.index,
      action_type: step.actionType,
      status: step.status,
      sanitized_result: step.result || {},
      error_code: step.errorCode || null,
      error_message: step.errorMessage || null,
      started_at: step.startedAt || null,
      finished_at: step.finishedAt || null,
    })),
  )
  if (result.error) throw result.error
}

const runFlowForEvent = async (admin: any, mugoZap: MugoZap | null, meta: MetaTransport | null, flow: any, event: any, context: any) => {
  const idempotencyKey = deriveIdempotencyKey(flow, event)
  const insert = await admin
    .from('automation_runs')
    .insert({
      organization_id: flow.organization_id,
      flow_id: flow.id,
      version_id: flow.versionId,
      status: 'running',
      trigger_type: flow.triggerType,
      event_id: event.id,
      idempotency_key: idempotencyKey,
      started_at: new Date().toISOString(),
      attempts: 1,
      context: { recipient_present: Boolean(context.recipient), client_id: context.client_id || null },
    })
    .select('id')
    .single()

  let runId = insert.data?.id
  let resumeFromIndex = 0
  let resumeNodeId: string | null = null
  if (insert.error) {
    if (insert.error.code !== '23505') throw insert.error
    const existing = await admin.from('automation_runs')
      .select('id,status,attempts,context').eq('flow_id', flow.id).eq('idempotency_key', idempotencyKey).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data || !['failed'].includes(existing.data.status)) return { status: 'duplicate', flowId: flow.id }
    runId = existing.data.id
    resumeFromIndex = Number(existing.data.context?.resume_from_index) || 0
    resumeNodeId = text(existing.data.context?.resume_node_id, 120) || null
    const reopened = await admin.from('automation_runs').update({
      status: 'running', finished_at: null, error_code: null, error_message: null,
      attempts: Number(existing.data.attempts || 0) + 1,
    }).eq('id', runId).eq('status', 'failed')
    if (reopened.error) throw reopened.error
  }

  if (flow.definition.conditions?.length && !evaluateConditions(flow.definition.conditions, context)) {
    await admin.from('automation_runs').update({ status: 'skipped', finished_at: new Date().toISOString() }).eq('id', runId)
    return { status: 'skipped', flowId: flow.id, runId }
  }

  const handlers = buildHandlers(admin, flow.organization_id, mugoZap, meta, event)
  const outcome = isGraphDefinition(flow.definition)
    ? await executeGraphRun({ definition: flow.definition, handlers, context: { ...context, context, flow_id: flow.id }, resumeNodeId })
    : await executeRun({ plan: planRun(flow, event, { resumeFromIndex }), handlers, context: { context, flow_id: flow.id } })

  await persistSteps(admin, flow.organization_id, runId, outcome.steps)
  await admin
    .from('automation_runs')
    .update({
      status: outcome.status === 'waiting' ? 'waiting' : outcome.status === 'succeeded' ? 'succeeded' : 'failed',
      finished_at: outcome.finishedAt || (outcome.status === 'waiting' ? null : new Date().toISOString()),
      error_code: outcome.errorCode || null,
      error_message: outcome.errorMessage || null,
      context: {
        recipient_present: Boolean(context.recipient), client_id: context.client_id || null,
        conversation_id: context.conversation_id || null,
        resume_from_index: outcome.status === 'failed' ? Number(outcome.resumeFromIndex || 0) : null,
        resume_node_id: outcome.status === 'failed' ? outcome.resumeNodeId || null : null,
      },
    })
    .eq('id', runId)

  if (outcome.status === 'waiting' && outcome.wait) {
    await admin.from('automation_events').insert({
      organization_id: flow.organization_id,
      event_type: 'automation_resume',
      subject_id: runId,
      sanitized_payload: {
        run_id: runId,
        flow_id: flow.id,
        resume_from_index: outcome.wait.resumeFromIndex || null,
        resume_node_id: outcome.wait.resumeNodeId || null,
        original_event_id: event.id,
      },
      dedupe_key: `resume:${runId}:${outcome.wait.resumeNodeId || outcome.wait.resumeFromIndex}`,
      status: 'pending',
      next_attempt_at: outcome.wait.resumeAt,
    })
    if (context.conversation_id && context.connection_id) {
      await admin.from('whatsapp_follow_ups').insert({
        organization_id: flow.organization_id, connection_id: context.connection_id,
        conversation_id: context.conversation_id, automation_run_id: runId,
        run_at: outcome.wait.resumeAt,
        action: { source: 'automation_wait', flow_id: flow.id, resume_from_index: outcome.wait.resumeFromIndex || null, resume_node_id: outcome.wait.resumeNodeId || null },
      })
      await admin.from('whatsapp_conversations').update({ follow_up_at: outcome.wait.resumeAt }).eq('id', context.conversation_id)
    }
  }

  return { status: outcome.status, flowId: flow.id, runId, retryable: outcome.retryable }
}

const handle = async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)

  const workerKey = Deno.env.get('AUTOMATION_WORKER_KEY')
  if (!workerKey || request.headers.get('X-Automation-Worker-Key') !== workerKey) {
    return json({ ok: false, code: 'UNAUTHORIZED', message: 'Chave do worker inválida.' }, 401)
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ ok: false, code: 'SUPABASE_CONFIGURATION_MISSING' }, 503)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const mugoZapUrl = text(Deno.env.get('MUGOZAP_API_URL'), 500).replace(/\/$/, '')
  const panelKey = Deno.env.get('PANEL_API_KEY') || ''
  const mugoZap: MugoZap | null = mugoZapUrl && panelKey ? { url: mugoZapUrl, key: panelKey } : null
  const metaVersion = text(Deno.env.get('GRAPH_API_VERSION'), 20)
  const metaPhoneNumberId = text(Deno.env.get('PHONE_NUMBER_ID'), 80)
  const metaWabaId = text(Deno.env.get('WABA_ID'), 80)
  const metaAccessToken = Deno.env.get('META_ACCESS_TOKEN') || ''
  const meta: MetaTransport | null = /^v\d+\.\d+$/.test(metaVersion) && /^\d+$/.test(metaPhoneNumberId) && /^\d+$/.test(metaWabaId) && metaAccessToken
    ? { version: metaVersion, phoneNumberId: metaPhoneNumberId, wabaId: metaWabaId, accessToken: metaAccessToken }
    : null

  const body = await request.json().catch(() => ({}))
  const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 50)

  const claim = await admin.rpc('claim_automation_events', {
    p_worker_id: WORKER_ID,
    p_limit: limit,
    p_max_attempts: MAX_ATTEMPTS,
  })
  if (claim.error) return json({ ok: false, code: 'CLAIM_FAILED', message: claim.error.message }, 503)

  const events = claim.data || []
  const summary = { claimed: events.length, processed: 0, skipped: 0, failed: 0, dead_letter: 0, runs: 0 }

  for (const event of events) {
    try {
      const context = await buildContext(admin, event.organization_id, event)
      let flows: any[] = []
      if (event.event_type === 'automation_resume') {
        // Retomada de um `wait`: recarrega o run e continua do índice salvo.
        const payload = event.sanitized_payload || {}
        const { data: run } = await admin
          .from('automation_runs')
          .select('id,flow_id,version_id,organization_id,status,context')
          .eq('id', payload.run_id)
          .maybeSingle()
        if (run && run.status === 'waiting') {
          if (run.context?.conversation_id) {
            const { data: conversation } = await admin.from('whatsapp_conversations')
              .select('id,connection_id,wa_id,status,attendance_mode,automation_paused,service_window_expires_at')
              .eq('id', run.context.conversation_id).eq('organization_id', run.organization_id).maybeSingle()
            if (conversation) {
              context.conversation = conversation
              context.conversation_id = conversation.id
              context.connection_id = conversation.connection_id
              context.recipient = brazilianPhone(conversation.wa_id)
              const connection = await admin.from('whatsapp_connections').select('phone_number_id')
                .eq('id', conversation.connection_id).eq('organization_id', run.organization_id).maybeSingle()
              if (connection.error || !connection.data?.phone_number_id) throw connection.error || Object.assign(new Error('Conexão canônica sem Phone Number ID.'), { code: 'CONNECTION_CONFIGURATION_MISSING' })
              context.phone_number_id = text(connection.data?.phone_number_id, 80)
            }
          }
          const { data: version } = await admin
            .from('automation_versions')
            .select('id,definition')
            .eq('id', run.version_id)
            .maybeSingle()
          const flow = {
            id: run.flow_id,
            organization_id: run.organization_id,
            versionId: run.version_id,
            triggerType: 'automation_resume',
            triggerConfig: {},
            definition: version?.definition ? (isGraphDefinition(version.definition) ? normalizeGraph(version.definition) : compileFlowDefinition(version.definition)) : { conditions: [], actions: [] },
          }
          const handlers = buildHandlers(admin, run.organization_id, mugoZap, meta, event)
          const outcome = isGraphDefinition(flow.definition)
            ? await executeGraphRun({ definition: flow.definition, handlers, context: { ...context, context, flow_id: run.flow_id }, resumeNodeId: text(payload.resume_node_id, 120) || null })
            : await executeRun({ plan: planRun(flow, event, { resumeFromIndex: Number(payload.resume_from_index) || 0 }), handlers, context: { context, flow_id: run.flow_id } })
          await persistSteps(admin, run.organization_id, run.id, outcome.steps)
          await admin.from('automation_runs').update({
            status: outcome.status === 'waiting' || (outcome.status === 'failed' && outcome.retryable) ? 'waiting' : outcome.status === 'succeeded' ? 'succeeded' : 'failed',
            finished_at: outcome.status === 'waiting' || (outcome.status === 'failed' && outcome.retryable) ? null : new Date().toISOString(),
            error_code: outcome.errorCode || null,
            error_message: outcome.errorMessage || null,
          }).eq('id', run.id)
          await admin.from('whatsapp_follow_ups').update({
            status: 'completed', completed_at: new Date().toISOString(),
          }).eq('automation_run_id', run.id).eq('status', 'scheduled').lte('run_at', new Date().toISOString())
          if (context.conversation_id) await admin.from('whatsapp_conversations').update({ follow_up_at: null }).eq('id', context.conversation_id)
          if (outcome.status === 'waiting' && outcome.wait) {
            await admin.from('automation_events').insert({
              organization_id: run.organization_id, event_type: 'automation_resume', subject_id: run.id,
              sanitized_payload: { run_id: run.id, flow_id: run.flow_id, resume_from_index: outcome.wait.resumeFromIndex || null, resume_node_id: outcome.wait.resumeNodeId || null, original_event_id: event.id },
              dedupe_key: `resume:${run.id}:${outcome.wait.resumeNodeId || outcome.wait.resumeFromIndex}`, status: 'pending', next_attempt_at: outcome.wait.resumeAt,
            })
            if (context.conversation_id && context.connection_id) {
              await admin.from('whatsapp_follow_ups').insert({
                organization_id: run.organization_id, connection_id: context.connection_id,
                conversation_id: context.conversation_id, automation_run_id: run.id,
                run_at: outcome.wait.resumeAt,
                action: { source: 'automation_wait', flow_id: run.flow_id, resume_from_index: outcome.wait.resumeFromIndex || null, resume_node_id: outcome.wait.resumeNodeId || null },
              })
              await admin.from('whatsapp_conversations').update({ follow_up_at: outcome.wait.resumeAt }).eq('id', context.conversation_id)
            }
          }
          summary.runs += 1
          if (outcome.status === 'failed' && outcome.retryable) {
            const decision = deadLetterDecision({ attempts: event.attempts, maxAttempts: MAX_ATTEMPTS, retryable: true })
            await admin.from('automation_events').update({
              status: decision.deadLetter ? 'dead_letter' : 'failed',
              next_attempt_at: decision.deadLetter ? null : new Date(Date.now() + (decision.retryAfterSeconds || 60) * 1000).toISOString(),
              last_error_code: outcome.errorCode || 'STEP_FAILED', last_error_at: new Date().toISOString(),
              sanitized_payload: {
                ...payload,
                resume_from_index: outcome.resumeFromIndex ?? payload.resume_from_index ?? null,
                resume_node_id: outcome.resumeNodeId || payload.resume_node_id || null,
              },
            }).eq('id', event.id)
            if (decision.deadLetter) {
              await admin.from('automation_runs').update({ status: 'dead_letter', finished_at: new Date().toISOString() }).eq('id', run.id)
              await admin.from('automation_dead_letters').insert({
                organization_id: run.organization_id, event_id: event.id,
                error_code: outcome.errorCode || 'STEP_FAILED', attempts: event.attempts,
              })
              summary.dead_letter += 1
            } else summary.failed += 1
            continue
          }
        }
        await admin.from('automation_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', event.id)
        summary.processed += 1
        continue
      }

      flows = await loadActiveFlows(admin, event.organization_id, event.event_type)
      const matched = selectFlows(
        { ...event, event_type: event.event_type, sanitized_payload: event.sanitized_payload },
        flows,
      )

      let anyRetryableFailure = false
      for (const flow of matched) {
        const result = await runFlowForEvent(admin, mugoZap, meta, flow, event, context)
        if (result.status !== 'duplicate') summary.runs += 1
        if (result.status === 'failed' && result.retryable) anyRetryableFailure = true
      }

      if (anyRetryableFailure) {
        const decision = deadLetterDecision({ attempts: event.attempts, maxAttempts: MAX_ATTEMPTS, retryable: true })
        if (decision.deadLetter) {
          await admin.from('automation_events').update({
            status: 'dead_letter', last_error_code: 'STEP_FAILED', last_error_at: new Date().toISOString(),
          }).eq('id', event.id)
          await admin.from('automation_dead_letters').insert({
            organization_id: event.organization_id, event_id: event.id, error_code: 'STEP_FAILED', attempts: event.attempts,
          })
          summary.dead_letter += 1
        } else {
          await admin.from('automation_events').update({
            status: 'failed',
            next_attempt_at: new Date(Date.now() + (decision.retryAfterSeconds || 60) * 1000).toISOString(),
            last_error_code: 'STEP_FAILED', last_error_at: new Date().toISOString(),
          }).eq('id', event.id)
          summary.failed += 1
        }
        continue
      }

      await admin.from('automation_events').update({
        status: 'processed', processed_at: new Date().toISOString(),
      }).eq('id', event.id)
      if (!matched.length) summary.skipped += 1
      summary.processed += 1
    } catch (error: any) {
      const decision = deadLetterDecision({ attempts: event.attempts, maxAttempts: MAX_ATTEMPTS, retryable: true })
      await admin.from('automation_events').update({
        status: decision.deadLetter ? 'dead_letter' : 'failed',
        next_attempt_at: decision.deadLetter ? null : new Date(Date.now() + (decision.retryAfterSeconds || 60) * 1000).toISOString(),
        last_error_code: text(error?.code || error?.name, 80) || 'WORKER_ERROR',
        last_error_at: new Date().toISOString(),
      }).eq('id', event.id)
      if (decision.deadLetter) {
        await admin.from('automation_dead_letters').insert({
          organization_id: event.organization_id, event_id: event.id,
          error_code: text(error?.code, 80) || 'WORKER_ERROR', attempts: event.attempts,
        })
        summary.dead_letter += 1
      } else {
        summary.failed += 1
      }
    }
  }

  console.log(JSON.stringify({ event: 'automation_worker_cycle', worker_id: WORKER_ID, ...summary }))
  return json({ ok: true, data: summary })
}

Deno.serve(handle)
