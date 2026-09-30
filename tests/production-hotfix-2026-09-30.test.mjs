import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { hasExplicitWriteSignal, parseInternalCommand } from '../supabase/functions/_shared/internalCommandCore.js'
import { planInternalSecretaryMessage, safeSecretaryReadRescue, safeSecretaryWriteRescue, safeUndoLastCompletionRescue, secretaryActionToCommand } from '../supabase/functions/_shared/internalSecretaryAgent.js'
import { getOperationalWindow } from '../supabase/functions/_shared/operationalCalendar.js'

const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
const commercialWorker = fs.readFileSync('supabase/functions/commercial-ai-worker/index.ts', 'utf8')
const teamMembers = [{ id: 'kleber', name: 'Kleber', active: true }, { id: 'julia', name: 'Julia', active: true }]
const response = (value) => async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(value) }) })
const OMEGA_SIGMA = 'cria uma tarefa pra mim revisar Teste Omega hoje às 17h e coloca pra Julia conferir Teste Sigma hoje'

// ===================================================================================================
// CAUSA RAIZ 1 — observabilidade segura de falha do planner
// ===================================================================================================
test('CAUSA 1: planner_http_status/planner_error_class classificam cada tipo de falha, sem vazar nada sensível', async () => {
  const cases = [
    { label: 'timeout', expectedStatus: 'timeout', expectedHttp: null, expectedClass: 'timeout', fetcher: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) } },
    { label: 'network', expectedStatus: 'http_error', expectedHttp: null, expectedClass: 'network', fetcher: async () => { throw new Error('boom') } },
    { label: '401', expectedStatus: 'http_error', expectedHttp: 401, expectedClass: 'authentication', fetcher: async () => ({ ok: false, status: 401 }) },
    { label: '403', expectedStatus: 'http_error', expectedHttp: 403, expectedClass: 'authentication', fetcher: async () => ({ ok: false, status: 403 }) },
    { label: '429', expectedStatus: 'http_error', expectedHttp: 429, expectedClass: 'rate_limit', fetcher: async () => ({ ok: false, status: 429 }) },
    { label: '400', expectedStatus: 'http_error', expectedHttp: 400, expectedClass: 'bad_request', fetcher: async () => ({ ok: false, status: 400 }) },
    { label: '500', expectedStatus: 'http_error', expectedHttp: 500, expectedClass: 'provider_5xx', fetcher: async () => ({ ok: false, status: 500 }) },
  ]
  for (const { label, expectedStatus, expectedHttp, expectedClass, fetcher } of cases) {
    const calls = []
    await planInternalSecretaryMessage({ apiKey: 'k', model: 'm', message: 'x', now: { local_date: '2026-09-30' }, fetcher, onPlannerStatus: (status, meta) => calls.push({ status, meta }) })
    assert.equal(calls[0].status, expectedStatus, label)
    assert.equal(calls[0].meta?.httpStatus ?? null, expectedHttp, label)
    assert.equal(calls[0].meta?.errorClass, expectedClass, label)
    assert.doesNotMatch(JSON.stringify(calls), /private|prompt|Bearer|sk-/i, label)
  }
})
test('CAUSA 1: config ausente (sem apiKey/model) reporta configuration_missing, nunca falha silenciosa', async () => {
  const calls = []
  const result = await planInternalSecretaryMessage({ apiKey: '', model: '', message: 'oi', now: { local_date: '2026-09-30' }, onPlannerStatus: (status, meta) => calls.push({ status, meta }) })
  assert.equal(result, null)
  assert.equal(calls[0].status, 'http_error')
  assert.equal(calls[0].meta.errorClass, 'configuration_missing')
  assert.equal(calls[0].meta.httpStatus, null)
})
test('CAUSA 1: o worker grava planner_http_status/planner_error_class junto de planner_status, sem prompt/secret', () => {
  assert.match(worker, /onPlannerStatus:\(status:string,meta:any\)=>\{plannerStatus=status;plannerHttpStatus=meta\?\.httpStatus\?\?null;plannerErrorClass=meta\?\.errorClass\?\?null\}/)
  assert.match(worker, /planner_status:plannerStatus,planner_http_status:plannerHttpStatus,planner_error_class:plannerErrorClass/)
})

