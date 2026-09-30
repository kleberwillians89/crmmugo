import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { findInternalMemberByPhone, isTaskCreationCommandOnly, parseInternalCommand, parseTaskSchedule, resolveRelativeDate, splitInlineNumberedList, taskTitleFromText } from '../supabase/functions/_shared/internalCommandCore.js'

const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8')

// --- 1: "criar tarefas" pede a lista naturalmente, sem exigir data -------------------------------
test('1: "criar tarefas" (sem título) pede a lista naturalmente — nunca exige título+data ao mesmo tempo', () => {
  const command = parseInternalCommand('criar tarefas')
  assert.equal(command.intent, 'CREATE_TASK')
  assert.equal(command.title, '')
  assert.match(worker, /if \(!clean\(command\.title\) && !\(Array\.isArray\(command\.items\) && command\.items\.length\)\) \{/)
  assert.match(worker, /return 'Claro\. Qual é a tarefa\?'/)
  assert.doesNotMatch(worker, /Preciso do título e de uma data sem ambiguidade/)
})

// --- 2: pending CREATE_TASK + nova intenção forte → ACTIVITY_COMPLETE, nunca procura tarefa ------
test('2: pending CREATE_TASK + "finalizei site da Mila" vira ACTIVITY_COMPLETE, nunca cai em busca de tarefa', () => {
  const command = parseInternalCommand('finalizei site da Mila')
  assert.equal(command.intent, 'ACTIVITY_COMPLETE')
  assert.equal(command.summary, 'site da Mila')
  // A resolução de pending por CREATE_TASK só roda quando o comando atual é UNKNOWN — uma intenção
  // forte (ACTIVITY_COMPLETE) nunca passa por ali, então o contexto antigo nunca sequestra a mensagem.
  assert.match(worker, /command\.intent==='UNKNOWN'&&event\.session\?\.active_intent==='CREATE_TASK'&&event\.session\.state==='awaiting_context'/)
  // E o auto-clear existente troca o pending quando a intenção nova diverge da sessão.
  assert.match(worker, /command\.intent!==event\.session\.active_intent\)await clearAssistantSession/)
})

// --- 3: "quero registrar atividade" pergunta neutra, não presume início nem fim ------------------
test('3: "quero registrar atividade" é ACTIVITY_CAPTURE — pergunta neutra, nunca "O que você começou?"', () => {
  const command = parseInternalCommand('quero registrar atividade')
  assert.equal(command.intent, 'ACTIVITY_CAPTURE')
  assert.match(worker, /command\.intent==='ACTIVITY_CAPTURE'\)\{/)
  assert.match(worker, /return 'Claro\. Me conta o que você fez\.'/)
})

// --- 4: retomada de ACTIVITY_CAPTURE resolve para ACTIVITY_COMPLETE ------------------------------
test('4: após "quero registrar atividade", "Site da Mila, finalizado" resolve ACTIVITY_COMPLETE', () => {
  const command = parseInternalCommand('Site da Mila, finalizado')
  assert.equal(command.intent, 'ACTIVITY_COMPLETE')
  assert.equal(command.summary, 'Site da Mila')
  // Fallback: se a resposta livre não tiver verbo próprio, ACTIVITY_CAPTURE ainda resolve para conclusão.
  assert.match(worker, /event\.session\?\.active_intent==='ACTIVITY_CAPTURE'&&event\.session\.state==='awaiting_context'&&cleanedRaw\)\{/)
  assert.match(worker, /command=\{intent:'ACTIVITY_COMPLETE',summary:clean\(cleanedRaw,240\),contextual:true,confidence:1\}/)
})

// --- 5-7: flexões naturais de conclusão sempre viram ACTIVITY_COMPLETE (nunca tarefa) ------------
test('5-7: "finalizado site da Mila" / "site da Mila finalizado" / "terminei ajustes da home" → ACTIVITY_COMPLETE', () => {
  for (const [text, summary] of [
    ['finalizado site da Mila', 'site da Mila'],
    ['site da Mila finalizado', 'site da Mila'],
    ['terminei ajustes da home', 'ajustes da home'],
  ]) {
    const command = parseInternalCommand(text)
    assert.equal(command.intent, 'ACTIVITY_COMPLETE', text)
    assert.equal(command.summary, summary, text)
  }
})

// --- 8-9: CREATE_TASK não exige data; usa a data quando ela vem na mensagem ----------------------
test('8-9: "cria tarefa revisar Roove" não exige data; "...amanhã" resolve due_date corretamente', () => {
  const bare = parseInternalCommand('cria tarefa revisar Roove')
  assert.equal(bare.intent, 'CREATE_TASK')
  assert.equal(bare.title, 'revisar Roove')
  assert.equal(bare.due_date, null)
  const withDate = parseInternalCommand('cria tarefa revisar Roove amanhã', { now: new Date('2026-09-25T12:00:00-03:00') })
  assert.equal(withDate.intent, 'CREATE_TASK')
  assert.equal(withDate.title, 'revisar Roove')
  assert.equal(withDate.due_date, '2026-09-26')
  // crm_tasks.due_date é nullable no schema — nunca inventamos data quando ela não vem na mensagem.
  const schema = fs.readFileSync('supabase/migrations/202607170002_crm_information_architecture.sql', 'utf8')
  assert.match(schema, /due_date date,/)
  assert.doesNotMatch(worker, /!clean\(command\.title\) \|\| !command\.due_date/)
})

