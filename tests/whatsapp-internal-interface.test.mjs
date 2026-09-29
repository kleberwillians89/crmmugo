import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parseInternalCommand } from '../supabase/functions/_shared/internalCommandCore.js'

const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
const digestWorker = fs.readFileSync('supabase/functions/team-notification-worker/index.ts', 'utf8')
const digestMigration = fs.readFileSync('supabase/migrations/202609240003_whatsapp_internal_digests.sql', 'utf8')
const auditMigration = fs.readFileSync('supabase/migrations/202609240004_whatsapp_assistant_audit_trail.sql', 'utf8')

test('cria tarefa: data no início do texto não vaza mais para o título (regressão)', () => {
  const options={now:new Date('2026-09-24T12:00:00-03:00')}
  const withoutPara = parseInternalCommand('cria tarefa amanhã revisar Origami',options)
  assert.equal(withoutPara.intent, 'CREATE_TASK')
  assert.equal(withoutPara.title, 'revisar Origami')
  assert.equal(withoutPara.due_date, '2026-09-25')
  const trailing = parseInternalCommand('cria tarefa revisar Origami amanhã',options)
  assert.equal(trailing.title, 'revisar Origami')
  const noDate = parseInternalCommand('cria tarefa comprar servidor',options)
  assert.equal(noDate.title, 'comprar servidor')
  assert.equal(noDate.due_date, null)
})

test('"o que fiz hoje?" gera intent própria e não é confundida com "meu dia"', () => {
  for (const phrase of ['o que fiz hoje?', 'o que eu fiz hoje', 'oq fiz hoje']) {
    assert.equal(parseInternalCommand(phrase).intent, 'DAY_SUMMARY', phrase)
  }
  assert.equal(parseInternalCommand('meu dia').intent, 'LIST_MINE')
  assert.equal(parseInternalCommand('o que temos hoje').intent, 'LIST_TODAY')
})

test('comandos existentes continuam intactos após as mudanças (regressão ampla)', () => {
  assert.equal(parseInternalCommand('comecei site CAFIFA').intent, 'ACTIVITY_START')
  assert.equal(parseInternalCommand('comecei a homologação do CRMugo').intent, 'ACTIVITY_START')
  assert.equal(parseInternalCommand('terminei ajustes Roove').intent, 'ACTIVITY_COMPLETE')
  const time = parseInternalCommand('trabalhei 9 horas hoje')
  assert.equal(time.intent, 'RECORD_TIME')
  assert.equal(time.hours, 9)
  assert.equal(parseInternalCommand('Origami aprovou a home').intent, 'RECORD_DECISION')
  assert.equal(parseInternalCommand('anota que cliente pediu alteração no banner').intent, 'RECORD_OBSERVATION')
  const proposal = parseInternalCommand('fizemos orçamento de 4500 para CAFIFA')
  assert.equal(proposal.intent, 'RECORD_PROPOSAL')
  assert.equal(proposal.amount, 4500)
  const expense = parseInternalCommand('gastei 106 reais em tráfego da Mugô')
  assert.equal(expense.intent, 'FINANCIAL_EXPENSE_REQUEST')
  assert.equal(expense.amount, 106)
  const receipt = parseInternalCommand('entrou 3200 da Roove')
  assert.equal(receipt.intent, 'FINANCIAL_RECEIPT_REQUEST')
  assert.equal(receipt.amount, 3200)
  assert.equal(parseInternalCommand('sim').intent, 'CONFIRM_FINANCIAL')
  assert.equal(parseInternalCommand('cancelar').intent, 'CANCEL_FINANCIAL')
})

test('worker: DAY_SUMMARY e "meu dia" leem dados reais do CRM, nunca inventam', () => {
  assert.ok(worker.includes("command.intent === 'DAY_SUMMARY'"))
  assert.ok(worker.includes("event_type === 'time_recorded'"))
  assert.ok(worker.includes("event_type === 'activity_started'") || worker.includes("count('activity_started')"))
  assert.ok(worker.includes('Você ainda não registrou nada hoje.'))
  assert.ok(worker.includes('Hoje você tem:'))
  assert.ok(worker.includes('atividade${ongoing===1'))
  assert.ok(worker.includes('h registradas'))
  assert.ok(worker.includes('cobrança${followUps===1'))
})