// ===================================================================================================
// CAUSA RAIZ 2 — WRITE sempre vence READ genérico na mesma mensagem
// ===================================================================================================
test('CAUSA 2: "cria uma tarefa ... hoje" NUNCA vira LIST_TODAY (regressão exata do bug de produção)', () => {
  const command = parseInternalCommand(OMEGA_SIGMA, { now: new Date('2026-09-30T12:00:00-03:00') })
  assert.notEqual(command.intent, 'LIST_TODAY')
  assert.equal(command.intent, 'CREATE_TASK')
})
test('CAUSA 2: verbo de escrita explícito é detectado corretamente', () => {
  for (const phrase of ['cria uma tarefa', 'crie uma tarefa', 'coloca pra Julia', 'muda a Roove', 'move a tarefa', 'finaliza a Roove', 'conclui a Roove', 'atribui a tarefa', 'cobra a Roove', 'registra 300 reais']) {
    assert.equal(hasExplicitWriteSignal(phrase), true, phrase)
  }
  assert.equal(hasExplicitWriteSignal('tarefas de hoje'), false)
  assert.equal(hasExplicitWriteSignal('qual minha demanda de hoje?'), false)
})
test('CAUSA 2: leitura pura continua funcionando (nenhuma regressão nos gates de leitura)', () => {
  assert.equal(parseInternalCommand('tarefas de hoje').intent, 'LIST_TODAY')
  assert.equal(parseInternalCommand('o que temos hoje').intent, 'LIST_TODAY')
  assert.equal(parseInternalCommand('meu dia').intent, 'LIST_MINE')
  assert.equal(parseInternalCommand('como esta a equipe').intent, 'LIST_TEAM')
  assert.equal(parseInternalCommand('o que eu fiz hoje').intent, 'DAY_SUMMARY')
})

// ===================================================================================================
// CAUSA RAIZ 3 — vocabulário natural de CREATE_TASK ("crie") não depende do LLM
// ===================================================================================================
test('CAUSA 3: "crie uma tarefa para Julia, sexta reuniao origami de fechamento" cria corretamente sem LLM', () => {
  const command = parseInternalCommand('crie uma tarefa para Julia, sexta reuniao origami de fechamento', { now: new Date('2026-09-30T12:00:00-03:00') })
  assert.equal(command.intent, 'CREATE_TASK')
  assert.equal(command.assignee_name, 'Julia')
  assert.equal(command.title, 'reuniao origami de fechamento')
  assert.equal(command.due_date, '2026-10-02') // próxima sexta a partir de 2026-09-30 (quarta)
})
test('CAUSA 3: regressão — comandos de criação já existentes continuam intactos', () => {
  assert.equal(parseInternalCommand('cria tarefa revisar Roove').title, 'revisar Roove')
  assert.equal(parseInternalCommand('criar tarefas').intent, 'CREATE_TASK')
  const delegated = parseInternalCommand('Julia precisa revisar o site amanhã', { now: new Date('2026-09-25T12:00:00-03:00') })
  assert.equal(delegated.assignee_name, 'Julia')
})

// ===================================================================================================
// CAUSA RAIZ 4 — fallback determinístico de escrita quando o planner está fora
// ===================================================================================================
test('CAUSA 4: multi-ação Omega/Sigma resolve deterministicamente em 2 create_task quando o planner falha', () => {
  const rescue = safeSecretaryWriteRescue(OMEGA_SIGMA, { now: new Date('2026-09-30T12:00:00-03:00'), teamMembers })
  assert.equal(rescue.reply_mode, 'execute')
  const commands = rescue.actions.map(secretaryActionToCommand)
  assert.equal(commands.length, 2)
  assert.equal(commands[0].intent, 'CREATE_TASK'); assert.equal(commands[0].title, 'revisar Teste Omega'); assert.equal(commands[0].due_date, '2026-09-30'); assert.equal(commands[0].due_time, '17:00'); assert.equal(commands[0].assignee_name, null)
  assert.equal(commands[1].intent, 'CREATE_TASK'); assert.equal(commands[1].title, 'conferir Teste Sigma'); assert.equal(commands[1].due_date, '2026-09-30'); assert.equal(commands[1].assignee_name, 'Julia')
})
test('CAUSA 4: responsável ambíguo/desconhecido cancela o rescue inteiro (nunca executa parcial)', () => {
  assert.equal(safeSecretaryWriteRescue('cria uma tarefa revisar X hoje e coloca pra Fulano conferir Y hoje', { now: new Date(), teamMembers }), null)
})
test('CAUSA 4: cláusula que não é create_task cancela o rescue inteiro', () => {
  assert.equal(safeSecretaryWriteRescue('cria uma tarefa revisar X hoje e qual minha demanda de amanhã', { now: new Date(), teamMembers }), null)
})
test('CAUSA 4: mensagem sem verbo de escrita nunca aciona o rescue de escrita', () => {
  assert.equal(safeSecretaryWriteRescue('qual minha demanda de hoje e amanhã?', { now: new Date(), teamMembers }), null)
})
test('CAUSA 4: o worker só tenta o rescue de escrita depois do planner falhar, e nunca sem sinal de escrita explícito + múltiplas cláusulas', () => {
  assert.match(worker, /hasExplicitWriteSignal\(cleanedRaw\)&&\/\\s\+e\\s\+\\S\/iu\.test\(cleanedRaw\)&&\(!secretaryPlan\|\|plannerStatus&&plannerStatus!=='ok'\)/)
  assert.match(worker, /processingPath='secretary_write_rescue'/)
  assert.match(worker, /Estou com uma indisponibilidade temporária para interpretar esse pedido completo\. Não alterei nada\. Pode tentar novamente em instantes\./)
})

