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
  assert.match(worker, /'SESSION_SELECTION_MULTI','BULK_COMPLETE_MINE','LIST_MINE'\]\.includes\(command\.intent\)/)
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
})
