// Projeta crm_tasks para Trello/Notion. Um provedor com falha não bloqueia o outro.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TASK_SYNC_WORKER_KEY,
// TRELLO_API_KEY/TRELLO_TOKEN e NOTION_TOKEN.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { upsertTrelloTask } from '../_shared/taskIntegrations/trello.ts'
import { upsertNotionTask } from '../_shared/taskIntegrations/notion.ts'
import { planTaskProjection, taskSyncState } from '../_shared/taskSyncCore.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const clean = (value: unknown, max = 1000) => String(value ?? '').trim().slice(0, max)
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map((item) => item.toString(16).padStart(2, '0')).join('')

async function processItem(admin: any, item: any) {
  const claimed = await admin.from('task_sync_outbox').update({ status: 'processing', attempts: Number(item.attempts || 0) + 1 }).eq('id', item.id).in('status', ['pending','failed']).select('id').maybeSingle()
  if (claimed.error?.code === '23505' || !claimed.data) return false
  if (claimed.error) throw claimed.error
  try {
    const [task, setting, link] = await Promise.all([
      admin.from('crm_tasks').select('*,team_members(name),clients(company_name)').eq('id', item.task_id).eq('organization_id', item.organization_id).single(),
      admin.from('task_integration_settings').select('*').eq('organization_id', item.organization_id).eq('provider', item.provider).maybeSingle(),
      admin.from('task_external_links').select('*').eq('organization_id', item.organization_id).eq('task_id', item.task_id).eq('provider', item.provider).maybeSingle(),
    ])
    if (task.error || setting.error || link.error) throw task.error || setting.error || link.error
    if (!setting.data?.enabled) throw Object.assign(new Error(`${item.provider} não está habilitado para esta organização.`), { code: 'INTEGRATION_DISABLED', terminal: true })
    const state = taskSyncState(task.data)
    const stateHash = await hash(state)
    if (planTaskProjection({link:link.data,stateHash}) === 'skip') {
      await admin.from('task_sync_outbox').update({ status: 'completed', processed_at: new Date().toISOString(), last_error: null }).eq('id', item.id)
      return true
    }
    const external = item.provider === 'trello' ? await upsertTrelloTask(task.data, setting.data.configuration, link.data) : await upsertNotionTask(task.data, setting.data.configuration, link.data)
    const saved = await admin.from('task_external_links').upsert({ organization_id: item.organization_id, task_id: item.task_id, provider: item.provider, ...external, last_synced_hash: stateHash, last_synced_at: new Date().toISOString(), sync_status: 'synced', last_error: null }, { onConflict: 'task_id,provider' })
    if (saved.error) throw saved.error
    await Promise.all([
      admin.from('task_sync_outbox').update({ status: 'completed', processed_at: new Date().toISOString(), last_error: null }).eq('id', item.id),
      admin.from('task_integration_settings').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('organization_id', item.organization_id).eq('provider', item.provider),
    ])
    return true
  } catch (error: any) {
    const attempts = Number(item.attempts || 0) + 1; const terminal = Boolean(error?.terminal) || attempts >= 8
    const status = terminal ? 'dead_letter' : 'failed'; const message = clean(error?.message)
    await Promise.all([
      admin.from('task_sync_outbox').update({ status, next_attempt_at: new Date(Date.now() + Math.min(21600, 2 ** attempts * 60) * 1000).toISOString(), last_error: message, processed_at: terminal ? new Date().toISOString() : null }).eq('id', item.id),
      admin.from('task_external_links').update({ sync_status: terminal ? 'error' : 'retry', last_error: message }).eq('organization_id', item.organization_id).eq('task_id', item.task_id).eq('provider', item.provider),
      admin.from('task_integration_settings').update({ last_error: message }).eq('organization_id', item.organization_id).eq('provider', item.provider),
    ])
    return false
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const expected = Deno.env.get('TASK_SYNC_WORKER_KEY') || ''
  if (!expected || request.headers.get('X-Task-Sync-Worker-Key') !== expected) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ ok: false, code: 'CONFIGURATION_MISSING' }, 503)
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const due = await admin.from('task_sync_outbox').select('*').in('status', ['pending','failed']).lte('next_attempt_at', new Date().toISOString()).order('created_at').limit(30)
  if (due.error) return json({ ok: false, code: 'QUEUE_READ_FAILED' }, 500)
  let completed = 0
  for (const item of due.data || []) if (await processItem(admin, item)) completed += 1
  return json({ ok: true, claimed: due.data?.length || 0, completed })
})