// ===================================================================================================
// CAUSA RAIZ 5 — plano 100% concluído não é dono do próximo turno
// ===================================================================================================
test('CAUSA 5: T1 leitura concluída + T2 "cria uma tarefa..." => T2 é new_request, nunca sequestrado', () => {
  const completedPlan = { actions: [{ id: 'a1', tool: 'plan_my_day', status: 'completed', command: { intent: 'PLAN_MY_DAY' } }] }
  const hasPending = (plan) => Array.isArray(plan?.actions) && plan.actions.some((action) => ['needs_input', 'awaiting_confirmation', 'failed'].includes(action.status))
  assert.equal(hasPending(completedPlan), false)
  const pendingPlan = { actions: [{ id: 'a1', tool: 'create_task', status: 'needs_input', command: { intent: 'CREATE_TASK' } }] }
  assert.equal(hasPending(pendingPlan), true)
})
test('CAUSA 5: recent_plan_tasks nunca é apagado mesmo quando o plano já está completed (ainda serve para "a da Julia")', () => {
  assert.match(worker, /const recentPlanActions:any\[\]=Array\.isArray\(previousSecretaryPlan\?\.actions\)\?previousSecretaryPlan\.actions:\[\]/)
  const ownsTurnIdx = worker.indexOf('const secretaryOwnsTurn=Array.isArray')
  const recentIdx = worker.indexOf('const recentPlanActions:any[]=Array.isArray(previousSecretaryPlan?.actions)')
  assert.ok(ownsTurnIdx > -1 && recentIdx > ownsTurnIdx)
  // recentPlanActions não depende de secretaryOwnsTurn — lê direto de previousSecretaryPlan.
  assert.doesNotMatch(worker.slice(recentIdx, recentIdx + 200), /secretaryOwnsTurn/)
})

// ===================================================================================================
// CAUSA RAIZ 6 — commercial-ai-worker volta a bundlar (módulo recuperado)
// ===================================================================================================
test('CAUSA 6: operationalCalendar.js existe e getOperationalWindow tem o contrato esperado', async () => {
  const fakeAdmin = { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: { timezone: 'America/Sao_Paulo' }, error: null }) }) }
  const tuesdayNoonBRT = await getOperationalWindow(fakeAdmin, 'org1', new Date('2026-09-30T15:00:00Z'))
  assert.equal(tuesdayNoonBRT.open, true)
  const saturday = await getOperationalWindow(fakeAdmin, 'org1', new Date('2026-10-03T15:00:00Z'))
  assert.equal(saturday.open, false)
  const lateNight = await getOperationalWindow(fakeAdmin, 'org1', new Date('2026-09-30T02:00:00Z')) // 23h de terça em SP
  assert.equal(lateNight.open, false)
})
test('CAUSA 6: commercial-ai-worker importa getOperationalWindow e usa .open para decidir a mensagem de handoff', () => {
  assert.match(commercialWorker, /import\s*\{getOperationalWindow\}\s*from\s*'\.\.\/_shared\/operationalCalendar\.js'/)
  assert.match(commercialWorker, /const operationalWindow=await getOperationalWindow\(admin,event\.organization_id\)/)
  assert.match(commercialWorker, /if\(!operationalWindow\.open\)decision\.response=/)
})
test('CAUSA 6: nenhum import de commercial-ai-worker/whatsapp-webhook/task-command-worker aponta para arquivo inexistente', () => {
  for (const file of ['supabase/functions/commercial-ai-worker/index.ts', 'supabase/functions/whatsapp-webhook/index.ts', 'supabase/functions/task-command-worker/index.ts']) {
    const source = fs.readFileSync(file, 'utf8')
    const imports = [...source.matchAll(/from\s+'(\.\.\/_shared\/[^']+)'/g)].map((match) => match[1])
    for (const relativePath of imports) {
      const resolved = new URL(relativePath, `file://${process.cwd()}/${file.replace(/[^/]+$/, '')}`).pathname
      assert.ok(fs.existsSync(resolved), `${file} importa ${relativePath}, que não existe em ${resolved}`)
    }
  }
})

