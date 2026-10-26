import test from 'node:test'
import assert from 'node:assert/strict'
import { columnFor, patchForColumn, daysSince } from '../src/lib/prospectBoard.js'

test('coluna de cada prospect no quadro', () => {
  assert.equal(columnFor({ research_status: 'done', linkedin_state: 'pending', status: 'ready' }), 'ready')
  assert.equal(columnFor({ linkedin_state: 'connection_sent', status: 'contacted' }), 'invited')
  assert.equal(columnFor({ linkedin_state: 'connected' }), 'connected')
  assert.equal(columnFor({ linkedin_state: 'messaged' }), 'messaged')
  assert.equal(columnFor({ linkedin_state: 'messaged', status: 'replied' }), 'replied')
  assert.equal(columnFor({ linkedin_state: 'skipped' }), 'out')
  assert.equal(columnFor({ research_status: 'queued', status: 'new' }), null)
})

test('mover de coluna gera o patch certo', () => {
  const now = '2026-10-26T21:00:00Z'
  assert.deepEqual(patchForColumn('invited', { status: 'ready' }, now), { linkedin_state: 'connection_sent', last_contact_at: now, status: 'contacted' })
  assert.deepEqual(patchForColumn('connected', { status: 'contacted' }, now), { linkedin_state: 'connected', last_contact_at: now })
  assert.deepEqual(patchForColumn('ready', {}), { linkedin_state: 'pending', status: 'ready' })
  assert.deepEqual(patchForColumn('out', { status: 'ready' }), { linkedin_state: 'skipped', status: 'disqualified' })
  assert.equal(patchForColumn('replied', {}), null)
  assert.equal(daysSince('2026-10-23T21:00:00Z', Date.parse(now)), 3)
})
