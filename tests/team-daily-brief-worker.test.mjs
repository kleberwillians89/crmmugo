import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { buildDailyBriefDisplayText, buildDailyBriefSummary, hourInSaoPaulo, isBusinessDayInSaoPaulo, selectDailyBriefTasks, shouldRunDailyBrief, todayInSaoPaulo } from '../supabase/functions/_shared/teamDailyBriefCore.js'

const worker = fs.readFileSync('supabase/functions/team-daily-brief-worker/index.ts', 'utf8')

// ===================================================================================================
// Timezone/dia útil — nunca depende do horário UTC do servidor para decidir o dia (America/Sao_Paulo).
// ===================================================================================================

// --- 14/15: fim de semana nunca envia; a decisão é sempre pelo relógio de São Paulo, nunca UTC -------
test('14/15: sábado/domingo (America/Sao_Paulo) nunca deve rodar, mesmo cruzando a virada de dia em UTC', () => {
  // 2026-10-03T04:00:00Z é sábado em UTC E em São Paulo (01h, já virou o dia) — não deve rodar.
  assert.equal(isBusinessDayInSaoPaulo(new Date('2026-10-03T04:00:00Z')), false)
  // 2026-10-03T01:00:00Z é SÁBADO em UTC, mas ainda SEXTA 22h em São Paulo — prova que a regra usa o
  // relógio de São Paulo, não o de UTC (se usasse UTC, isto falharia incorretamente como fim de semana).
  assert.equal(isBusinessDayInSaoPaulo(new Date('2026-10-03T01:00:00Z')), true)
  // Mesmo padrão do outro lado da semana: 2026-09-26T02:00:00Z é sábado em UTC, mas sexta 23h em SP.
  assert.equal(isBusinessDayInSaoPaulo(new Date('2026-09-26T02:00:00Z')), true)
  // Terça comum (2026-09-29) é dia útil nos dois fusos, sem ambiguidade.
  assert.equal(isBusinessDayInSaoPaulo(new Date('2026-09-29T15:00:00Z')), true)
})

// --- 15: hora local de São Paulo — nunca UTC ------------------------------------------------------
test('15: hourInSaoPaulo/shouldRunDailyBrief usam o horário local de São Paulo, não UTC', () => {
  // 2026-09-29T11:00:00Z = 08h00 em São Paulo (UTC-3) — exatamente o TEAM_DAILY_BRIEF_HOUR default.
  assert.equal(hourInSaoPaulo(new Date('2026-09-29T11:00:00Z')), 8)
  assert.equal(shouldRunDailyBrief(new Date('2026-09-29T11:00:00Z'), 8), true)
  // Um minuto antes (10h59 UTC = 07h59 em SP) ainda não deve rodar.
  assert.equal(shouldRunDailyBrief(new Date('2026-09-29T10:59:00Z'), 8), false)
  // TEAM_DAILY_BRIEF_HOUR não é hardcoded — outro valor configurado muda a decisão.
  assert.equal(shouldRunDailyBrief(new Date('2026-09-29T10:59:00Z'), 7), true)
})

test('todayInSaoPaulo devolve a data local, não a data UTC, perto da virada de dia', () => {
  // 2026-09-26T02:00:00Z já é sábado em UTC, mas ainda 25/09 (sexta) às 23h em São Paulo.
  assert.equal(todayInSaoPaulo(new Date('2026-09-26T02:00:00Z')), '2026-09-25')
})

// ===================================================================================================
// Seleção de tarefas — só hoje e atrasadas; nunca futura, nunca sem data (backlog).
// ===================================================================================================