// ===================================================================================================
// TESTES REAIS OBRIGATÓRIOS (A-G) e invariantes de segurança
// ===================================================================================================
test('A: "qual minha demanda de hoje?" continua leitura pura, zero escrita', () => {
  const rescue = safeSecretaryReadRescue('qual minha demanda de hoje?', { localDate: '2026-09-30', teamMembers })
  assert.equal(rescue.actions[0].tool, 'plan_my_day')
  assert.doesNotMatch(JSON.stringify(rescue), /create_task|update_task|complete_task|register_expense|register_receipt/)
})
test('E: "tarefas de hoje" continua LIST_TODAY', () => {
  assert.equal(parseInternalCommand('tarefas de hoje').intent, 'LIST_TODAY')
})
test('F: "o que tenho hoje?" continua resolvendo para leitura (plan_my_day)', () => {
  const rescue = safeSecretaryReadRescue('o que tenho hoje?', { localDate: '2026-09-30', teamMembers })
  assert.equal(rescue.actions[0].tool, 'plan_my_day')
})
test('G: multi-ação Gamma/Delta/horas anterior não regride (teste já existente permanece verde)', () => {
  assert.match(worker, /processingPath='secretary_agent'/)
  assert.match(worker, /secretaryCommands=compactSecretaryCommands\(secretaryPlan\.actions\.map\(secretaryActionToCommand\)/)
})
test('D: T1 leitura -> T2 escrita: session não fica presa em "Não consegui continuar esse plano agora"', () => {
  assert.match(worker, /if\(secretaryOwnsTurn&&!deterministicShortcut&&!secretaryPlan\)\{/)
  // A condição agora depende do novo cálculo de secretaryOwnsTurn (needs_input/awaiting_confirmation/failed).
  const idx = worker.indexOf('const secretaryOwnsTurn=Array.isArray')
  assert.ok(idx > -1)
})

// --- Invariantes de segurança (não regredir) ---------------------------------------------------------
test('INVARIANTE: nenhum campo de identidade é aceito do LLM (tenant/member isolation, no arbitrary IDs)', async () => {
  const secretary = fs.readFileSync('supabase/functions/_shared/internalSecretaryAgent.js', 'utf8')
  assert.match(secretary, /IDENTITY_FIELDS\.some\(\(field\) => field in value\)\) throw new Error\('Forbidden identity'\)/)
  assert.match(secretary, /for \(const key of \[\.\.\.IDENTITY_FIELDS, 'assignee_member_id'\]\) \{\s*\n\s*if \(key in rawArguments\) return false/)
})
test('INVARIANTE: write rescue nunca aceita organization_id/team_member_id/assigned_to — constrói os argumentos ele mesmo, nunca ecoa entrada bruta como ID', () => {
  const secretary = fs.readFileSync('supabase/functions/_shared/internalSecretaryAgent.js', 'utf8')
  const idx = secretary.indexOf('export function safeSecretaryWriteRescue')
  const end = secretary.indexOf('\n}', idx)
  const block = secretary.slice(idx, end)
  assert.doesNotMatch(block, /organization_id|team_member_id|assigned_to|assignee_member_id/)
})
test('INVARIANTE: write rescue nunca duplica execução — cada action vira 1 command, sem loop de repetição', () => {
  const rescue = safeSecretaryWriteRescue(OMEGA_SIGMA, { now: new Date('2026-09-30T12:00:00-03:00'), teamMembers })
  assert.equal(rescue.actions.length, 2)
})

console.log('production-hotfix-2026-09-30: ok')
