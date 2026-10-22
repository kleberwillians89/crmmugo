import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parseInternalCommand } from '../supabase/functions/_shared/internalCommandCore.js'
import { canonicalizeSecretaryPlan, enrichSecretaryPlan, safeSecretaryReadRescue, safeUndoLastCompletionRescue, secretaryActionToCommand, validateSecretaryPlan } from '../supabase/functions/_shared/internalSecretaryAgent.js'

const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
const localDate = '2026-09-30'
const kleber = { id: 'kleber', name: 'Kleber', organization_id: 'mugo' }
const teamMembers = [{ id: 'kleber', name: 'Kleber' }, { id: 'julia', name: 'Julia' }]

function plan(message, rawPlan, operationalContext) {
  const canonical = canonicalizeSecretaryPlan(rawPlan, { operationalContext: { team_members: teamMembers }, authenticatedMember: kleber })
  if (!canonical) return { rejected: 'canonicalization' }
  const enriched = enrichSecretaryPlan(canonical, { message, localDate, operationalContext })
  if (enriched.reply_mode === 'clarify') return { clarify: enriched.message }
  const validated = validateSecretaryPlan(enriched)
  if (!validated) return { rejected: 'validation' }
  return { commands: validated.actions.map(secretaryActionToCommand) }
}

// ===================================================================================================
// BLOCO 8 — vocabulário financeiro/cobrança natural (parser determinístico, funciona mesmo sem IA)
// ===================================================================================================
test('BLOCO 8: "registra 300 reais de Canva" / "coloca 300 de Canva como despesa" viram FINANCIAL_EXPENSE_REQUEST', () => {
  for (const phrase of ['registra 300 reais de Canva', 'coloca 300 de Canva como despesa', 'gastei 300 com Canva', 'paguei 300 de Canva']) {
    const command = parseInternalCommand(phrase)
    assert.equal(command.intent, 'FINANCIAL_EXPENSE_REQUEST', phrase)
    assert.equal(command.amount, 300, phrase)
  }
})
test('BLOCO 8: "cobra a Roove" (imperativo) e variações de pedir cobrança viram COLLECTION_SEND', () => {
  for (const phrase of ['cobra a Roove', 'cobrar a Roove', 'manda cobrança pra Roove', 'lembra a Roove do pagamento']) {
    const command = parseInternalCommand(phrase)
    assert.equal(command.intent, 'COLLECTION_SEND', phrase)
    assert.equal(command.subject_query, 'Roove', phrase)
  }
})
test('BLOCO 8: regressão — "cobrei"/"me lembre de cobrar" continuam com a intenção original (nunca viram COLLECTION_SEND por engano)', () => {
  assert.equal(parseInternalCommand('cobrei a Roove').intent, 'COLLECTION_ACTIVITY')
  assert.equal(parseInternalCommand('me lembre de cobrar a Roove amanhã').intent, 'FOLLOW_UP')
})
test('BLOCO 8: claim != payment — "o cliente disse que já pagou" nunca marca pago automaticamente (falta valor)', () => {
  const command = parseInternalCommand('o cliente disse que já pagou')
  assert.equal(command.intent, 'FINANCIAL_RECEIPT_REQUEST')
  assert.equal(command.amount, null)
  // execute() exige valor válido antes de qualquer coisa — sem isso, nunca chega perto de confirmar.
  assert.match(worker, /if\(!Number\.isFinite\(command\.amount\)\|\|command\.amount<=0\)return 'Não identifiquei um valor válido para confirmar\.'/)
})
test('BLOCO 8: "marca como pago" nunca deve poder pular a confirmação explícita — não existe tool que faça isso', () => {
  const secretary = fs.readFileSync('supabase/functions/_shared/internalSecretaryAgent.js', 'utf8')
  assert.doesNotMatch(secretary, /'mark_paid'|'confirm_payment'|'set_paid'/)
  // register_receipt (o único caminho que credita um recebimento) sempre exige amount positivo.
  assert.match(secretary, /if \(\['register_expense', 'register_receipt'\]\.includes\(tool\) && !isPositiveNumber\(args\.amount\)\) return false/)
})

