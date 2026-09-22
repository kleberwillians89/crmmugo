import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const base64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((item) => item.toString(16).padStart(2, '0')).join('')
const verify = async (raw: Uint8Array, signature: string, secret: string, callbackUrl: string) => {
  if (!signature || !secret) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const combined = new Uint8Array(raw.length + new TextEncoder().encode(callbackUrl).length); combined.set(raw); combined.set(new TextEncoder().encode(callbackUrl), raw.length)
  const expected=base64(await crypto.subtle.sign('HMAC', key, combined));if(expected.length!==signature.length)return false;let difference=0;for(let index=0;index<expected.length;index+=1)difference|=expected.charCodeAt(index)^signature.charCodeAt(index);return difference===0
}
Deno.serve(async (request) => {
  if (['HEAD','GET'].includes(request.method)) return new Response('', { status: 200 })
  if (request.method !== 'POST') return json({ ok: false }, 405)
  const raw = new Uint8Array(await request.arrayBuffer()); const callbackUrl = Deno.env.get('TRELLO_WEBHOOK_CALLBACK_URL') || request.url
  if (!await verify(raw, request.headers.get('X-Trello-Webhook') || '', Deno.env.get('TRELLO_API_SECRET') || '', callbackUrl)) return json({ ok: false, code: 'INVALID_SIGNATURE' }, 401)
  if ((request.headers.get('X-Trello-Client-Identifier') || '').startsWith('mugo-crm:')) return json({ ok: true, ignored: 'self_originated' })
  const body = JSON.parse(new TextDecoder().decode(raw)); const cardId = String(body?.action?.data?.card?.id || ''); const eventId = String(body?.action?.id || '')
  if (!cardId || !eventId) return json({ ok: true, ignored: true })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const link = await admin.from('task_external_links').select('organization_id,task_id').eq('provider', 'trello').eq('external_id', cardId).maybeSingle()
  if (link.error || !link.data) return json({ ok: true, ignored: true })
  const digest = hex(await crypto.subtle.digest('SHA-256', raw)); const ledger = await admin.from('task_external_events').insert({ organization_id: link.data.organization_id, provider: 'trello', external_event_id: eventId, external_id: cardId, payload_hash: digest })
  if (ledger.error?.code === '23505') return json({ ok: true, duplicate: true })
  if (ledger.error) return json({ ok: false, code: 'LEDGER_FAILED' }, 500)
  const setting = await admin.from('task_integration_settings').select('configuration').eq('organization_id', link.data.organization_id).eq('provider', 'trello').maybeSingle()
  const data = body?.action?.data || {}; const patch: any = { source: 'trello', source_ref: eventId, metadata: { origin: 'trello', external_event_id: eventId } }
  if (data?.old?.name !== undefined && data?.card?.name) patch.title = data.card.name
  if (data?.old?.due !== undefined) patch.due_date = data.card.due ? String(data.card.due).slice(0, 10) : null
  const listId = data?.listAfter?.id
  if (listId) { const c = setting.data?.configuration || {}; patch.status = listId === c.completed_list_id ? 'completed' : listId === c.in_progress_list_id ? 'in_progress' : listId === c.todo_list_id ? 'pending' : undefined; if (!patch.status) delete patch.status }
  const changed = await admin.from('crm_tasks').update(patch).eq('id', link.data.task_id).eq('organization_id', link.data.organization_id)
  if (changed.error) { await admin.from('task_external_events').update({ status: 'failed', error_message: changed.error.message }).eq('organization_id', link.data.organization_id).eq('provider', 'trello').eq('external_event_id', eventId); return json({ ok: false, code: 'TASK_UPDATE_FAILED' }, 500) }
  return json({ ok: true })
})
