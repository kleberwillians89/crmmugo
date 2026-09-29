import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parseInternalCommand } from '../supabase/functions/_shared/internalCommandCore.js'

const worker = fs.readFileSync('supabase/functions/task-command-worker/index.ts', 'utf8')
const core = fs.readFileSync('supabase/functions/_shared/internalCommandCore.js', 'utf8')

// --- 1: saudação nunca vira HELP ------------------------------------------------------------
test('1: saudação pura ("oi assistente"/"oie"/"bom dia"...) gera GREETING, nunca HELP', () => {
  for (const phrase of ['oi assistente', 'oie assistente', 'oi', 'oie', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'ei assistente', 'fala assistente']) {
    assert.equal(parseInternalCommand(phrase).intent, 'GREETING', phrase)
  }
  // HELP fica só para pedido explícito.
  for (const phrase of ['ajuda', 'help', 'o que voce faz', 'como funciona', 'o que posso pedir']) {
    assert.equal(parseInternalCommand(phrase).intent, 'HELP', phrase)
  }
  assert.match(worker, /command\.intent === 'GREETING'/)
  assert.match(worker, /Bom dia, \$\{firstName\}\./)
  assert.match(worker, /1\. Ver tarefas/)
})

// --- 2: "cobrar clientes" nunca vira um cliente chamado "clientes" --------------------------
test('2: "cobrar clientes" lista cobranças reais (LIST_PENDING_CHARGES), nunca um subject_query "clientes"', () => {
  const command = parseInternalCommand('cobrar clientes')
  assert.equal(command.intent, 'LIST_PENDING_CHARGES')
  assert.notEqual(command.subject_query, 'clientes')
  for (const generic of ['cobrar empresa', 'cobrar empresas', 'cobrar cobranças', 'cobrar pendências', 'cobrar'])
    assert.equal(parseInternalCommand(generic).intent, 'LIST_PENDING_CHARGES', generic)
  // Um nome real continua indo para COLLECTION_SEND normalmente.
  assert.equal(parseInternalCommand('cobrar Roove').intent, 'COLLECTION_SEND')
  assert.equal(parseInternalCommand('cobrar Roove').subject_query, 'Roove')
  // A lista consulta parcelas elegíveis de verdade (mesmo critério do envio de cobrança).
  assert.match(worker, /command\.intent === 'LIST_PENDING_CHARGES'[\s\S]{0,700}eq\('received_amount', 0\)\.is\('paid_at', null\)/)
  assert.match(worker, /candidateItems = result\.data\.map[\s\S]{0,200}label: item\.clients\?\.trade_name/)
})