test('worker: comandos financeiros/comerciais sensíveis exigem admin ou manager (operador segue bloqueado)', () => {
  assert.match(worker, /FINANCIAL_ADMIN_INTENTS\.has\(command\.intent\)[\s\S]{0,40}isAdminActor/)
  assert.ok(worker.includes("['admin','manager'].includes(profile.data?.role)"))
  for (const gated of ['FINANCIAL_RECEIPT_REQUEST', 'FREELANCE_INCOME_REQUEST', 'LIST_PENDING_CHARGES', 'RECORD_PROPOSAL', 'UPDATE_PROPOSAL', 'QUERY_OVERDUE_RECEIVABLES', 'QUERY_RECEIVED_TOTAL', 'QUERY_EXPENSES']) {
    assert.ok(!/FINANCIAL_ADMIN_INTENTS\s*=\s*new Set\(\[[^\]]*\]\)/.exec(worker) || worker.match(/FINANCIAL_ADMIN_INTENTS\s*=\s*new Set\(\[([^\]]*)\]\)/)[1].includes(`'${gated}'`), gated)
  }
  // tarefas, atividades, horas, observações, SOLICITAR despesa e consultas pessoais continuam liberadas ao operador
  const gatedList = worker.match(/FINANCIAL_ADMIN_INTENTS\s*=\s*new Set\(\[([^\]]*)\]\)/)[1]
  for (const open of ['FINANCIAL_EXPENSE_REQUEST', 'QUERY_PENDING_CONFIRMATIONS', 'QUERY_WEEKLY_HOURS', 'CREATE_TASK', 'RECORD_TIME', 'RECORD_OBSERVATION', 'COLLECTION_ACTIVITY', 'FOLLOW_UP', 'CLIENT_UPDATE']) {
    assert.ok(!gatedList.includes(`'${open}'`), open)
  }
})

test('parser: novos domínios (cobrança, follow-up, atualização de cliente, documento por texto)', () => {
  const contacted = parseInternalCommand('cobrei a Roove porque está atrasada')
  assert.equal(contacted.intent, 'COLLECTION_ACTIVITY'); assert.equal(contacted.collection_kind, 'contacted'); assert.equal(contacted.subject_query, 'Roove')
  const unpaid = parseInternalCommand('Origami ainda não pagou')
  assert.equal(unpaid.intent, 'COLLECTION_ACTIVITY'); assert.equal(unpaid.collection_kind, 'unpaid_status'); assert.equal(unpaid.subject_query, 'Origami')
  const promised = parseInternalCommand('CAFIFA disse que paga sexta')
  assert.equal(promised.intent, 'COLLECTION_ACTIVITY'); assert.equal(promised.collection_kind, 'promised')
  const followUp = parseInternalCommand('me lembra de cobrar CAFIFA amanhã',{now:new Date('2026-09-24T12:00:00-03:00')})
  assert.equal(followUp.intent, 'FOLLOW_UP'); assert.equal(followUp.subject_query, 'CAFIFA'); assert.equal(followUp.due_date, '2026-09-25')
  const clientUpdate = parseInternalCommand('CAFIFA pediu alteração na home')
  assert.equal(clientUpdate.intent, 'CLIENT_UPDATE'); assert.equal(clientUpdate.subject_query, 'CAFIFA')
  const document = parseInternalCommand('recebi comprovante da Roove')
  assert.equal(document.intent, 'DOCUMENT'); assert.equal(document.subject_query, 'Roove')
})

test('regressão crítica: artigo opcional não engole nomes que começam com A/O ("Origami" != "rigami")', () => {
  assert.equal(parseInternalCommand('Origami pagou 3500').subject_query, 'Origami')
  assert.equal(parseInternalCommand('Origami ainda não pagou').subject_query, 'Origami')
  assert.equal(parseInternalCommand('cobrei Origami').subject_query, 'Origami')
  assert.equal(parseInternalCommand('Origami disse que paga sexta').subject_query, 'Origami')
  assert.equal(parseInternalCommand('Origami pediu alteração na home').subject_query, 'Origami')
  assert.equal(parseInternalCommand('o que Ana tem hoje').assignee_name, 'Ana')
})

