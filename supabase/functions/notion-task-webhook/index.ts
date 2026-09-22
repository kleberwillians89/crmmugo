import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getNotionPage } from '../_shared/taskIntegrations/notion.ts'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((item) => item.toString(16).padStart(2, '0')).join('')
const verify = async (raw: Uint8Array, signature: string, secret: string) => { if (!signature || !secret) return false; const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const expected = `sha256=${hex(await crypto.subtle.sign('HMAC', key, raw))}`; if(expected.length!==signature.length)return false;let difference=0;for(let index=0;index<expected.length;index+=1)difference|=expected.charCodeAt(index)^signature.charCodeAt(index);return difference===0 }
const plain = (property: any) => (property?.title || property?.rich_text || []).map((item: any) => item?.plain_text || item?.text?.content || '').join('')
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false }, 405)
  const raw = new Uint8Array(await request.arrayBuffer()); const body = JSON.parse(new TextDecoder().decode(raw))
  if (body?.verification_token) return json({ verification_token: body.verification_token })
  if (!await verify(raw, request.headers.get('X-Notion-Signature') || '', Deno.env.get('NOTION_WEBHOOK_VERIFICATION_TOKEN') || '')) return json({ ok: false, code: 'INVALID_SIGNATURE' }, 401)
  const pageId = String(body?.entity?.id || body?.data?.id || ''); const eventId = String(body?.id || '')
  if (!pageId || !eventId) return json({ ok: true, ignored: true })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const link = await admin.from('task_external_links').select('organization_id,task_id').eq('provider', 'notion').eq('external_id', pageId).maybeSingle()
  if (link.error || !link.data) return json({ ok: true, ignored: true })
  const digest = hex(await crypto.subtle.digest('SHA-256', raw)); const ledger = await admin.from('task_external_events').insert({ organization_id: link.data.organization_id, provider: 'notion', external_event_id: eventId, external_id: pageId, payload_hash: digest })
  if (ledger.error?.code === '23505') return json({ ok: true, duplicate: true })
  if (ledger.error) return json({ ok: false, code: 'LEDGER_FAILED' }, 500)
  try {
    const [page, setting] = await Promise.all([getNotionPage(pageId), admin.from('task_integration_settings').select('configuration').eq('organization_id', link.data.organization_id).eq('provider', 'notion').maybeSingle()])
    const names = { title: 'Tarefa', status: 'Status', priority: 'Prioridade', due: 'Prazo', ...(setting.data?.configuration?.properties || {}) }; const props = page.properties || {}
    const patch: any = { source: 'notion', source_ref: eventId, metadata: { origin: 'notion', external_event_id: eventId } }
    if (props[names.title]) patch.title = plain(props[names.title])
    if (props[names.status]?.select?.name) patch.status = props[names.status].select.name
    if (props[names.priority]?.select?.name) patch.priority = props[names.priority].select.name
    if (props[names.due]) patch.due_date = props[names.due]?.date?.start ? String(props[names.due].date.start).slice(0, 10) : null
    const changed = await admin.from('crm_tasks').update(patch).eq('id', link.data.task_id).eq('organization_id', link.data.organization_id)
    if (changed.error) throw changed.error
    return json({ ok: true })
  } catch (error: any) { await admin.from('task_external_events').update({ status: 'failed', error_message: String(error?.message || '').slice(0, 500) }).eq('organization_id', link.data.organization_id).eq('provider', 'notion').eq('external_event_id', eventId); return json({ ok: false, code: 'TASK_UPDATE_FAILED' }, 500) }
})