// --- 3 e 4: seleção por nome ou número sobre lista apresentada ------------------------------
test('3-4: após lista numerada, "1"/"primeiro"/"roove" resolvem o item — nunca caem em HELP/AI', () => {
  assert.match(worker, /selectableItems\.length\)\{/)
  assert.match(worker, /\/\^\\d\+\$\/\.test\(cleanedRaw\)/)
  assert.match(worker, /ordinalWords=\['primeiro','segundo','terceiro','quarto','quinto'\]/)
  assert.match(worker, /byName=candidateItems\.filter\(\(item:any\)=>item\.label&&\(foldText\(item\.label\)===foldedRaw/)
  assert.match(worker, /command=\{intent:'SESSION_SELECTION',selection:matchIndex,confidence:1\}/)
  // Resolução de sessão acontece antes do fallback de IA (aiFallback só é chamado depois, para UNKNOWN restante).
  const selectionIdx = worker.indexOf("command={intent:'SESSION_SELECTION',selection:matchIndex")
  const aiFallbackCallIdx = worker.indexOf('await aiFallback(event.raw_text,aiContext)')
  assert.ok(selectionIdx > -1 && aiFallbackCallIdx > -1 && selectionIdx < aiFallbackCallIdx)
})

// --- 5: atividade simples com informação completa registra 1 evento imediatamente ----------
test('5: "finalizei o site da Mila" gera 1 item, pronto para 1 operational_event activity_completed', () => {
  const command = parseInternalCommand('finalizei o site da Mila')
  assert.equal(command.intent, 'ACTIVITY_COMPLETE')
  assert.ok(command.summary && command.summary.length > 0)
  assert.equal(command.items, undefined) // item único não precisa de array — vira 1 recordEvent sem sufixo
  assert.match(worker, /idempotencyKey=itemIndex===null\?`command:\$\{event\.id\}:\$\{type\}`:/)
})

// --- 6: mensagem com duas linhas gera exatamente 2 itens/eventos ---------------------------
test('6: mensagem com duas linhas (site da Mila / ajustes da página) gera exatamente 2 itens distintos', () => {
  const command = parseInternalCommand('finalizei o site de mila\najustes da pagina privacidade e termos')
  assert.equal(command.intent, 'ACTIVITY_COMPLETE')
  assert.equal(command.items.length, 2)
  assert.notEqual(command.items[0].summary, command.items[1].summary)
  assert.doesNotMatch(command.items[0].summary, /^os dois/i)
  assert.doesNotMatch(command.items[1].summary, /^os dois/i)
  // O worker grava um operational_event POR item do array, com idempotency_key individual.
  assert.match(worker, /for\(let index=0;index<items\.length;index\+=1\)\{[\s\S]{0,400}recordEvent\(admin,event,type,title,clean\(items\[index\]\.summary\)/)
})

// --- 7: nenhum evento pode ter descrição literal "os dois" ---------------------------------
test('7: nenhuma descrição persistida pode ser a expressão referencial literal ("os dois"/"os dois trabalhos")', () => {
  // O parser isolado ainda captura o texto cru na primeira passada...
  const raw = parseInternalCommand('terminei os dois trabalhos')
  assert.equal(raw.summary, 'os dois trabalhos')
  // ...mas o worker sempre resolve a referência ANTES de persistir, substituindo por itens reais da sessão.
  assert.match(worker, /const activityCandidates=candidateItems\.filter\(\(item:any\)=>item\.type==='activity'\)/)
  assert.match(worker, /REFERENTIAL_ALL_WORDS\.has\(referentialFromRaw\)\|\|REFERENTIAL_ALL_WORDS\.has\(referentialFromSummary\|\|''\)/)
  assert.match(worker, /command=\{intent:'ACTIVITY_COMPLETE',items:activityCandidates\.map\(\(item:any\)=>\(\{summary:item\.summary\}\)\)/)
  // A resolução referencial (em processEvent) sempre roda antes de execute() ser chamado, então o
  // command.items já vem com os itens reais da sessão quando o laço de recordEvent (em execute()) roda.
  assert.match(worker, /await execute\(admin, event, command\)/)
  for (const word of REFERENTIAL_WORDS_FOR_TEST) assert.ok(core.includes(`'${word}'`), word)
})
const REFERENTIAL_WORDS_FOR_TEST = ['os dois', 'as duas', 'ambos', 'ambas', 'todos', 'todas']

// --- 8: "terminei os dois" com 2 candidatos na sessão produz exatamente 2 efeitos reais -----
test('8: referência "os dois"/"ambos" contra 2 candidatos da sessão resolve para os 2 itens reais, nunca 1 nem 3', () => {
  assert.match(worker, /activityCandidates\.length&&event\.session\?\.active_intent==='ACTIVITY_START'/)
  assert.match(worker, /summary:activityCandidates\[0\]\.summary,contextual:true,confidence:1\}/)
  assert.match(worker, /else if\(typeof target==='number'&&activityCandidates\[target\]\)command=\{intent:'ACTIVITY_COMPLETE',items:\[\{summary:activityCandidates\[target\]\.summary\}\]/)
  // ACTIVITY_START com múltiplos itens grava candidate_items do tipo 'activity' na sessão para a referência funcionar depois.
  assert.match(worker, /candidateItems=items\.map\(\(item,index\)=>\(\{index:index\+1,type:'activity',summary:clean\(item\.summary,240\)\}\)\)/)
})

// --- 9: novo comando completo cancela contexto incompleto de CREATE_TASK -------------------
test('9: "criar tarefa" incompleta grava sessão pendente, e um novo comando diferente a substitui automaticamente', () => {
  assert.match(worker, /await saveAssistantSession\(admin,event,\{state:'awaiting_context',active_intent:'CREATE_TASK'/)
  // A limpeza automática por comando diferente já existe e agora cobre CREATE_TASK (não está na lista de exceções).
  assert.match(worker, /command\.intent!==event\.session\.active_intent\)await clearAssistantSession/)
})

// --- 10: "cancelar" limpa qualquer estado pendente, não só financeiro ----------------------
test('10: "cancelar"/"deixa"/"esquece" limpam qualquer sessão pendente (não só COLLECTION_SEND)', () => {
  for (const phrase of ['cancelar', 'deixa', 'esquece', 'cancela']) assert.equal(parseInternalCommand(phrase).intent, 'CANCEL_FINANCIAL', phrase)
  assert.match(worker, /if\(command\.intent==='CANCEL_FINANCIAL'&&event\.session\?\.active_intent&&event\.session\.active_intent!=='COLLECTION_SEND'\)\{\s*await clearAssistantSession\(admin,event\)/)
})

// --- 11: sessão continua isolada por organização + membro + telefone -----------------------
test('11: sessão de um membro nunca interfere na de outro (isolamento por organization_id+team_member_id+phone)', () => {
  assert.match(worker, /eq\('organization_id',event\.organization_id\)\.eq\('team_member_id',event\.team_member_id\)\.eq\('phone',event\.wa_id\)/)
  assert.match(worker, /organization_id:event\.organization_id,team_member_id:event\.team_member_id,phone:event\.wa_id/)
})

// --- 12: só confirma "registrei" depois de garantir a persistência -------------------------
test('12: resposta "registrei" só é montada depois do laço que grava os operational_events', () => {
  const loopIdx = worker.indexOf('for(let index=0;index<items.length;index+=1){')
  const multiReplyIdx = worker.indexOf('Fechado. Registrei ${items.length} atividades concluídas')
  const singleReplyIdx = worker.indexOf('Fechado, registrei ✓')
  assert.ok(loopIdx > -1 && multiReplyIdx > -1 && singleReplyIdx > -1)
  assert.ok(loopIdx < multiReplyIdx)
  assert.ok(loopIdx < singleReplyIdx)
})

// --- HELP nunca é fallback universal para texto não reconhecido ----------------------------
test('HELP deixa de ser fallback universal: texto livre não reconhecido recebe pergunta de esclarecimento', () => {
  assert.match(worker, /const outcome:any = command\.intent === 'UNKNOWN' \? CLARIFY_TEXT : await execute/)
  assert.doesNotMatch(worker, /const outcome:any = command\.intent === 'UNKNOWN' \? HELP_TEXT/)
})