test('regressão: "anota" com orçamento/proposta continua indo para RECORD_PROPOSAL, não RECORD_OBSERVATION', () => {
  assert.equal(parseInternalCommand('anota orçamento de 4500 para CAFIFA').intent, 'RECORD_PROPOSAL')
  assert.equal(parseInternalCommand('anota que enviamos orçamento para CAFIFA').intent, 'RECORD_PROPOSAL')
  assert.equal(parseInternalCommand('anota que a CAFIFA pediu retorno amanhã').intent, 'RECORD_OBSERVATION')
  assert.equal(parseInternalCommand('anota que cliente pediu alteração no banner').intent, 'RECORD_OBSERVATION')
  assert.equal(parseInternalCommand('anota que Origami ainda não pagou').intent, 'RECORD_OBSERVATION')
})

test('ambiguidade: nunca inventa cliente/categoria/objeto quando a mensagem é incompleta', () => {
  assert.ok(worker.includes("De quem recebemos ${brl(command.amount)}?"))
  assert.ok(worker.includes("return `Com o que foram os ${brl(command.amount)}?`"))
  assert.ok(worker.includes("'O que você começou?'"))
  assert.ok(worker.includes("'O que você terminou?'"))
  const bareReceipt = parseInternalCommand('entrou 3000')
  assert.equal(bareReceipt.subject_query, null)
  const bareExpense = parseInternalCommand('paguei 500')
  assert.equal(bareExpense.category_name, null); assert.equal(bareExpense.description, null)
  assert.equal(parseInternalCommand('terminei').summary, null)
})

test('mensagens livres: variações naturais de horas e recebimento chegam ao mesmo intent', () => {
  for (const phrase of ['trabalhei 7h', 'hoje foram 7 horas', 'fecha meu dia com 7 horas', 'coloca 7h trabalhadas hoje']) {
    const result = parseInternalCommand(phrase)
    assert.equal(result.intent, 'RECORD_TIME', phrase); assert.equal(result.hours, 7, phrase)
  }
  for (const phrase of ['a Roove pagou 3200', 'entrou o pagamento da Roove de 3200', 'recebemos 3200 da Roove', 'caiu os 3200 da Roove']) {
    const result = parseInternalCommand(phrase)
    assert.equal(result.intent, 'FINANCIAL_RECEIPT_REQUEST', phrase); assert.equal(result.amount, 3200, phrase); assert.equal(result.subject_query, 'Roove', phrase)
  }
})

test('confirmação financeira mostra cliente e competência antes de perguntar', () => {
  assert.ok(worker.includes('const competence=installment.reference_month?'))
  assert.match(worker, /Encontrei \$\{description\}[\s\S]{0,20}competence/)
  assert.doesNotMatch(worker, /Confirmar recebimento de \$\{brl\(command\.amount\)\}/)
})