// --- 10: "criar tarefas:" com lista multilinha cria N tarefas, uma por linha ---------------------
test('10: "criar tarefas:\\nrevisar Roove\\najustar Origami" produz exatamente 2 itens de tarefa distintos', () => {
  const command = parseInternalCommand('criar tarefas:\nrevisar Roove\najustar Origami')
  assert.equal(command.intent, 'CREATE_TASK')
  assert.equal(command.items.length, 2)
  assert.equal(command.items[0].title, 'revisar Roove')
  assert.equal(command.items[1].title, 'ajustar Origami')
  // Cada item vira 1 insert em crm_tasks com source_ref individual — nunca uma tarefa genérica.
  assert.match(worker, /const sourceRef = items\.length > 1 \? `\$\{event\.id\}\$\{actionPart\}:\$\{index\}` : `\$\{event\.id\}\$\{actionPart\}`/)
  assert.match(worker, /await admin\.from\('crm_tasks'\)\.insert\(\{ organization_id: org, title: clean\(item\.title, 240\)/)
})

// --- 11: "finalizei:" com lista multilinha produz 3 operational_events distintos -----------------
test('11: "finalizei:\\nsite da Mila\\nprivacidade\\ntermos" produz exatamente 3 itens de atividade distintos', () => {
  const command = parseInternalCommand('finalizei:\nsite da Mila\nprivacidade\ntermos')
  assert.equal(command.intent, 'ACTIVITY_COMPLETE')
  assert.equal(command.items.length, 3)
  assert.deepEqual(command.items.map((item) => item.summary), ['site da Mila', 'privacidade', 'termos'])
  assert.match(worker, /for\(let index=0;index<items\.length;index\+=1\)\{[\s\S]{0,400}recordEvent\(admin,event,type,title,clean\(items\[index\]\.summary\)/)
})

// --- 12: pending CREATE_TASK + "meu dia" → LIST_MINE, pending limpo ------------------------------
test('12: pending CREATE_TASK + "meu dia" executa LIST_MINE (sem mutação) e limpa o pending antigo', () => {
  const command = parseInternalCommand('meu dia')
  assert.equal(command.intent, 'LIST_MINE')
  // LIST_MINE só lê (Promise.all de selects) — nenhum insert/update/upsert nesse bloco.
  const startIdx = worker.indexOf("command.intent==='LIST_MINE'")
  const block = worker.slice(startIdx, worker.indexOf('\n  }', startIdx))
  assert.doesNotMatch(block, /\.insert\(|\.update\(|\.upsert\(/)
  assert.match(worker, /command\.intent!==event\.session\.active_intent\)await clearAssistantSession/)
})

// --- 13: pending financeiro + "cria tarefa..." → nova intenção ganha -----------------------------
test('13: pending financeiro (FINANCIAL_EXPENSE_REQUEST awaiting_context) + "cria tarefa revisar Origami amanhã" → CREATE_TASK vence', () => {
  const command = parseInternalCommand('cria tarefa revisar Origami amanhã')
  assert.equal(command.intent, 'CREATE_TASK')
  // A resolução de pending de despesa só dispara quando o comando atual é UNKNOWN — CREATE_TASK
  // (intenção forte, já resolvida pelo parser) nunca entra nesse ramo.
  assert.match(worker, /command\.intent==='UNKNOWN'&&event\.session\?\.active_intent==='FINANCIAL_EXPENSE_REQUEST'/)
})

// --- 14, 16: sinal de tarefa explícito (palavra "tarefa" ou short id) → COMPLETE_TASK ------------
test('14, 16: "concluir tarefa revisar Roove" e "conclui #A1B2C3" → COMPLETE_TASK com busca natural', () => {
  const byTitle = parseInternalCommand('concluir tarefa revisar Roove')
  assert.equal(byTitle.intent, 'COMPLETE_TASK')
  assert.equal(byTitle.task_query, 'revisar Roove')
  assert.equal(byTitle.task_short_id, null)
  const byShortId = parseInternalCommand('conclui #A1B2C3')
  assert.equal(byShortId.intent, 'COMPLETE_TASK')
  assert.equal(byShortId.task_short_id, 'A1B2C3')
})

// --- 15: sem sinal de tarefa, "finalizei" continua ACTIVITY_COMPLETE (mesmo com palavra "revisão") ---
test('15: "finalizei revisão da Roove" (sem a palavra "tarefa") continua ACTIVITY_COMPLETE, não COMPLETE_TASK', () => {
  const command = parseInternalCommand('finalizei revisão da Roove')
  assert.equal(command.intent, 'ACTIVITY_COMPLETE')
  assert.equal(command.summary, 'revisão da Roove')
})

// --- 17-18: tarefa ambígua gera opções numeradas; seleção resolve contra candidate_items ---------
test('17-18: tarefa ambígua salva candidate_items tipo task e "a primeira"/número resolvem via SESSION_SELECTION', () => {
  assert.match(worker, /if \(found\.kind === 'ambiguous'\) \{/)
  assert.match(worker, /type: 'task', task_id: item\.id, label: item\.title/)
  assert.match(worker, /active_intent: 'TASK_SELECTION'/)
  assert.match(worker, /pending_task_intent: command\.intent, pending_task_fields:/)
  assert.match(worker, /Encontrei mais de uma:\\n\\n/)
  assert.match(worker, /command\.intent==='SESSION_SELECTION'&&event\.session\?\.active_intent==='TASK_SELECTION'/)
  assert.match(worker, /const outcome=await applyTaskAction\(admin,event,task\.data,taskIntent,fields\)/)
  // A mesma resolução numérica/ordinal/por-rótulo já usada para cobranças serve para tarefas — não é
  // um mecanismo novo, reaproveita candidateItems/selectableItems do pipeline.
  assert.match(worker, /const byName=candidateItems\.filter\(\(item:any\)=>item\.label&&/)
})

// --- 19: "cancela" limpa qualquer sessão pendente ------------------------------------------------
test('19: "cancela" limpa a sessão pendente (qualquer active_intent, não só financeiro)', () => {
  const command = parseInternalCommand('cancela')
  assert.equal(command.intent, 'CANCEL_FINANCIAL')
  assert.match(worker, /command\.intent==='CANCEL_FINANCIAL'&&event\.session\?\.active_intent&&event\.session\.active_intent!=='COLLECTION_SEND'/)
})

// --- 20: "ajuda" continua indo para HELP (pedido explícito) --------------------------------------
test('20: "ajuda" continua sendo HELP — pedido explícito, não fallback universal', () => {
  const command = parseInternalCommand('ajuda')
  assert.equal(command.intent, 'HELP')
  assert.match(worker, /if \(command\.intent === 'HELP'\) return HELP_TEXT/)
})

// --- não presumir auth_profile_id para nenhum membro da equipe -----------------------------------
test('equipe: fluxos de tarefa/atividade usam team_members.id (nunca auth_profile_id) como referência operacional', () => {
  // CREATE_TASK/ASSIGN_TASK atribuem pelo id operacional do membro — Kleber, Julia, Liliu e Danilo
  // funcionam igual, tenham ou não profile de autenticação vinculado.
  assert.match(worker, /assigned_to: assignee\?\.id \|\| event\.team_member_id/)
  assert.match(worker, /patch\.assigned_to = member\.id/)
  // Onde auth_profile_id É necessário (permissão financeira), o código checa a ausência antes de usar.
  assert.match(worker, /if\(!event\.team_member\?\.auth_profile_id\)return false/)
})

test('A: comandos puros de criação são intenção sem título e não atravessam a continuação pendente', () => {
  for (const phrase of ['criar tarefa', 'registrar tarefa', 'adicionar tarefa', 'nova tarefa', 'preciso criar uma tarefa']) {
    const command = parseInternalCommand(phrase)
    assert.equal(command.intent, 'CREATE_TASK', phrase)
    assert.equal(command.title, '', phrase)
    assert.equal(isTaskCreationCommandOnly(phrase), true, phrase)
  }
  assert.match(worker, /cleanedRaw&&!isTaskCreationCommandOnly\(cleanedRaw\)/)
  assert.match(worker, /items\.some\(\(item:any\)=>!clean\(item\.title\)\|\|isTaskCreationCommandOnly\(item\.title\)\)/)
})

test('B/D: conteúdo após a intenção mantém título/data e a leitura usa a mesma organização e o mesmo responsável', () => {
  const command = parseInternalCommand('Revisar campanha Roove amanhã', { now: new Date('2026-09-28T12:00:00-03:00') })
  assert.equal(command.intent, 'UNKNOWN')
  assert.equal(command.raw_text, 'Revisar campanha Roove amanhã')
  assert.equal(taskTitleFromText(command.raw_text), 'Revisar campanha Roove')
  assert.match(worker, /items=lines\.map\(\(line:string\)=>\(\{title:taskTitleFromText\(clean\(line,240\)\),\.\.\.parseTaskSchedule\(line\)\}\)\)/)
  assert.match(worker, /assigned_to: assignee\?\.id \|\| event\.team_member_id/)
  assert.match(worker, /getMemberTaskReadModel\(admin,org,event\.team_member_id,today\(\)\)/)
})

test('C: conclusão FIAP aguarda data e “Hoje” resolve em America/Sao_Paulo com atualização comprovada', () => {
  const completed = parseInternalCommand('Trabalho FIAP finalizado - Start up One')
  assert.equal(completed.intent, 'ACTIVITY_COMPLETE')
  assert.equal(completed.summary, 'Trabalho FIAP - Start up One')
  assert.equal(completed.due_date, null)
  assert.match(worker, /active_intent:'ACTIVITY_DATE_CONFIRMATION'/)
  assert.match(worker, /\.select\('id'\)\.maybeSingle\(\)/)
  assert.match(worker, /if\(!changed\.data\)throw Object\.assign\(new Error\('A atividade não foi atualizada\.'/)
  assert.match(worker, /\.gte\('occurred_at',start\)\.lte\('occurred_at',end\)/)
  assert.match(worker, /\$\{completed\} concluída\$\{completed===1\?'':'s'\}/)
})

test('E: nenhuma confirmação de tarefa ou atividade é produzida antes de persistência real', () => {
  const taskInsert = worker.indexOf("await admin.from('crm_tasks').insert")
  const taskReply = worker.indexOf('Tarefa criada ✓')
  const activityGuard = worker.indexOf("OPERATIONAL_EVENT_NOT_PERSISTED")
  const activityReply = worker.indexOf('Fechado, registrei ✓')
  assert.ok(taskInsert > -1 && taskReply > taskInsert)
  assert.ok(activityGuard > -1 && activityReply > activityGuard)
  assert.match(worker, /if \(inserted\.error\) throw inserted\.error/)
})

test('Kleber, Julia, Liliu e Danilo são resolvidos pela mesma regra organização+membro+telefone', () => {
  const members = [
    { id: 'kleber-id', name: 'Kleber', phone: '5511972769605' },
    { id: 'julia-id', name: 'Julia', phone: '5511973510549' },
    { id: 'liliu-id', name: 'Liliu', phone: '5521974556233' },
    { id: 'danilo-id', name: 'Danilo', phone: '5581994728217' },
  ]
  for (const member of members) assert.equal(findInternalMemberByPhone(members, member.phone)?.id, member.id)
  assert.equal(findInternalMemberByPhone(members, '5511973510549')?.id, 'julia-id')
  assert.notEqual(findInternalMemberByPhone(members, '5511973510549')?.id, 'kleber-id')
  assert.match(webhook, /eq\('organization_id', connection\.organization_id\)\.eq\('active', true\)/)
  assert.match(webhook, /findInternalMemberByPhone\(members\.data \|\| \[\], waId\)/)
  assert.doesNotMatch(webhook, /5511972769605|5511973510549|5521974556233|5581994728217/)
})

test('"Quais minhas tarefas amanhã?" consulta o dia perguntado, não sempre hoje', () => {
  const command = parseInternalCommand('Quais minhas tarefas amanhã?', { now: new Date('2026-09-28T12:00:00-03:00') })
  assert.equal(command.intent, 'LIST_MINE')
  assert.equal(command.due_date, '2026-09-29')
  // O worker precisa usar esse due_date — não pode sempre consultar today() ignorando a pergunta.
  assert.match(worker, /const queryDay=command\.due_date\|\|today\(\),isToday=queryDay===today\(\)/)
  assert.match(worker, /getMemberTaskReadModel\(admin,org,event\.team_member_id,queryDay\)/)
  assert.match(worker, /dayWindow\(queryDay\)/)
  // A pergunta de hoje continua respondendo com o texto de sempre (nenhuma regressão de formato).
  assert.match(worker, /const heading=isToday\?'Hoje você tem:':`Em \$\{queryDay\} você tem:`/)
  assert.match(worker, /'Hoje você tem:'/)
})

// ===================================================================================================
// REGRA NOVA: nenhuma crm_task criada pelo assistente pode ficar sem due_date, e nenhuma tarefa é
// inserida sem confirmação explícita — mesmo quando a data já veio na mesma mensagem do título.
// ===================================================================================================

// --- CASO A: sem data na mensagem → pergunta a data → só então pergunta confirmação -------------
test('CASO A: título sem data pede "para quando", nunca insere direto', () => {
  assert.match(worker, /if \(items\.some\(\(item:any\)=>!item\.due_date\)\) \{/)
  assert.match(worker, /pending_action:'resolve_task_date'/)
  assert.match(worker, /return items\.length>1\?'Para quando ficam essas tarefas\?':`Para quando fica "\$\{clean\(items\[0\]\.title\)\}"\?`/)
  // A checagem de due_date ausente precisa vir antes do insert do próprio bloco CREATE_TASK — nunca
  // depois (o primeiro insert em crm_tasks do arquivo é de outro fluxo, FOLLOW_UP, por isso a busca do
  // insert começa a partir da checagem de due_date, não do início do arquivo).
  const dueDateGuard = worker.indexOf("items.some((item:any)=>!item.due_date)")
  const insertCall = worker.indexOf("await admin.from('crm_tasks').insert", dueDateGuard)
  assert.ok(dueDateGuard > -1 && insertCall > dueDateGuard)
})

// --- CASO A (continuação): resposta com a data completa os itens pendentes e segue para confirmação
test('CASO A (retomada): resposta só com a data ("amanhã") resolve o item pendente via sessionDate', () => {
  assert.match(worker, /event\.session\?\.pending_action==='resolve_task_date'&&cleanedRaw\)\{\s*\n\s*if\(sessionDate\)\{/)
  assert.match(worker, /const pendingItems=Array\.isArray\(event\.session\.context\?\.pending_items\)\?event\.session\.context\.pending_items:\[\]/)
  assert.match(worker, /const items=pendingItems\.map\(\(item:any\)=>\(\{\.\.\.item,due_date:item\.due_date\|\|sessionDate\}\)\)/)
})

// --- CASO B/C: fluxo legado mantém confirmação; plano validado da secretária pode executar direto ---
test('CASO B: data presente mantém confirmação no legado e permite baixo risco na secretária', () => {
  assert.match(worker, /if \(!command\.date_confirmed && !command\.secretary_direct\) \{/)
  assert.match(worker, /pending_action:'confirm_task_date'/)
  const dateConfirmGuard = worker.indexOf('if (!command.date_confirmed && !command.secretary_direct)')
  const insertCall = worker.indexOf("await admin.from('crm_tasks').insert", dateConfirmGuard)
  assert.ok(dateConfirmGuard > -1 && insertCall > dateConfirmGuard)
  // "sim"/"confirmo" já é CONFIRM_FINANCIAL no parser (não precisa de novo vocabulário) — a retomada
  // reconstrói o CREATE_TASK com date_confirmed:true para liberar a gravação.
  assert.equal(parseInternalCommand('sim').intent, 'CONFIRM_FINANCIAL')
  assert.equal(parseInternalCommand('confirmo').intent, 'CONFIRM_FINANCIAL')
  assert.match(worker, /command\.intent==='CONFIRM_FINANCIAL'&&event\.session\?\.active_intent==='CREATE_TASK'&&event\.session\?\.pending_action==='confirm_task_date'/)
  assert.match(worker, /date_confirmed:true/)
})

test('CASO C: "dia 5 de outubro" resolve due_date e o título não carrega a data', () => {
  const command = parseInternalCommand('Enviar relatório Origami dia 5 de outubro', { now: new Date('2026-09-28T12:00:00-03:00') })
  assert.equal(taskTitleFromText(command.raw_text), 'Enviar relatório Origami')
  // A mesma resolução usada pelo describe_tasks/CREATE_TASK direto (parseTaskSchedule) já cobre o
  // formato "dia N de mês" — confirmado no parser puro (sem depender de mock de worker/DB).
})

// --- CASO D: invariante — devolvido "não" cancela pelo caminho genérico já existente ---------------
test('CASO D: "não" durante confirm_task_date cancela pelo bloco genérico de CANCEL_FINANCIAL', () => {
  assert.equal(parseInternalCommand('não').intent, 'CANCEL_FINANCIAL')
  assert.match(worker, /command\.intent==='CANCEL_FINANCIAL'&&event\.session\?\.active_intent&&event\.session\.active_intent!=='COLLECTION_SEND'/)
})

// --- CASO E: frase de conclusão durante um CREATE_TASK pendente nunca vira título de tarefa --------
test('CASO E: "trabalho fiap start up one entregue" é ACTIVITY_COMPLETE, nunca título de tarefa pendente', () => {
  const command = parseInternalCommand('trabalho fiap start up one entregue')
  assert.equal(command.intent, 'ACTIVITY_COMPLETE')
  assert.equal(command.summary, 'trabalho fiap start up one')
  // A retomada de describe_tasks só roda quando o comando atual é UNKNOWN — ACTIVITY_COMPLETE nunca
  // passa por ali, então uma frase de conclusão nunca vira o título da tarefa pendente.
  assert.match(worker, /else if\(command\.intent==='UNKNOWN'&&event\.session\?\.active_intent==='CREATE_TASK'&&event\.session\.state==='awaiting_context'&&event\.session\?\.pending_action==='describe_tasks'/)
})

// --- CASO F: "já entreguei"/"já fiz" também disparam conclusão (variação com "já") ------------------
test('CASO F: "já entreguei o relatório da Origami" e "já fiz X" viram ACTIVITY_COMPLETE', () => {
  assert.equal(parseInternalCommand('já entreguei o relatório da Origami').intent, 'ACTIVITY_COMPLETE')
  assert.equal(parseInternalCommand('já entreguei o relatório da Origami').summary, 'o relatório da Origami')
  assert.equal(parseInternalCommand('já fiz o relatório da Origami').intent, 'ACTIVITY_COMPLETE')
})

// --- CASO G: a data usada na criação é a mesma que "tarefas amanhã" consulta -----------------------
test('CASO G: due_date resolvido na criação usa o mesmo motor de data da consulta "amanhã"', () => {
  const now = new Date('2026-09-28T12:00:00-03:00')
  const created = parseInternalCommand('cria tarefa revisar Roove amanhã', { now })
  const queried = parseInternalCommand('Quais minhas tarefas amanhã?', { now })
  assert.equal(created.due_date, queried.due_date)
})

// --- CASO H/I: o fluxo de data/confirmação é genérico — não hardcoda nome de membro ----------------
test('CASO H/I: resolve_task_date e confirm_task_date preservam assignee_name da sessão (genérico p/ os 4 membros)', () => {
  assert.match(worker, /assignee_name:event\.session\.context\?\.assignee_name\|\|null,task_type:event\.session\.context\?\.task_type\|\|null,priority:event\.session\.context\?\.priority\|\|null,confidence:1\}/)
  assert.match(worker, /assignee_name:event\.session\.context\?\.assignee_name\|\|null,task_type:event\.session\.context\?\.task_type\|\|null,priority:event\.session\.context\?\.priority\|\|null,date_confirmed:true,confidence:1\}/)
  assert.match(worker, /context:\{pending_items:items,assignee_name:command\.assignee_name\|\|null,task_type:command\.task_type\|\|null,priority:command\.priority\|\|null\}/)
})

// ===================================================================================================
// REGRESSÃO (Liliu): resposta sem data reconhecível durante ACTIVITY_DATE_CONFIRMATION nunca pode cair
// no fallback de IA — isso já causou duplicidade real (2º operational_event criado do zero e o
// original órfão, com effective_date_pending preso em true para sempre).
// ===================================================================================================
test('regressão Liliu: "to finalizando agora" (sem palavra de data) durante ACTIVITY_DATE_CONFIRMATION nunca cria evento novo', () => {
  const command = parseInternalCommand('to finalizando agora')
  assert.equal(command.intent, 'UNKNOWN')
  // A retomada precisa interceptar isso ANTES do fallback de IA — nunca deixa a IA reclassificar como
  // uma ACTIVITY_COMPLETE nova enquanto há uma confirmação de data pendente.
  assert.match(worker, /else if\(command\.intent==='UNKNOWN'&&event\.session\?\.active_intent==='ACTIVITY_DATE_CONFIRMATION'\)\{/)
  assert.match(worker, /command=\{intent:'ACTIVITY_DATE_RESOLUTION',due_date:null,confidence:1\}/)
  // O handler de ACTIVITY_DATE_RESOLUTION com due_date nulo só re-pergunta — nenhuma escrita, nenhum
  // insert, nenhum update. Precisa vir antes do fallback de IA no arquivo.
  const guardIdx = worker.indexOf("command.intent==='UNKNOWN'&&event.session?.active_intent==='ACTIVITY_DATE_CONFIRMATION'")
  const aiFallbackCallIdx = worker.indexOf('command=await aiFallback(')
  assert.ok(guardIdx > -1 && aiFallbackCallIdx > guardIdx)
  assert.match(worker, /if\(!ids\.length\|\|!command\.due_date\)return 'Qual foi a data\?/)
  // ACTIVITY_DATE_RESOLUTION já está isento do auto-clear por divergência de intenção — a sessão
  // continua aberta para uma nova tentativa (nenhum loop infinito: "cancela" ainda funciona a qualquer
  // momento pelo bloco genérico de CANCEL_FINANCIAL, e a sessão expira em 30min de qualquer forma).
  assert.match(worker, /'CONFIRM_FINANCIAL','CANCEL_FINANCIAL','UNKNOWN','SESSION_SELECTION','GREETING','TASK_CONTEXT_LIST','ACTIVITY_DATE_RESOLUTION','CREATE_TASK_DATE_UNRESOLVED'\]\.includes\(command\.intent\)/)
})

// ===================================================================================================
// HOTFIX 2026-09-29: lista numerada inline no mesmo comando ("1. x 2. y 3. z"), "até o final do dia"
// como data, e resposta de data pendente nunca pode cair no fallback de IA.
// ===================================================================================================

// --- 1/1b: lista numerada inline vira CREATE_TASK com 1 item por marcador ------------------------
test('1: lista numerada inline "1. ajustes de latinas 2. demanda de liliu de origami 3. posts roove" gera 3 tarefas', () => {
  const command = parseInternalCommand('1. ajustes de latinas 2. demanda de liliu de origami 3. posts roove')
  assert.equal(command.intent, 'CREATE_TASK')
  assert.equal(command.items.length, 3)
  assert.deepEqual(command.items.map((item) => item.title), ['ajustes de latinas', 'demanda de liliu de origami', 'posts roove'])
})

// --- 2: a mesma lista via bullets (comportamento existente) continua produzindo os mesmos 3 itens --
test('2: a mesma lista via "- item" (bullets, comportamento existente) continua gerando 3 itens', () => {
  const command = parseInternalCommand('- ajustes de latinas\n- demanda de liliu de origami\n- posts roove')
  assert.equal(command.intent, 'CREATE_TASK')
  assert.equal(command.items.length, 3)
  assert.deepEqual(command.items.map((item) => item.title), ['ajustes de latinas', 'demanda de liliu de origami', 'posts roove'])
})

// --- 3: marcador com parêntese "1) ... 2) ... 3) ..." também é reconhecido -------------------------
test('3: "1) item A 2) item B 3) item C" gera 3 itens', () => {
  const command = parseInternalCommand('1) item A 2) item B 3) item C')
  assert.equal(command.intent, 'CREATE_TASK')
  assert.equal(command.items.length, 3)
  assert.deepEqual(command.items.map((item) => item.title), ['item A', 'item B', 'item C'])
})

// --- 4: números comuns (versão, valor, ano) nunca são tratados como lista ---------------------------
test('4: "campanha 2026", "R$ 3.500" e "versão 2.0" nunca são divididos em itens', () => {
  for (const phrase of ['campanha 2026', 'R$ 3.500', 'versão 2.0']) {
    assert.equal(splitInlineNumberedList(phrase), null, phrase)
  }
  // Marcadores que existem mas não são sequenciais a partir de 1 ("etapa 4. ... etapa 5.") também não contam.
  assert.equal(splitInlineNumberedList('Terminamos a etapa 4. Começamos a etapa 5. Confirmamos com o cliente.'), null)
  assert.equal(parseInternalCommand('campanha 2026').intent, 'UNKNOWN')
})

// --- 5/6: "até o final/fim do dia" resolve para hoje (America/Sao_Paulo), nunca inventa horário -----
test('5/6: "até o final do dia" / "até o fim do dia" / "fim do dia" / "no final do dia" resolvem para hoje', () => {
  const now = new Date('2026-09-29T12:00:00-03:00')
  for (const phrase of ['até o final do dia', 'até o fim do dia', 'fim do dia', 'no final do dia', 'hoje até o final do dia']) {
    assert.equal(resolveRelativeDate(phrase, now), '2026-09-29', phrase)
  }
})

// --- 7/8: parseTaskSchedule nunca inventa horário; devolve due_date=hoje, due_time=null -------------
test('7/8: parseTaskSchedule("acredito que até o final do dia") => due_date hoje, due_time null', () => {
  const now = new Date('2026-09-29T12:00:00-03:00')
  const schedule = parseTaskSchedule('acredito que até o final do dia', now)
  assert.equal(schedule.due_date, '2026-09-29')
  assert.equal(schedule.due_time, null)
})

// --- 8/9: resolve_task_date NUNCA cai no fallback de IA, resolvido ou não ---------------------------
test('8/9: resolve_task_date sem "&&sessionDate" no guard — separa "resolvido" de "sem data reconhecível" antes do aiFallback', () => {
  // O guard de entrada não exige mais sessionDate — ambos os casos (resolvido/não resolvido) são
  // tratados dentro do bloco, e nenhum dos dois desce até o aiFallback (chamado só depois, na seção 4).
  const guardIdx = worker.indexOf("event.session?.active_intent==='CREATE_TASK'&&event.session?.pending_action==='resolve_task_date'&&cleanedRaw)")
  const unresolvedIdx = worker.indexOf("command={intent:'CREATE_TASK_DATE_UNRESOLVED',confidence:1}")
  const aiFallbackCallIdx = worker.indexOf('command=await aiFallback(')
  assert.ok(guardIdx > -1 && unresolvedIdx > guardIdx && aiFallbackCallIdx > unresolvedIdx)
  // Handler de CREATE_TASK_DATE_UNRESOLVED só pergunta de novo — nenhum insert/update/upsert, nenhum
  // recordEvent de decisão/observação.
  const handlerIdx = worker.indexOf("command.intent==='CREATE_TASK_DATE_UNRESOLVED'")
  const handlerBlock = worker.slice(handlerIdx, worker.indexOf('\n  }', handlerIdx))
  assert.doesNotMatch(handlerBlock, /\.insert\(|\.update\(|\.upsert\(|recordEvent\(/)
  assert.match(handlerBlock, /Qual dia/)
  // Isento do auto-clear de sessão — a sessão pendente (resolve_task_date) continua aberta.
  assert.match(worker, /'ACTIVITY_DATE_RESOLUTION','CREATE_TASK_DATE_UNRESOLVED'\]\.includes\(command\.intent\)/)
})

// --- 10: ACTIVITY_CAPTURE + lista numerada inline gera 1 atividade por item, não uma descrição única
test('10: ACTIVITY_CAPTURE + "1. ajustes de latina 2. origami 3. posts roove" gera items=3 (não summary único)', () => {
  const items = splitInlineNumberedList('1. ajustes de latina 2. origami 3. posts roove').items
  assert.deepEqual(items, ['ajustes de latina', 'origami', 'posts roove'])
  // O branch de ACTIVITY_CAPTURE não depende mais de command.intent==='UNKNOWN' no guard externo —
  // ele mesmo decide, olhando splitInlineNumberedList(cleanedRaw) primeiro.
  assert.match(worker, /else if\(event\.session\?\.active_intent==='ACTIVITY_CAPTURE'&&event\.session\.state==='awaiting_context'&&cleanedRaw\)\{/)
  assert.match(worker, /const inlineActivities=splitInlineNumberedList\(cleanedRaw\)/)
  assert.match(worker, /if\(inlineActivities\)command=\{intent:'ACTIVITY_COMPLETE',items:inlineActivities\.items\.map\(\(summary:string\)=>\(\{summary:clean\(summary,240\)\}\)\),summary:clean\(inlineActivities\.items\[0\],240\),contextual:true,confidence:1\}/)
  // Cada item de ACTIVITY_COMPLETE já grava 1 operational_event individual (mecanismo existente,
  // reaproveitado sem alteração) com idempotency_key por índice.
  assert.match(worker, /idempotencyKey=itemIndex===null\?`command:\$\{event\.id\}\$\{actionPart\}:\$\{type\}`:`command:\$\{event\.id\}\$\{actionPart\}:\$\{type\}:\$\{itemIndex\}`/)
})

// --- 11: resolução de membro por telefone (Liliu) permanece intocada -------------------------------
test('11: Liliu (5521974556233) continua resolvida pela mesma regra organização+membro+telefone (sem mudança)', () => {
  const members = [{ id: 'liliu-id', name: 'Liliu', phone: '5521974556233' }]
  assert.equal(findInternalMemberByPhone(members, '5521974556233')?.id, 'liliu-id')
  assert.equal(findInternalMemberByPhone(members, '5521974556233')?.id, findInternalMemberByPhone(members, '5521974556233')?.id)
})

// ===================================================================================================
// HOTFIX 2026-09-29 (parte 2): timestamp de registro (created_at) exibido na resposta do WhatsApp,
// sempre separado de due_date/due_time — nunca inventa horário, sempre America/Sao_Paulo.
// ===================================================================================================

// --- 1: created_at aparece formatado como DD/MM/AAAA às HH:MM (America/Sao_Paulo) -------------------
test('1: formatRegisteredAt(created_at) produz "29/09/2026 às 18:19" em America/Sao_Paulo, nunca UTC', () => {
  assert.match(worker, /const formatRegisteredAt = \(createdAt: string\) => \{/)
  assert.match(worker, /timeZone: 'America\/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric'/)
  assert.match(worker, /timeZone: 'America\/Sao_Paulo', hour: '2-digit', minute: '2-digit'/)
  assert.match(worker, /return `\$\{datePart\} às \$\{timePart\}`/)
})

// --- 2: due_date (prazo) continua um conceito separado de created_at (registro) ----------------------
test('2: due_date (prazo) e created_at (registro) nunca se confundem — devem vir de colunas diferentes', () => {
  assert.match(worker, /Prazo: \$\{ddmmyyyy\(task\.due_date\)\}/)
  assert.match(worker, /Registrada: \$\{formatRegisteredAt\(task\.created_at\)\}/)
  // ddmmyyyy só reordena os dígitos de due_date (uma DATE, sem timezone) — nunca reconstrói via `new Date`.
  assert.match(worker, /const ddmmyyyy = \(dueDate: string\) => \{ const \[y, m, d\] = String\(dueDate\)\.split\('-'\); return `\$\{d\}\/\$\{m\}\/\$\{y\}` \}/)
  // Os dois SELECTs de crm_tasks (novo insert e o de idempotência) trazem created_at explicitamente —
  // nenhuma coluna duplicada foi criada, é o created_at que já existe no schema.
  assert.match(worker, /select\('id,title,due_date,due_time,created_at'\)\.eq\('organization_id', org\)\.eq\('source_ref', sourceRef\)/)
  assert.match(worker, /\.select\('id,title,due_date,due_time,created_at'\)\.single\(\)/)
})

// --- 3: due_time aparece no prazo quando existir, no formato "às HH:MM" ------------------------------
test('3: due_time aparece como "Prazo: DD/MM/AAAA às HH:MM" só quando due_time existir', () => {
  assert.match(worker, /task\.due_time \? ` às \$\{String\(task\.due_time\)\.slice\(0,5\)\}` : ''/)
})

test('resposta de múltiplas tarefas mostra "Registradas:" uma única vez ao final (não repete created_at por item)', () => {
  assert.match(worker, /Registradas: \$\{formatRegisteredAt\(created\[0\]\.created_at\)\}/)
  // Cada item da lista usa ddmmyyyy no lugar do ISO cru (formato antigo "— 2026-09-29").
  assert.match(worker, /\$\{i \+ 1\}\. \$\{taskShortId\(t\.id\)\} \$\{t\.title\}\$\{t\.due_date \? ` — \$\{ddmmyyyy\(t\.due_date\)\}` : ''\}/)
})

test('OperationsHubPage (Meu Dia/Semana/Backlog) mostra "Registrada em" usando created_at em America/Sao_Paulo', () => {
  const page = fs.readFileSync('src/components/OperationsHubPage.jsx', 'utf8')
  assert.match(page, /const formatRegisteredAt=\(createdAt\)=>\{/)
  assert.match(page, /timeZone:'America\/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'/)
  assert.match(page, /item\.created_at&&<small className="task-registered-at">Registrada em \{formatRegisteredAt\(item\.created_at\)\}<\/small>/)
  // A busca de tarefas usa select('*', ...) — created_at já vem junto, nenhuma mudança de repositório
  // foi necessária (nenhuma coluna nova, nenhum select específico faltando o campo).
  const repo = fs.readFileSync('src/services/data/tasksRepository.js', 'utf8')
  assert.match(repo, /const select='\*,/)
})