// ===================================================================================================
// BLOCO 9 — referência a tarefa de outro membro ("e a da Julia deixa amanhã")
// ===================================================================================================
test('BLOCO 9: "a da Julia" resolve contra a tarefa da Julia recém-criada nesta conversa (nunca contra my_tasks do remetente)', () => {
  const opCtx = {
    team_members: teamMembers,
    my_tasks: [{ id: 't-cafifa', title: 'Cafifa pra mim', status: 'pending' }],
    recent_plan_tasks: [{ title: 'Origami pra Julia', assignee_name: 'Julia', status: 'pending' }],
  }
  const result = plan('e a da Julia deixa amanhã', {
    reply_mode: 'execute', turn_relation: 'correct_plan',
    actions: [{ tool: 'update_task', arguments: { task_query: 'a da Julia', due_date: '2026-10-01' } }],
  }, opCtx)
  assert.equal(result.commands?.[0]?.intent, 'MOVE_TASK')
  assert.equal(result.commands?.[0]?.task_query, 'Origami pra Julia')
})
test('BLOCO 9: 2 tarefas possíveis da Julia => pergunta, nunca adivinha', () => {
  const opCtx = {
    team_members: teamMembers,
    my_tasks: [],
    recent_plan_tasks: [{ title: 'Origami pra Julia', assignee_name: 'Julia', status: 'pending' }, { title: 'Contrato da Julia', assignee_name: 'Julia', status: 'pending' }],
  }
  const result = plan('a da Julia', { reply_mode: 'execute', turn_relation: 'correct_plan', actions: [{ tool: 'complete_task', arguments: { task_query: 'a da Julia' } }] }, opCtx)
  assert.match(result.clarify, /Encontrei mais de uma tarefa/)
})
test('BLOCO 9: regressão — sem menção a outro membro, a resolução continua usando my_tasks do remetente (Roove)', () => {
  const opCtx = { team_members: teamMembers, my_tasks: [{ id: 't-roove', title: 'Revisar a campanha da Roove', status: 'pending' }], recent_plan_tasks: [] }
  const result = plan('muda a Roove pra amanhã', { reply_mode: 'execute', turn_relation: 'correct_plan', actions: [{ tool: 'update_task', arguments: { task_query: 'Roove', due_date: '2026-10-01' } }] }, opCtx)
  assert.equal(result.commands?.[0]?.task_query, 'Revisar a campanha da Roove')
})
test('BLOCO 9: nunca cruza organização — resolveMember só considera team_members já filtrados pela organização autenticada do evento', () => {
  assert.match(worker, /admin\.from\('team_members'\)\.select\('id,name'\)\.eq\('organization_id',event\.organization_id\)\.eq\('active',true\)/)
  assert.match(worker, /operationalContext:\{my_tasks:memberModel\.candidateItems,team_members:\(team\.data\|\|\[\]\)\.map\(\(item:any\)=>\(\{id:item\.id,name:item\.name\}\)\),recent_plan_tasks:recentPlanTasks\}/)
})

// ===================================================================================================
// BLOCO 10 — "qual foi mesmo o que pedi pra Julia?": usa estado atual real, nunca inventa histórico
// ===================================================================================================
test('BLOCO 10: "qual foi mesmo o que pedi pra Julia?" resolve para list_team_tasks (estado atual real, não invenção)', () => {
  const rescue = safeSecretaryReadRescue('qual foi mesmo o que pedi pra Julia?', { localDate, teamMembers })
  assert.equal(rescue.actions[0].tool, 'list_team_tasks')
  assert.equal(rescue.actions[0].arguments.assignee_name, 'Julia')
})

// ===================================================================================================
// BLOCO 11 — cancelamento natural de uma conclusão recente ("termina a Roove" -> "não, pera, não termina não")
// ===================================================================================================
test('BLOCO 11: negar uma conclusão recente reabre a MESMA tarefa (nunca finge rollback, nunca adivinha outra)', () => {
  const recentCompletedTasks = [{ entity_id: 'a0ce7df3-a9bd-458f-83cf-f6b0a8b9271c' }]
  const rescue = safeUndoLastCompletionRescue('não, pera, não termina não', { recentCompletedTasks })
  assert.equal(rescue.actions[0].tool, 'update_task')
  assert.equal(rescue.actions[0].arguments.task_short_id, 'a0ce7d')
  assert.equal(rescue.actions[0].arguments.status, 'pending')
  const command = secretaryActionToCommand(rescue.actions[0])
  assert.equal(command.intent, 'UPDATE_TASK_STATUS')
  assert.equal(command.task_status, 'pending')
})
test('BLOCO 11: sem nenhuma conclusão recente nesta conversa, não inventa nada para desfazer', () => {
  assert.equal(safeUndoLastCompletionRescue('não, pera, não termina não', { recentCompletedTasks: [] }), null)
})
test('BLOCO 11: mensagem não relacionada nunca aciona o rescue de cancelamento', () => {
  assert.equal(safeUndoLastCompletionRescue('bom dia', { recentCompletedTasks: [{ entity_id: 'a0ce7df3-a9bd-458f-83cf-f6b0a8b9271c' }] }), null)
})
test('BLOCO 11: o worker prioriza o undo determinístico ANTES de tentar o planner (ação sensível, não depende de LLM disponível)', () => {
  const undoIdx = worker.indexOf('const undoCompletionProbe=safeUndoLastCompletionRescue(event.raw_text,{recentCompletedTasks})')
  const branchIdx = worker.indexOf('if(!deterministicShortcut&&undoCompletionProbe){')
  const plannerCallIdx = worker.indexOf('secretaryPlan=await planInternalSecretaryMessage(')
  assert.ok(undoIdx > -1 && branchIdx > -1 && plannerCallIdx > -1 && undoIdx < branchIdx && branchIdx < plannerCallIdx)
})

console.log('internal-secretary-corrections: ok')
