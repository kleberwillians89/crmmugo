import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { parseMultiSelection, selectionActionIntent } from '../supabase/functions/_shared/internalCommandCore.js'

test('respostas reais que travavam o assistente agora selecionam as tarefas', () => {
  // conversa de 02/10 e 22/10: "as duas", "1 e 2", "ambas finalizadas", "todas finalizadas"
  assert.deepEqual(parseMultiSelection('As duas', 2), [1, 2])
  assert.deepEqual(parseMultiSelection('1 e 2', 2), [1, 2])
  assert.deepEqual(parseMultiSelection('Ambas finalizadas', 2), [1, 2])
  assert.deepEqual(parseMultiSelection('As duas, já falei isso 5 vezes, que finalizei as duas', 2), [1, 2])
  assert.deepEqual(parseMultiSelection('Nenhuma, todas finalizadas.', 3), [1, 2, 3])
  assert.deepEqual(parseMultiSelection('1, 2 e 3', 5), [1, 2, 3])
  assert.equal(selectionActionIntent('Ambas finalizadas'), 'COMPLETE_TASK')
  assert.equal(selectionActionIntent('comecei as duas'), 'START_TASK')
})

test('não confunde seleção única nem frases comuns', () => {
  assert.equal(parseMultiSelection('2', 3), null)
  assert.equal(parseMultiSelection('Essa mesmo', 2), null)
  assert.equal(parseMultiSelection('As duas', 3), null) // ambíguo com 3 itens: pergunta
  assert.equal(parseMultiSelection('reunião às 10 e 11 com o cliente da loja', 3), null)
  assert.equal(selectionActionIntent('1 e 2'), null)
})

test('worker usa a seleção múltipla antes do planner e lista com prazo/responsável', () => {
  const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
  assert.match(worker, /\['CONFIRM_FINANCIAL','CANCEL_FINANCIAL','SESSION_SELECTION_MULTI'[^\]]*\]\.includes\(command\.intent\)/)
  assert.match(worker, /command\.intent==='SESSION_SELECTION_MULTI'[\s\S]*applyTaskAction/)
  assert.match(worker, /mine\.length === 1\) return \{ kind: 'one'/)
  assert.match(worker, /hour<12\?'Bom dia':hour<18\?'Boa tarde':'Boa noite'/)
})

test('"conclui todas as minhas tarefas" lista e pede confirmação; "sim" conclui; lista é determinística', () => {
  const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
  assert.match(worker, /command=\{intent:'BULK_COMPLETE_MINE',confidence:1\}/)
  assert.match(worker, /pending_action:'confirm_bulk_complete'/)
  assert.match(worker, /CONFIRM_FINANCIAL'&&event\.session\?\.pending_action==='confirm_bulk_complete'[\s\S]*SESSION_SELECTION_MULTI/)
  assert.match(worker, /'SESSION_SELECTION_MULTI','BULK_COMPLETE_MINE','LIST_MINE'(?:,'ACK_CONVERSATION')?\]\.includes\(command\.intent\)/)
  assert.equal(selectionActionIntent('Pode marcar todas minhas tarefas como finalizadas'), 'COMPLETE_TASK')
})

test('criar tarefa para outra pessoa: parser entende e worker não manda para a IA', async () => {
  const { parseInternalCommand } = await import('../supabase/functions/_shared/internalCommandCore.js')
  const now = new Date('2026-10-22T16:39:00Z')
  const real = parseInternalCommand('Cria uma tarefa pra Julia me enviar o html do e-mail Mkt  amanhã às até 10h', { now })
  assert.deepEqual([real.intent, real.title, real.assignee_name, real.due_date, real.due_time], ['CREATE_TASK', 'me enviar o html do e-mail Mkt', 'Julia', '2026-10-23', '10:00'])
  const article = parseInternalCommand('Cria uma tarefa para a Julia: enviar html amanhã até 10h', { now })
  assert.deepEqual([article.title, article.assignee_name], ['enviar html', 'Julia'])
  assert.equal(parseInternalCommand('Cria tarefa pra mim ligar pro cliente sexta às 15h', { now }).assignee_name, null)
  const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
  assert.match(worker, /command\.intent==='CREATE_TASK'&&clean\(command\.title\)&&command\.due_date/)
  assert.match(worker, /Responda \*sim\* para criar/)
  assert.match(worker, /command.items.map\(\(item:any\)=>\(\{...item,title:tidyTitle\(item.title\)\}\)\)/)
})

