import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dueSlots, normalizeTimes, pickNextProspect, prospectReplyAction, reminderMessage, reminderPayload, researchToQueue } from '../supabase/functions/_shared/prospectReminderCore.js'

test('horários: só os que chegaram há menos de 1h, só em dia útil', () => {
  assert.deepEqual(normalizeTimes('14:00, 9:00, 22:00, x, 09:00'), ['09:00', '14:00'])
  assert.deepEqual(dueSlots(['09:00', '10:30'], { minutes: 9 * 60 + 20, weekend: false }), ['09:00'])
  assert.deepEqual(dueSlots(['09:00'], { minutes: 10 * 60 + 5, weekend: false }), [])
  assert.deepEqual(dueSlots(['09:00'], { minutes: 9 * 60 + 5, weekend: true }), [])
})

test('próximo da fila: mensagem pós-aceite primeiro, depois o convite de maior nota', () => {
  const now = '2026-10-27T15:00:00Z'
  const rows = [
    { id: 'a', linkedin_state: 'pending', research_status: 'done', linkedin_note: 'oi', fit_score: 70, status: 'ready' },
    { id: 'b', linkedin_state: 'pending', research_status: 'done', linkedin_note: 'oi', fit_score: 94, status: 'ready' },
    { id: 'c', linkedin_state: 'pending', research_status: 'done', linkedin_note: 'oi', fit_score: 30, status: 'ready' },
    { id: 'd', linkedin_state: 'pending', research_status: 'done', linkedin_note: 'oi', fit_score: 99, status: 'ready', linkedin_reminded_at: '2026-10-27T12:00:00Z' },
  ]
  assert.deepEqual(pickNextProspect(rows, { nowIso: now }), { prospect: rows[1], stage: 'invite' })
  const withAccepted = [...rows, { id: 'e', linkedin_state: 'connected', linkedin_message: 'msg', status: 'contacted' }]
  assert.equal(pickNextProspect(withAccepted, { nowIso: now }).stage, 'message')
  assert.equal(pickNextProspect([rows[2]], { nowIso: now }), null)
  assert.equal(researchToQueue(3, 5), 7)
  assert.equal(researchToQueue(20, 5), 0)
})

test('mensagem do lembrete e respostas', () => {
  const p = reminderPayload({ prospect: { id: 'x', contact_name: 'Marcelo', company_name: 'Tuff', contact_role: 'CEO', linkedin_note: 'Oi Marcelo…' }, stage: 'invite', position: 2, total: 5 })
  assert.equal(p.profile_is_search, true)
  assert.match(p.profile_url, /linkedin\.com\/search\/results\/people\/\?keywords=Marcelo%20Tuff/)
  const text = reminderMessage(p)
  assert.match(text, /\(2 de 5 hoje\)/)
  assert.match(text, /\*Marcelo\* — CEO · Tuff/)
  assert.match(text, /Oi Marcelo…/)
  assert.equal(prospectReplyAction('feito'), 'done')
  assert.equal(prospectReplyAction('enviei!'), 'done')
  assert.equal(prospectReplyAction('pular'), 'skip')
  assert.equal(prospectReplyAction('feito a proposta da roove'), null)
  assert.equal(p.candidate_items[0].type, 'prospect')
})

test('secretária reconhece o lembrete de prospecção', () => {
  const worker = fs.readFileSync(new URL('../supabase/functions/task-command-worker/index.ts', import.meta.url), 'utf8')
  assert.match(worker, /active_intent==='PROSPECT_INVITE'&&candidateItems\[0\]\?\.prospect_id/)
  const notify = fs.readFileSync(new URL('../supabase/functions/team-notification-worker/index.ts', import.meta.url), 'utf8')
  assert.match(notify, /candidateType==='prospect'\?'PROSPECT_INVITE'/)
})