test('registro universal: task_command_events ganha entity_type/entity_id (migration + worker)', () => {
  assert.ok(auditMigration.includes('add column if not exists entity_type text'))
  assert.ok(auditMigration.includes('add column if not exists entity_id uuid'))
  assert.doesNotMatch(auditMigration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(auditMigration, /create table/i) // aditivo à tabela existente, sem infraestrutura nova
  assert.ok(worker.includes('entity_type: event.entity_type||null'))
  assert.ok(worker.includes('entity_id: event.entity_id||null'))
  for (const marker of ["event.entity_type='crm_tasks'", "event.entity_type='invoice_installments'", "event.entity_type='expenses'", "event.entity_type='freelance_cash_movements'"]) {
    assert.ok(worker.includes(marker), marker)
  }
})

test('consultas respeitam permissões: "quem está devendo" e totais financeiros exigem admin/manager; horas e confirmações pendentes são pessoais', () => {
  assert.equal(parseInternalCommand('quem está devendo?').intent, 'QUERY_OVERDUE_RECEIVABLES')
  assert.equal(parseInternalCommand('quanto entrou hoje?').intent, 'QUERY_RECEIVED_TOTAL')
  assert.equal(parseInternalCommand('quais despesas temos em outubro?').month_name, 'outubro')
  assert.equal(parseInternalCommand('tem alguma confirmação pendente?').intent, 'QUERY_PENDING_CONFIRMATIONS')
  assert.equal(parseInternalCommand('quantas horas trabalhei essa semana?').intent, 'QUERY_WEEKLY_HOURS')
  assert.equal(parseInternalCommand('o que está atrasado?').intent, 'LIST_OVERDUE')
})

test('worker: idempotência por message_id — mesma tarefa/hora/despesa/recebimento nunca duplica', () => {
  // Item único mantém a mesma chave de sempre; itens múltiplos (ex.: duas atividades numa só mensagem)
  // ganham um sufixo individual — nunca duas linhas competindo pela mesma idempotency_key.
  assert.ok(worker.includes("idempotencyKey=itemIndex===null?`command:${event.id}:${type}`:`command:${event.id}:${type}:${itemIndex}`"))
  assert.ok(worker.includes("onConflict:'organization_id,idempotency_key'"))
  assert.ok(worker.includes("eq('source_ref',event.id)")) // CREATE_TASK dedupe pelo próprio evento
})

test('worker: comando de membro interno inativo continua bloqueado (unauthorized internal command)', () => {
  assert.ok(worker.includes("eq('active', true).single()"))
  assert.ok(worker.includes('TEAM_MEMBER_INACTIVE'))
})

test('migration de digests: colunas em organization_settings, sem tabela paralela, sem DELETE', () => {
  assert.ok(digestMigration.includes('morning_digest_enabled'))
  assert.ok(digestMigration.includes('morning_digest_time'))
  assert.ok(digestMigration.includes('end_of_day_digest_enabled'))
  assert.ok(digestMigration.includes('end_of_day_digest_time'))
  assert.doesNotMatch(digestMigration, /create table.*organization_digest_settings/i)
  assert.doesNotMatch(digestMigration, /\bdelete\s+from\b/i)
  assert.ok(digestMigration.includes('team_notification_outbox'))
  assert.ok(digestMigration.includes('force row level security'))
  assert.ok(digestMigration.includes("unique(organization_id,idempotency_key)"))
})

test('digest worker: alertas de recebível/confirmação financeira só vão para admin/manager', () => {
  assert.ok(digestWorker.includes('async function isAdminMember'))
  assert.ok(digestWorker.includes("if (!(await isAdminMember(admin, member.organization_id, member))) continue"))
})

test('digest worker: dedupe por idempotency_key — mesmo alerta/dígest nunca repete', () => {
  assert.ok(digestWorker.includes('unique(organization_id,idempotency_key)') === false) // está na migration, não aqui
  assert.match(digestWorker, /`morning:\$\{member\.id\}:\$\{today\}`/)
  assert.match(digestWorker, /`eod:\$\{member\.id\}:\$\{today\}`/)
  assert.match(digestWorker, /`alert:overdue-tasks:\$\{member\.id\}:\$\{today\}`/)
  assert.match(digestWorker, /`alert:due-tomorrow:\$\{installment\.id\}`/)
  assert.ok(digestWorker.includes("error.code !== '23505'"))
})

test('digest worker: somente números internos autorizados, nunca clientes; nenhum vazamento pessoal/household/private', () => {
  assert.ok(digestWorker.includes("from('team_members')"))
  assert.doesNotMatch(digestWorker, /whatsapp_contacts.*contact_type.*customer/i)
  assert.ok(digestWorker.includes("contact_type: 'internal'"))
  // remove comentários de linha (onde é legítimo documentar a exclusão) antes de checar código real
  const codeOnly = digestWorker.replace(/\/\/.*$/gm, '')
  for (const leaked of ['household', 'private', 'reserva pessoal', 'distribuição de sócios']) {
    assert.doesNotMatch(codeOnly, new RegExp(leaked, 'i'), leaked)
  }
  assert.ok(digestWorker.includes("not('phone', 'is', null)"))
})

test('digest worker: só lê SLA comercial; IA comercial e envio em massa seguem fora de escopo', () => {
  assert.match(digestWorker, /handoff_reminder_minutes/)
  assert.doesNotMatch(digestWorker, /ai_mode/i)
  assert.doesNotMatch(digestWorker, /broadcast|mensagem em massa/i)
})