test('"Júlia me enviar layout até segunda 17h" vira tarefa da Julia; campos nulos da IA não bloqueiam', async () => {
  const { parseNamedDelegation } = await import('../supabase/functions/_shared/internalCommandCore.js')
  const { canonicalizeSecretaryPlan } = await import('../supabase/functions/_shared/internalSecretaryAgent.js')
  const now = new Date('2026-10-22T17:05:00Z'), names = ['Julia Souza', 'Kleber Willians']
  const task = parseNamedDelegation('Júlia me enviar layout cafifa até segunda as 17hrs', names, now)
  assert.deepEqual([task.title, task.due_date, task.due_time], ['me enviar layout cafifa', '2026-10-26', '17:00'])
  assert.equal(parseNamedDelegation('Julia tudo bem?', names, now), null)
  assert.equal(parseNamedDelegation('Roove precisa do site amanhã', names, now), null)
  const plan = { reply_mode: 'execute', message: null, turn_relation: 'new_request', actions: [{ tool: 'create_task', arguments: { title: 'X', date: '2026-10-26', assignee_name: 'Julia', task_query: null, due_date: null, items: null } }] }
  assert.ok(canonicalizeSecretaryPlan(plan, { operationalContext: { team_members: [] }, authenticatedMember: { id: 'k' } }))
  plan.actions[0].arguments.team_member_id = 'x'
  assert.equal(canonicalizeSecretaryPlan(plan, { operationalContext: { team_members: [] }, authenticatedMember: { id: 'k' } }), null)
})

test('equipe: sessão não é apagada antes da seleção, aviso para quem recebe a tarefa e próximas na lista', () => {
  const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
  assert.match(worker, /'SESSION_SELECTION','SESSION_SELECTION_MULTI','BULK_COMPLETE_MINE',(?:'ACK_CONVERSATION',)?'GREETING'/)
  assert.match(worker, /kind: 'task_assigned'/)
  assert.match(worker, /Próximos dias:/)
  assert.match(worker, /feito\|feita\|pronto/)
  const notifier = fs.readFileSync('supabase/functions/team-notification-worker/index.ts', 'utf8')
  assert.match(notifier, /p\.kind === 'task_assigned'/)
})

test('tarefa própria sem "cria": verbo + data vira tarefa; alertas velhos e reações não vão para o time', async () => {
  const { parseSelfTask } = await import('../supabase/functions/_shared/internalCommandCore.js')
  const now = new Date('2026-10-22T19:28:00Z')
  const own = parseSelfTask('Fazer post Mugô até sexta às 16hrs', now)
  assert.deepEqual([own.title, own.due_date, own.due_time, own.assignee_name], ['Fazer post Mugô', '2026-10-23', '16:00', null])
  assert.equal(parseSelfTask('finalizar site amanhã', now), null)
  assert.equal(parseSelfTask('fazer o que hoje?', now), null)
  const notifier = fs.readFileSync('supabase/functions/team-notification-worker/index.ts', 'utf8')
  assert.match(notifier, /EXPIRED_STALE/)
  assert.doesNotMatch(notifier, /Atualização da Mugô/)
  const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8')
  assert.match(webhook, /\['reaction','unsupported','sticker','system','unknown'\]\.includes\(content\.type\)/)
})

test('"já atendi" para os lembretes do atendimento e tarefa funciona depois de um aviso', () => {
  const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
  assert.match(worker, /intent:'ACK_CONVERSATION'/)
  assert.match(worker, /event_type:'handoff_acknowledged'/)
  assert.match(worker, /\['select_item','select_task'\]\.includes\(event\.session\?\.pending_action\)/)
  const notifier = fs.readFileSync('supabase/functions/team-notification-worker/index.ts', 'utf8')
  assert.match(notifier, /\['handoff_acknowledged','take_conversation'\]/)
})
