import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInternalCommand, parseMultiAssigneeTask } from '../supabase/functions/_shared/internalCommandCore.js'
import { safeSecretaryWriteRescue, secretaryActionToCommand } from '../supabase/functions/_shared/internalSecretaryAgent.js'

const teamMembers = [{ id: 'kleber', name: 'Kleber', active: true }, { id: 'julia', name: 'Julia', active: true }]
const now = new Date('2026-09-30T12:00:00-03:00') // quarta-feira

// ===================================================================================================
// MULTI ASSIGNEE PARSING + ONE TASK PER ASSIGNEE + SHARED DATE/TIME/TITLE
// ===================================================================================================
test('regressão EXATA de produção: "crie uma reunião hoje às 22h chamada Se conectarem, uma para Kleber e outra para Julia"', () => {
  const message = 'crie uma reunião hoje às 22h chamada Se conectarem, uma para Kleber e outra para Julia'
  const rescue = safeSecretaryWriteRescue(message, { now, teamMembers })
  assert.equal(rescue.reply_mode, 'execute')
  const commands = rescue.actions.map(secretaryActionToCommand)
  assert.equal(commands.length, 2)
  for (const command of commands) {
    assert.equal(command.intent, 'CREATE_TASK')
    assert.equal(command.title, 'Se conectarem')
    assert.equal(command.due_date, '2026-09-30')
    assert.equal(command.due_time, '22:00')
    assert.equal(command.task_type, 'meeting')
  }
  assert.deepEqual(commands.map((command) => command.assignee_name), ['Kleber', 'Julia'])
})
test('"marca reunião Origami sexta às 14h para Kleber e Julia" cria uma reunião por responsável', () => {
  const rescue = safeSecretaryWriteRescue('marca reunião Origami sexta às 14h para Kleber e Julia', { now, teamMembers })
  assert.equal(rescue.reply_mode, 'execute')
  const commands = rescue.actions.map(secretaryActionToCommand)
  assert.equal(commands.length, 2)
  assert.deepEqual(commands.map((command) => command.assignee_name), ['Kleber', 'Julia'])
  for (const command of commands) {
    assert.equal(command.title, 'Origami')
    assert.equal(command.due_date, '2026-10-02') // próxima sexta a partir de 2026-09-30 (quarta)
    assert.equal(command.due_time, '14:00')
    assert.equal(command.task_type, 'meeting')
  }
})
test('"coloca reunião Roove amanhã 10h para mim e para Julia" resolve "mim" como o próprio remetente (assignee_name null)', () => {
  const rescue = safeSecretaryWriteRescue('coloca reunião Roove amanhã 10h para mim e para Julia', { now, teamMembers })
  assert.equal(rescue.reply_mode, 'execute')
  const commands = rescue.actions.map(secretaryActionToCommand)
  assert.equal(commands.length, 2)
  assert.equal(commands[0].assignee_name, null) // "mim" nunca é um nome real — o worker resolve para o próprio remetente
  assert.equal(commands[1].assignee_name, 'Julia')
  for (const command of commands) {
    assert.equal(command.title, 'Roove')
    assert.equal(command.due_date, '2026-10-01')
    assert.equal(command.due_time, '10:00')
  }
})
test('"pros dois" e outras formas sem os dois nomes explícitos e inequívocos não acionam o parser (nunca adivinha quem são "os dois")', () => {
  assert.equal(parseMultiAssigneeTask('marca reunião hoje às 16h chamada Sync pros dois', now), null)
})

// ===================================================================================================
// UNKNOWN MEMBER SAFETY + NO PARTIAL CREATION
// ===================================================================================================
test('nome desconhecido nunca cria nada — pede confirmação em vez da recusa genérica', () => {
  const rescue = safeSecretaryWriteRescue('marca reunião hoje às 16h chamada Alinhamento para Fulano e Julia', { now, teamMembers })
  assert.equal(rescue.reply_mode, 'clarify')
  assert.equal(rescue.actions.length, 0)
  assert.match(rescue.message, /Fulano/)
})
test('dois apelidos que resolvem para a MESMA pessoa nunca duplicam a tarefa — pedem confirmação', () => {
  const sameMember = [{ id: 'kleber', name: 'Kleber Willians', active: true }, { id: 'julia', name: 'Julia', active: true }]
  const rescue = safeSecretaryWriteRescue('marca reunião hoje às 16h chamada Sync para Kleber e Willians', { now, teamMembers: sameMember })
  assert.equal(rescue.reply_mode, 'clarify')
  assert.equal(rescue.actions.length, 0)
})
test('literalmente o mesmo nome duas vezes ("para Kleber e Kleber") nunca gera 2 ações para a mesma pessoa', () => {
  assert.equal(parseMultiAssigneeTask('marca reunião hoje às 16h chamada Duplicada para Kleber e Kleber', now), null)
})
test('"para mim e mim" nunca duplica o próprio remetente', () => {
  assert.equal(parseMultiAssigneeTask('marca reunião hoje às 16h chamada Sync para mim e mim', now), null)
})

// ===================================================================================================
// TENANT SAFETY — resolução só enxerga os membros passados pelo chamador (já filtrados por organização + ativos)
// ===================================================================================================
test('membro de outra organização (fora da lista fornecida) nunca resolve — pede confirmação, nunca adivinha', () => {
  const onlyKleberInOrg = [{ id: 'kleber', name: 'Kleber', active: true }]
  const rescue = safeSecretaryWriteRescue('marca reunião hoje às 16h chamada Sync para Kleber e Julia', { now, teamMembers: onlyKleberInOrg })
  assert.equal(rescue.reply_mode, 'clarify')
  assert.equal(rescue.actions.length, 0)
})
test('write rescue nunca aceita organization_id/team_member_id/assigned_to nas ações geradas', () => {
  const rescue = safeSecretaryWriteRescue('marca reunião Origami sexta às 14h para Kleber e Julia', { now, teamMembers })
  assert.doesNotMatch(JSON.stringify(rescue), /organization_id|team_member_id|assigned_to|assignee_member_id/)
})

// ===================================================================================================
// REGRESSÃO — não alterar o comportamento de reunião de pessoa única já existente
// ===================================================================================================
test('regressão: "reunião com Fulano amanhã 10h" continua tratando Fulano como PESSOA (título "Reunião com Fulano")', () => {
  const command = parseInternalCommand('reunião com Fulano amanhã 10h', { now })
  assert.equal(command.intent, 'CREATE_TASK')
  assert.equal(command.title, 'Reunião com Fulano')
  assert.equal(command.participant_name, 'Fulano')
  assert.equal(command.task_type, 'meeting')
})
test('regressão: "call com cliente hoje às 15h" continua funcionando', () => {
  const command = parseInternalCommand('call com cliente hoje às 15h', { now })
  assert.equal(command.title, 'Call com cliente')
})
test('regressão: mensagens de escrita de responsável único (Omega/Sigma) não são afetadas pelo novo parser multi-assignee', () => {
  const message = 'cria uma tarefa pra mim revisar Teste Omega hoje às 17h e coloca pra Julia conferir Teste Sigma hoje'
  assert.equal(parseMultiAssigneeTask(message, now), null)
  const rescue = safeSecretaryWriteRescue(message, { now, teamMembers })
  const commands = rescue.actions.map(secretaryActionToCommand)
  assert.equal(commands.length, 2)
  assert.equal(commands[0].assignee_name, null)
  assert.equal(commands[1].assignee_name, 'Julia')
})

console.log('production-hotfix-2026-09-30-multi-assignee-meeting: ok')
