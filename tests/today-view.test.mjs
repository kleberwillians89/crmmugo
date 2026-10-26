import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTodayGroups, describeFeedItem, dueLabel, greeting, memberForProfile, waitingFor } from '../src/lib/todayView.js'

const today = '2026-10-26'
const tasks = [
  { id: 'a', title: 'Atrasada', due_date: '2026-10-25', assigned_to: 'k', status: 'pending' },
  { id: 'b', title: 'Hoje 17h', due_date: today, due_time: '17:00:00', assigned_to: 'k', status: 'pending' },
  { id: 'c', title: 'Hoje 09h', due_date: today, due_time: '09:00:00', assigned_to: 'j', status: 'in_progress' },
  { id: 'd', title: 'Feita', due_date: today, assigned_to: 'k', status: 'completed' },
  { id: 'e', title: 'Quarta', due_date: '2026-10-28', assigned_to: 'k', status: 'pending' },
  { id: 'f', title: 'Longe', due_date: '2026-11-20', assigned_to: 'k', status: 'pending' },
  { id: 'g', title: 'Sem data', due_date: null, assigned_to: 'k', status: 'pending' },
  { id: 'h', title: 'Arquivada', due_date: today, assigned_to: 'k', status: 'pending', archived_at: '2026-10-20' },
]

test('Hoje agrupa só tarefas abertas: atrasadas, hoje (por horário) e próximos 7 dias', () => {
  const team = buildTodayGroups(tasks, { today, scope: 'team' })
  assert.deepEqual(team.overdue.map((t) => t.id), ['a'])
  assert.deepEqual(team.today.map((t) => t.id), ['c', 'b'])
  assert.deepEqual(team.upcoming.map((t) => t.id), ['e'])
  assert.equal(team.undated, 1)
  const mine = buildTodayGroups(tasks, { today, memberId: 'k', scope: 'mine' })
  assert.deepEqual(mine.today.map((t) => t.id), ['b'])
})

test('prazo em português', () => {
  assert.equal(dueLabel({ due_date: '2026-10-25' }, today), 'ontem')
  assert.equal(dueLabel({ due_date: '2026-10-22' }, today), 'há 4 dias')
  assert.equal(dueLabel({ due_date: today, due_time: '17:00:00' }, today), 'até 17:00')
  assert.equal(dueLabel({ due_date: today, due_time: '14:00:00', ends_at: 'x' }, today), '14:00')
  assert.equal(dueLabel({ due_date: today }, today), 'hoje')
  assert.equal(dueLabel({ due_date: '2026-10-27' }, today), 'amanhã')
  assert.equal(dueLabel({ due_date: '2026-10-28' }, today), 'qua, 28/10')
})

test('saudação e membro do login', () => {
  assert.equal(greeting(8), 'Bom dia'); assert.equal(greeting(14), 'Boa tarde'); assert.equal(greeting(21), 'Boa noite')
  const members = [{ id: 'm1', name: 'Julia' }, { id: 'm2', name: 'Kleber', auth_profile_id: 'u1' }]
  assert.equal(memberForProfile(members, { id: 'u1', name: 'Kleber Willians' }).id, 'm2')
  assert.equal(memberForProfile([{ id: 'm1', name: 'Julia Souza' }], { id: 'x', name: 'Julia' }).id, 'm1')
  assert.equal(memberForProfile(members, null), null)
})

test('diário da Secretária em frases curtas', () => {
  assert.deepEqual(describeFeedItem({ source: 'command', member_name: 'Julia Souza', title: 'feito', detail: 'Concluída ✓' }), { who: 'Julia', text: 'marcou uma tarefa como feita pelo WhatsApp' })
  assert.match(describeFeedItem({ source: 'command', member_name: 'Kleber', title: 'Danilo reunião 14h', detail: 'Tarefa criada ✓' }).text, /criou tarefa pelo WhatsApp: “Danilo reunião 14h”/)
  assert.equal(describeFeedItem({ source: 'notification', kind: 'morning_digest', member_name: 'Danilo' }).text, 'recebeu o resumo do dia')
  assert.match(describeFeedItem({ source: 'notification', kind: 'handoff_reminder', member_name: 'Julia', title: 'Ana' }).text, /Ana esperando atendimento/)
})

test('tempo de espera', () => {
  const now = Date.parse('2026-10-26T17:00:00Z')
  assert.equal(waitingFor('2026-10-26T16:48:00Z', now), '12 min')
  assert.equal(waitingFor('2026-10-26T14:00:00Z', now), '3 h')
  assert.equal(waitingFor('2026-10-24T17:00:00Z', now), '2 d')
})

test('tema Mugô carregado por último e função do diário só para logados', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.ok(app.indexOf('./theme-mugo.css') > app.indexOf('./growth.css'))
  const sql = readFileSync(new URL('../supabase/migrations/202610260001_diario_secretaria.sql', import.meta.url), 'utf8')
  assert.match(sql, /security definer/)
  assert.match(sql, /current_organization_id\(\)/)
  assert.match(sql, /revoke all on function public\.secretary_feed\(integer\) from public, anon/)
})

test('na visão Equipe, tarefa pessoal só aparece para o dono', () => {
  const list = [
    { id: 'p', title: 'Treino', category: 'Treino', due_date: today, assigned_to: 'k', status: 'pending' },
    { id: 'w', title: 'Post', category: 'Trabalho', due_date: today, assigned_to: 'k', status: 'pending' },
  ]
  assert.deepEqual(buildTodayGroups(list, { today, memberId: 'j', scope: 'team' }).today.map((t) => t.id), ['w'])
  assert.deepEqual(buildTodayGroups(list, { today, memberId: 'k', scope: 'team' }).today.map((t) => t.id), ['w', 'p'])
  assert.deepEqual(buildTodayGroups(list, { today, memberId: 'k', scope: 'mine' }).today.map((t) => t.id), ['w', 'p'])
})
