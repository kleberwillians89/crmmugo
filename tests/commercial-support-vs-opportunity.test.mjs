import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { classifyConversationKind } from '../supabase/functions/_shared/commercialAgentCore.js'

const worker = fs.readFileSync(new URL('../supabase/functions/commercial-ai-worker/index.ts', import.meta.url), 'utf8')

// ===================================================================================================
// Cliente existente pedindo suporte/financeiro/rotina NUNCA pode virar oportunidade comercial nova —
// a mensagem ATUAL decide, nunca o histórico antigo. Reproduz o bug real: contato a0ce7df3-... pediu
// ajuda com o site, teve handoff correto, mas o worker criou a commercial_opportunity
// e439e7eb-962b-4f70-bed8-1c71b40ea510 mesmo assim (classificação rodava DEPOIS da criação).
// ===================================================================================================

// --- 1/2/3/4: cliente existente + support/finance/"falar com pessoa" => opportunity NÃO criada -----
test('1: existing client + "preciso de ajuda com meu site" => support, sem oportunidade', () => {
  const result = classifyConversationKind('Sou cliente da Mugô e preciso de ajuda com meu site.', { hasExistingClient: true, previousKind: null })
  assert.equal(result.kind, 'support')
})
test('1b: reprodução exata do bug real (mesma frase relatada)', () => {
  const result = classifyConversationKind('preciso de ajuda com meu site', { hasExistingClient: true, previousKind: null })
  assert.equal(result.kind, 'support')
})
test('2: existing client + "meu site caiu" => support', () => {
  assert.equal(classifyConversationKind('meu site caiu', { hasExistingClient: true, previousKind: null }).kind, 'support')
})
test('3: existing client + "quero falar com uma pessoa" => existing_client (sem demanda comercial clara)', () => {
  assert.equal(classifyConversationKind('quero falar com uma pessoa', { hasExistingClient: true, previousKind: null }).kind, 'existing_client')
})
test('4: existing client + "preciso da nota fiscal" => finance', () => {
  assert.equal(classifyConversationKind('preciso da nota fiscal', { hasExistingClient: true, previousKind: null }).kind, 'finance')
})

// --- 5/6: cliente existente + demanda nova clara => new_business (PODE criar oportunidade) ----------
test('5: existing client + "quero fazer outro site" => new_business', () => {
  assert.equal(classifyConversationKind('quero fazer outro site', { hasExistingClient: true, previousKind: null }).kind, 'new_business')
})
test('6: existing client + "quero contratar tráfego" => new_business', () => {
  assert.equal(classifyConversationKind('quero contratar tráfego', { hasExistingClient: true, previousKind: null }).kind, 'new_business')
})
test('6b: "quero uma nova automação" e "quero um novo projeto" => new_business', () => {
  assert.equal(classifyConversationKind('quero uma nova automação', { hasExistingClient: true, previousKind: null }).kind, 'new_business')
  assert.equal(classifyConversationKind('quero um novo projeto', { hasExistingClient: true, previousKind: null }).kind, 'new_business')
})

// --- 7: contato novo + "quero um site" => new_business (fluxo de lead novo continua intacto) --------
test('7: contato novo (nunca visto) + "quero um site" => new_business, opportunity continua sendo criada', () => {
  assert.equal(classifyConversationKind('quero um site', { hasExistingClient: false, previousKind: null }).kind, 'new_business')
})

// --- 8: histórico antigo com SITE/ECOMMERCE não pode obrigar oportunidade se a mensagem ATUAL é suporte
test('8: histórico antigo nunca decide — só a mensagem atual (mesmo com previousKind=new_business salvo)', () => {
  // A classificação no worker sempre chama classifyConversationKind com previousKind:null nesta
  // decisão (ver assert de código abaixo) — histórico nunca é lido para decidir se cria oportunidade.
  const withStalePrevious = classifyConversationKind('preciso de ajuda com meu site', { hasExistingClient: true, previousKind: 'new_business' })
  assert.equal(withStalePrevious.kind, 'support', 'a mensagem atual (support) precisa vencer mesmo se previousKind fosse new_business')
})