// --- 8/9/10/11: filtro de tarefas (o worker já filtra status na query; esta função só separa datas) --
test('8/9/10/11: selectDailyBriefTasks separa hoje/atrasada e nunca inclui futura ou sem data', () => {
  const today = '2026-09-29'
  const rows = [
    { id: 'a', title: 'Revisar campanha Roove', due_date: today, due_time: null, priority: 'medium' },
    { id: 'b', title: 'Finalizar site da Mila', due_date: today, due_time: null, priority: 'medium' },
    { id: 'c', title: 'Gravação de conteúdo Origami', due_date: today, due_time: '14:00:00', priority: 'medium' },
    { id: 'd', title: 'Falar com Carelle', due_date: '2026-09-25', due_time: null, priority: 'medium' },
    { id: 'e', title: 'Tarefa futura', due_date: '2026-10-05', due_time: null, priority: 'medium' },
    { id: 'f', title: 'Tarefa sem data (backlog)', due_date: null, due_time: null, priority: 'medium' },
  ]
  const { todayTasks, overdueTasks } = selectDailyBriefTasks(rows, today)
  assert.deepEqual(todayTasks.map((row) => row.id), ['a', 'b', 'c'])
  assert.deepEqual(overdueTasks.map((row) => row.id), ['d'])
  // 11: tarefa atrasada entra na seção "Atrasadas" (não em "hoje").
  assert.ok(!todayTasks.some((row) => row.id === 'd'))
  // 10: tarefa futura nunca entra em nenhuma das duas seções.
  assert.ok(![...todayTasks, ...overdueTasks].some((row) => row.id === 'e'))
  // Tarefa sem due_date (backlog) também nunca entra.
  assert.ok(![...todayTasks, ...overdueTasks].some((row) => row.id === 'f'))
})

// ===================================================================================================
// Conteúdo da mensagem — nunca quebra de linha no parâmetro de template Meta; prioridade e cliente
// aparecem quando presentes.
// ===================================================================================================

test('buildDailyBriefSummary nunca contém quebra de linha (parâmetro de template Meta) e reflete prioridade/cliente', () => {
  const todayTasks = [
    { title: 'Revisar campanha Roove', due_date: '2026-09-29', due_time: null, priority: 'medium' },
    { title: 'Gravação de conteúdo Origami', due_date: '2026-09-29', due_time: '14:00:00', priority: 'high', clients: { trade_name: 'Origami' } },
  ]
  const overdueTasks = [{ title: 'Falar com Carelle', due_date: '2026-09-25', due_time: null, priority: 'medium' }]
  const summary = buildDailyBriefSummary({ todayTasks, overdueTasks })
  assert.doesNotMatch(summary, /\n/)
  assert.match(summary, /Revisar campanha Roove/)
  assert.match(summary, /🔴 Gravação de conteúdo Origami \(Origami\) — 14:00/)
  assert.match(summary, /Atrasadas \(1\): Falar com Carelle/)
})

test('buildDailyBriefSummary sem nenhuma tarefa não inventa conteúdo (defensivo — worker já filtra antes)', () => {
  assert.equal(buildDailyBriefSummary({ todayTasks: [], overdueTasks: [] }), 'Hoje: nenhuma demanda com prazo.')
})

test('buildDailyBriefDisplayText produz o texto legível do histórico com seções "hoje" e "Atrasadas"', () => {
  const text = buildDailyBriefDisplayText({
    firstName: 'Kleber',
    todayTasks: [
      { title: 'Revisar campanha Roove', due_date: '2026-09-29', due_time: null, priority: 'medium' },
      { title: 'Finalizar site da Mila', due_date: '2026-09-29', due_time: null, priority: 'medium' },
      { title: 'Gravação de conteúdo Origami', due_date: '2026-09-29', due_time: '14:00:00', priority: 'medium' },
    ],
    overdueTasks: [{ title: 'Falar com Carelle', due_date: '2026-09-25', due_time: null, priority: 'medium' }],
  })
  assert.match(text, /^Bom dia, Kleber\.$/m)
  assert.match(text, /Hoje você tem 3 demandas:/)
  assert.match(text, /1\. Revisar campanha Roove/)
  assert.match(text, /3\. Gravação de conteúdo Origami — 14:00/)
  assert.match(text, /Atrasadas: 1/)
  assert.match(text, /• Falar com Carelle/)
})

// ===================================================================================================
// Isolamento por membro, template gate, idempotência e ausência de efeitos colaterais comerciais —
// verificação estática do worker (sem runtime Deno disponível neste repositório).
// ===================================================================================================

// --- 4/5/6: nunca mistura tarefas entre membros — assigned_to=member.id é a única fonte de verdade ---
test('4/5/6: a query de tarefas do worker filtra por assigned_to=member.id (nunca cross-member)', () => {
  assert.match(worker, /\.eq\('organization_id', member\.organization_id\)\.eq\('assigned_to', member\.id\)/)
  assert.match(worker, /\.not\('status', 'in', '\(completed,cancelled\)'\)\.lte\('due_date', today\)/)
})

