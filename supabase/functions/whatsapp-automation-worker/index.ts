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
//   MUGOZAP_API_URL, PANEL_API_KEY   — para ações de envio de WhatsApp

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  deadLetterDecision,
  deriveIdempotencyKey,
  evaluateConditions,
  executeRun,
  planRun,
  selectFlows,
} from '../../../src/services/whatsapp/automationExecutor.js'
import { compileFlowDefinition } from '../../../src/services/whatsapp/automationFlow.js'

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
  const clientId = text(payload.client_id || (payload.subject_type === 'client' ? event.subject_id : ''), 80)
  const installmentId = text(payload.installment_id || (payload.subject_type === 'installment' ? event.subject_id : ''), 80)

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
      if (!context.client_id && data.client_id) context.client_id = data.client_id
    }
  }
  return context
}

const buildHandlers = (admin: any, organizationId: string, mugoZap: MugoZap | null, event: any) => ({
  send_template: async (action: any, ctx: any) => {
    if (!mugoZap) throw Object.assign(new Error('MugoZap não configurado.'), { code: 'MUGOZAP_CONFIGURATION_MISSING', retryable: false })
    const recipient = brazilianPhone(ctx.context?.recipient || ctx.recipient)
    if (!recipient) throw Object.assign(new Error('Destinatário sem telefone válido.'), { code: 'RECIPIENT_MISSING', retryable: false })
    const result = await callMugoZap(mugoZap, '/api/conversations/start-template', 'POST', {
      wa_id: recipient,
      template_name: action.template_name,
      language: action.language || 'pt_BR',
      parameters: action.body_parameters || [],
      source: 'automation',
    })
    const providerMessageId = text(result?.provider_message_id || result?.messages?.[0]?.id, 200)
    if (!providerMessageId) throw Object.assign(new Error('Envio não confirmado pelo provedor.'), { code: 'MESSAGE_SEND_UNCONFIRMED', retryable: false })
    return { provider_message_id: providerMessageId, template_name: action.template_name }
  },
  send_message: async (action: any, ctx: any) => {
    if (!mugoZap) throw Object.assign(new Error('MugoZap não configurado.'), { code: 'MUGOZAP_CONFIGURATION_MISSING', retryable: false })
    const recipient = brazilianPhone(ctx.context?.recipient || ctx.recipient)
    if (!recipient) throw Object.assign(new Error('Destinatário sem telefone válido.'), { code: 'RECIPIENT_MISSING', retryable: false })
    const idempotencyKey = `${ctx.step?.key || 'msg'}-${deriveIdempotencyKey({ id: ctx.flow_id }, event)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
    const result = await callMugoZap(mugoZap, `/api/conversations/${encodeURIComponent(recipient)}/send`, 'POST', {
      text: action.text,
      idempotency_key: idempotencyKey,
    })
    return { provider_message_id: text(result?.provider_message_id || result?.messages?.[0]?.id, 200) }
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
    if (!mugoZap) return { skipped: 'mugozap_not_configured' }
    const recipient = brazilianPhone(ctx.context?.recipient || ctx.recipient)
    if (!recipient) return { skipped: 'no_conversation' }
    await callMugoZap(mugoZap, `/api/conversations/${encodeURIComponent(recipient)}`, 'PATCH', {
      attendance_mode: 'human',
      automation_paused: true,
      bot_enabled: false,
    })
    return { handoff: true }
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
      definition: version?.definition ? compileFlowDefinition(version.definition) : { trigger: {}, conditions: [], actions: [] },
      versionId: row.active_version_id,
    }
  })
}

const persistSteps = async (admin: any, organizationId: string, runId: string, steps: any[]) => {
  if (!steps.length) return
  await admin.from('automation_run_steps').insert(
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
}

const runFlowForEvent = async (admin: any, mugoZap: MugoZap | null, flow: any, event: any, context: any) => {
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

  if (insert.error) {
    if (insert.error.code === '23505') return { status: 'duplicate', flowId: flow.id }
    throw insert.error
  }
  const runId = insert.data.id

  if (flow.definition.conditions?.length && !evaluateConditions(flow.definition.conditions, context)) {
    await admin.from('automation_runs').update({ status: 'skipped', finished_at: new Date().toISOString() }).eq('id', runId)
    return { status: 'skipped', flowId: flow.id, runId }
  }

  const plan = planRun(flow, event)
  const handlers = buildHandlers(admin, flow.organization_id, mugoZap, event)
  const outcome = executeRun({
    plan,
    handlers,
    context: { context, flow_id: flow.id },
  })

  await persistSteps(admin, flow.organization_id, runId, outcome.steps)
  await admin
    .from('automation_runs')
    .update({
      status: outcome.status === 'waiting' ? 'waiting' : outcome.status === 'succeeded' ? 'succeeded' : 'failed',
      finished_at: outcome.finishedAt || (outcome.status === 'waiting' ? null : new Date().toISOString()),
      error_code: outcome.errorCode || null,
      error_message: outcome.errorMessage || null,
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
        resume_from_index: outcome.wait.resumeFromIndex,
        original_event_id: event.id,
      },
      dedupe_key: `resume:${runId}:${outcome.wait.resumeFromIndex}`,
      status: 'pending',
      next_attempt_at: outcome.wait.resumeAt,
    })
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
          .select('id,flow_id,version_id,organization_id,status')
          .eq('id', payload.run_id)
          .maybeSingle()
        if (run && run.status === 'waiting') {
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
            definition: version?.definition ? compileFlowDefinition(version.definition) : { conditions: [], actions: [] },
          }
          const plan = planRun(flow, event, { resumeFromIndex: Number(payload.resume_from_index) || 0 })
          const handlers = buildHandlers(admin, run.organization_id, mugoZap, event)
          const outcome = executeRun({
            plan, handlers, context: { context, flow_id: run.flow_id },
          })
          await persistSteps(admin, run.organization_id, run.id, outcome.steps)
          await admin.from('automation_runs').update({
            status: outcome.status === 'waiting' ? 'waiting' : outcome.status === 'succeeded' ? 'succeeded' : 'failed',
            finished_at: outcome.status === 'waiting' ? null : new Date().toISOString(),
            error_code: outcome.errorCode || null,
            error_message: outcome.errorMessage || null,
          }).eq('id', run.id)
          if (outcome.status === 'waiting' && outcome.wait) {
            await admin.from('automation_events').insert({
              organization_id: run.organization_id, event_type: 'automation_resume', subject_id: run.id,
              sanitized_payload: { run_id: run.id, flow_id: run.flow_id, resume_from_index: outcome.wait.resumeFromIndex, original_event_id: event.id },
              dedupe_key: `resume:${run.id}:${outcome.wait.resumeFromIndex}`, status: 'pending', next_attempt_at: outcome.wait.resumeAt,
            })
          }
          summary.runs += 1
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
        const result = await runFlowForEvent(admin, mugoZap, flow, event, context)
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