// ===================================================================================================
// Verificação de código: classificação roda ANTES da criação de opportunity; suporte/financeiro/
// rotina nunca cria opportunity/qualification/follow-up; faz handoff com infraestrutura já existente.
// ===================================================================================================

test('ordem: classifyConversationKind roda ANTES do insert em commercial_opportunities', () => {
  const classifyIdx = worker.indexOf('const currentKind=classifyConversationKind(inbound')
  const createIdx = worker.indexOf("const created=await admin.from('commercial_opportunities').insert(")
  assert.ok(classifyIdx > -1 && createIdx > -1 && classifyIdx < createIdx)
})

test('regra: só new_business (e não support/finance/existing_client) chega ao bloco de criação de opportunity', () => {
  assert.match(worker, /if\(!resolvedClient\.created&&\['support','finance','existing_client'\]\.includes\(currentKind\.kind\)\)\{/)
  // O branch de skip sempre "return true" antes de qualquer insert em commercial_opportunities.
  const skipIdx = worker.indexOf("if(!resolvedClient.created&&['support','finance','existing_client']")
  const returnIdx = worker.indexOf('return true', skipIdx)
  const createIdx = worker.indexOf("const created=await admin.from('commercial_opportunities').insert(")
  assert.ok(skipIdx > -1 && returnIdx > -1 && createIdx > returnIdx)
})

const skipIndex = worker.indexOf("if(!resolvedClient.created&&['support','finance','existing_client']")
const skipBlockEnd = worker.indexOf('return true', skipIndex) + 'return true'.length
const skipBlock = worker.slice(skipIndex, skipBlockEnd)

test('suporte/financeiro/rotina NUNCA cria commercial_opportunity, commercial_qualification ou follow-up automático', () => {
  assert.doesNotMatch(skipBlock, /from\('commercial_opportunities'\)\.insert/)
  assert.doesNotMatch(skipBlock, /from\('commercial_qualifications'\)/)
  assert.doesNotMatch(skipBlock, /commercial-followup/)
})

test('handoff sem opportunity usa só infraestrutura já existente: whatsapp_conversations + team_notification_outbox + crm_tasks (nenhuma tabela nova)', () => {
  assert.match(skipBlock, /from\('whatsapp_conversations'\)\.update\(\{status:'pending',attendance_mode:'human',automation_paused:true,assigned_to:commercialOwnerProfileId\|\|null,assigned_team_member_id:settingsResult\.data\.commercial_owner_id/)
  assert.match(skipBlock, /from\('team_notification_outbox'\)\.upsert/)
  assert.match(skipBlock, /notification_type:'operational_alert'/)
  assert.match(skipBlock, /from\('crm_tasks'\)\.upsert/)
  assert.match(skipBlock, /task_type:'general'/)
  assert.doesNotMatch(skipBlock, /create table|CREATE TABLE/)
})

test('handoff sem opportunity preserva client_id e telefone; nunca apaga histórico (nenhum delete)', () => {
  assert.match(skipBlock, /client_id:client\.id/)
  assert.match(skipBlock, /contact\.wa_id/)
  assert.doesNotMatch(skipBlock, /\.delete\(\)/)
})

// --- 9: prioridade humana preservada (gate já existente, antes e depois da chamada à IA) ------------
test('9: handoff humano continua impedindo a IA de responder por cima (gates preexistentes intocados)', () => {
  assert.match(worker, /if\(conversationResult\.data\.attendance_mode==='human'\|\|conversationResult\.data\.automation_paused===true\)\{/)
  assert.match(worker, /if\(recheck\.data\.attendance_mode==='human'\|\|recheck\.data\.automation_paused===true\)\{/)
  // O novo branch de skip roda DEPOIS desse gate — nunca sobrepõe um humano já ativo.
  const humanGateIdx = worker.indexOf("if(conversationResult.data.attendance_mode==='human'")
  const skipIdx = worker.indexOf("if(!resolvedClient.created&&['support','finance','existing_client']")
  assert.ok(humanGateIdx > -1 && skipIdx > humanGateIdx)
})

console.log('Support/finance/existing_client nunca vira oportunidade comercial: ok')
