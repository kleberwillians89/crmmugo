// Eventos do Mugô Dados que viram trabalho para o time no CRM (POST, chave X-Dados-Ops-Key).
//
// content_feedback: cliente aprovou, pediu ajuste ou editou um post no Dados -> cria UMA tarefa
// (idempotente por event_id) para o responsável pelo cliente e avisa no WhatsApp do time
// (team_notification_outbox, o mesmo aviso de "tarefa criada para você").
//
// Organização e cliente vêm sempre de external_integrations (provider mugo_dados), nunca do chamador.
// Logs só com ids, ação e status.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contentTask } from '../_shared/dadosBridgeCore.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const expectedKey = Deno.env.get('DADOS_OPS_API_KEY') || ''
  if (!expectedKey || request.headers.get('X-Dados-Ops-Key') !== expectedKey) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceKey) return json({ ok: false, code: 'CONFIGURATION_MISSING' }, 503)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const body = await request.json().catch(() => null)
  const event = body?.event || {}
  if (body?.type !== 'content_feedback') return json({ ok: false, code: 'UNKNOWN_EVENT' }, 400)
  const eventId = text(event.event_id, 40)
  if (!isUuid(eventId)) return json({ ok: false, code: 'EVENT_ID_REQUIRED' }, 400)

  const externalClientId = text(body?.external_client_id, 200)
  const integration = await admin.from('external_integrations').select('organization_id,client_id')
    .eq('provider', 'mugo_dados').eq('external_client_id', externalClientId).eq('status', 'active').maybeSingle()
  if (integration.error) return json({ ok: false, code: 'LOOKUP_FAILED' }, 500)
  if (!integration.data) return json({ ok: false, code: 'UNKNOWN_EXTERNAL_CLIENT' }, 403)
  const org = integration.data.organization_id, clientId = integration.data.client_id

  try {
    const client = await admin.from('clients').select('company_name,trade_name,primary_responsible_id')
      .eq('organization_id', org).eq('id', clientId).single()
    if (client.error) throw client.error
    const task = contentTask(event, client.data.trade_name || client.data.company_name)
    if (!task) return json({ ok: false, code: 'UNKNOWN_ACTION' }, 400)
    let ownerId = client.data.primary_responsible_id
    if (!ownerId) {
      const settings = await admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id', org).maybeSingle()
      if (settings.error && !['42P01', 'PGRST205'].includes(settings.error.code)) throw settings.error
      ownerId = settings.data?.commercial_owner_id || null
    }
    const saved = await admin.from('crm_tasks').upsert({
      organization_id: org, client_id: clientId, title: task.title, status: 'pending', priority: task.priority,
      due_date: task.due_date || today(), assigned_to: ownerId, task_type: 'delivery', source: 'automation',
      source_ref: `dados-content:${eventId}`, notes: task.notes, tags: task.tags,
    }, { onConflict: 'organization_id,source_ref' }).select('id,title,due_date').single()
    if (saved.error) throw saved.error
    let notified = false
    if (ownerId) {
      const outbox = await admin.from('team_notification_outbox').insert({
        organization_id: org, team_member_id: ownerId, notification_type: 'operational_alert',
        idempotency_key: `task-assigned:${saved.data.id}`,
        payload: { kind: 'task_assigned', task_id: saved.data.id, title: saved.data.title, due_date: saved.data.due_date, requester_name: 'Mugoverso',
          candidate_items: [{ index: 1, type: 'task', task_id: saved.data.id, label: saved.data.title }] },
      })
      if (outbox.error && outbox.error.code !== '23505') throw outbox.error
      notified = true
    }
    console.log(JSON.stringify({ event: 'dados_content_feedback', organization_id: org, client_id: clientId, task_id: saved.data.id, action: text(event.action, 30), notified }))
    return json({ ok: true, data: { task_id: saved.data.id, notified } })
  } catch (error) {
    console.log(JSON.stringify({ event: 'dados_content_feedback_failed', organization_id: org, client_id: clientId, error_code: String((error as any)?.code || 'unknown').slice(0, 60) }))
    return json({ ok: false, code: 'WRITE_FAILED' }, 500)
  }
})