// --- 7: sem tarefas hoje nem atrasada, nenhuma mensagem é enviada ------------------------------------
test('7: sem tarefa de hoje nem atrasada, sendDailyBrief retorna antes de qualquer envio/insert', () => {
  const guardIdx = worker.indexOf('if (!todayTasks.length && !overdueTasks.length) return false')
  const sendIdx = worker.indexOf("fetch(`https://graph.facebook.com")
  assert.ok(guardIdx > -1 && sendIdx > guardIdx)
})

// --- 12: template não aprovado nunca envia, nunca marca como enviado, nunca quebra o worker ----------
test('12: template não aprovado loga TEMPLATE_NOT_APPROVED e retorna sem enviar nem marcar como enviado', () => {
  assert.match(worker, /\.eq\('status', 'APPROVED'\)\.eq\('is_active', true\)\.maybeSingle\(\)/)
  assert.match(worker, /if \(!template\.data\) \{ log\('team_daily_brief_skipped', \{ reason: 'TEMPLATE_NOT_APPROVED'/)
  // O bloco de falha do worker nunca deixa o erro escapar sem tratamento (catch dedicado no loop).
  assert.match(worker, /catch \(error\) \{\s*\n\s*log\('team_daily_brief_failed'/)
})

// --- 13: idempotência diária — checa whatsapp_messages por idempotency_key antes de qualquer envio ---
test('13: idempotency_key team-daily-brief:{team_member_id}:{YYYY-MM-DD} é checado antes do envio', () => {
  assert.match(worker, /const idempotencyKey = `team-daily-brief:\$\{member\.id\}:\$\{today\}`/)
  const idempotencyIdx = worker.indexOf('const idempotencyKey = `team-daily-brief:')
  const templateCheckIdx = worker.indexOf("eq('status', 'APPROVED')")
  const sendIdx = worker.indexOf('fetch(`https://graph.facebook.com')
  assert.ok(idempotencyIdx > -1 && idempotencyIdx < templateCheckIdx && templateCheckIdx < sendIdx)
  assert.match(worker, /if \(existing\.data\) return false/)
})

// --- 14: regra de dia útil aplicada no ponto de entrada, antes de qualquer leitura de team_members ---
test('14: a regra de dia útil/hora é checada antes de ler team_members (nunca processa fora da janela)', () => {
  const gateIdx = worker.indexOf('if (!shouldRunDailyBrief(new Date(), configuredHour))')
  const membersIdx = worker.indexOf("from('team_members')")
  assert.ok(gateIdx > -1 && membersIdx > gateIdx)
  assert.match(worker, /TEAM_DAILY_BRIEF_HOUR/)
})

// --- 16: nenhuma criação de commercial_opportunity, lead, cliente ou proposta ------------------------
test('16: o worker nunca cria commercial_opportunity, lead, cliente novo ou proposta', () => {
  assert.doesNotMatch(worker, /commercial_opportunities|commercial_leads|\.from\('clients'\)\.insert|\.from\('proposals'\)/)
  // Contato/conversa usam find-or-create (nunca update em linha já existente) e sempre contact_type='internal'.
  assert.match(worker, /contact_type: 'internal', team_member_id: member\.id/)
  assert.doesNotMatch(worker, /from\('whatsapp_contacts'\)\.update\(|from\('whatsapp_conversations'\)\.update\(\{[^}]*attendance_mode/)
})

// --- vinculação correta no histórico canônico (whatsapp_messages) -----------------------------------
test('histórico: whatsapp_messages grava direction=out, message_type=template, template_name e team_member_id corretos', () => {
  assert.match(worker, /direction: 'out', message_type: 'template', status: 'queued', template_name: TEMPLATE/)
  assert.match(worker, /organization_id: organizationId, connection_id: connection\.data\.id, conversation_id: conversationId, team_member_id: member\.id/)
  assert.match(worker, /const TEMPLATE = 'mugo_resumo_diario_equipe', LANGUAGE = 'pt_BR'/)
})

console.log('team-daily-brief-worker: ok')
