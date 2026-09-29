import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const worker = fs.readFileSync(new URL('../supabase/functions/collection-notification-worker/index.ts', import.meta.url), 'utf8')
const mugozapApi = fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts', import.meta.url), 'utf8')

// --- Elegibilidade: nunca cobra paga, cancelada, parcialmente recebida ou futura -------------------
test('elegibilidade: consulta só pending/overdue, received_amount=0, paid_at nulo, due_date<=hoje', () => {
  assert.match(worker, /\.in\('status',\['pending','overdue'\]\)\.eq\('received_amount',0\)\.is\('paid_at',null\)/)
  assert.match(worker, /\.lte\('due_date',window\.localDate\)/)
  // status 'paid'/'cancelled' nunca aparecem no filtro .in(...) — não há caminho que os inclua.
  assert.doesNotMatch(worker, /\.in\('status',\[.*'paid'.*\]\)/)
  assert.doesNotMatch(worker, /\.in\('status',\[.*'cancelled'.*\]\)/)
})

// --- Idempotência: nunca reenvia o que já foi enviado/está em voo/falhou recentemente -------------
test('idempotência: chave por installment+notification_type+due_date_snapshot; nunca reenvia sent/sending/failed-recente', () => {
  assert.match(worker, /eq\('installment_id',row\.id\)\.eq\('notification_type','due_date_collection'\)\.eq\('due_date_snapshot',row\.due_date\)/)
  assert.match(worker, /if\(existing\.data\?\.provider_message_id\|\|existing\.data\?\.status==='sending'&&existing\.data\?\.action==='template_send_unconfirmed'\)return false/)
  assert.match(worker, /if\(existing\.data\?\.status==='failed'&&new Date\(existing\.data\.next_attempt_at\|\|0\)\.getTime\(\)>Date\.now\(\)\)return false/)
  assert.match(worker, /if\(existing\.data\?\.status==='sending'&&Date\.now\(\)-new Date\(existing\.data\.updated_at\|\|existing\.data\.created_at\)\.getTime\(\)<5\*60_000\)return false/)
  // Reserva de envio também é protegida contra corrida (23505 = já reservado por outra execução).
  assert.match(worker, /if\(reserved\.error\)\{if\(reserved\.error\.code==='23505'\)return false;throw reserved\.error\}/)
})

// --- NOVO: sem telefone válido nunca envia, mas deixa rastro (antes retornava false em silêncio) ---
test('sem telefone: nunca envia, registra alerta failed com error_code NO_PHONE (rastreável na UI)', () => {
  assert.match(worker, /if\(!phone\)\{/)
  assert.match(worker, /error_code:'NO_PHONE'/)
  assert.match(worker, /status:'failed'.*origin:'collection',attempts:1,error_code:'NO_PHONE'/)
  // A checagem de telefone ausente roda ANTES de qualquer tentativa de conexão/template/envio.
  const phoneGuard = worker.indexOf("if(!phone){")
  const connectionLookup = worker.indexOf("admin.from('whatsapp_connections')")
  assert.ok(phoneGuard > -1 && connectionLookup > phoneGuard)
})

// --- Template: nunca envia sem aprovação confirmada -------------------------------------------------
test('template: exige status APPROVED e is_active antes de qualquer envio', () => {
  assert.match(worker, /if\(!template\.data\|\|String\(template\.data\.status\)\.toUpperCase\(\)!=='APPROVED'\|\|template\.data\.is_active===false\)throw new Error/)
})

// --- Falha da Meta: nunca marca sent sem provider_message_id confirmado ----------------------------
test('falha Meta: sem providerId marca failed (nunca sent) e agenda retry; resultado desconhecido nunca reenvia sozinho', () => {
  assert.match(worker, /if\(!response\.ok\|\|!providerId\)\{await Promise\.all\(\[admin\.from\('whatsapp_messages'\)\.update\(\{status:'failed'/)
  assert.match(worker, /next_attempt_at:new Date\(Date\.now\(\)\+5\*60_000\)\.toISOString\(\)/)
  // Timeout/erro de rede (catch) marca ação como "unconfirmed" e propaga erro — nunca reenvia sozinho.
  assert.match(worker, /catch\{await admin\.from\('whatsapp_collection_alerts'\)\.update\(\{action:'template_send_unconfirmed',error_code:'SEND_OUTCOME_UNKNOWN'/)
})

// --- Sucesso: só marca sent com provider_message_id real da Meta -----------------------------------
test('sucesso: só marca sent com provider_message_id vindo da resposta real da Meta', () => {
  assert.match(worker, /provider_message_id:providerId,status:'sent'/)
  assert.match(worker, /const body=await response\.json\(\)\.catch\(\(\)=>\(\{\}\)\),providerId=clean\(body\?\.messages\?\.\[0\]\?\.id,240\)/)
})

// --- Reconciliação: idempotency_key existente com provider_message_id nunca reenvia à Meta ---------
test('reconciliação: idempotency_key com provider_message_id já existente pula o envio, só sincroniza o alerta', () => {
  assert.match(worker, /if\(prior\.data\?\.provider_message_id\)\{await admin\.from\('whatsapp_collection_alerts'\)\.update\(\{status:'sent',collection_stage:'waiting_customer',action:'template_sent',provider_message_id:prior\.data\.provider_message_id,sent_at:now\}\)\.eq\('id',alert\.id\);return true\}/)
})

// --- Não depende de curl/Render: envia direto para o Graph API da Meta -----------------------------
test('transporte: envia direto para graph.facebook.com, nunca via Render/MugoZap legado', () => {
  assert.match(worker, /https:\/\/graph\.facebook\.com\/\$\{Deno\.env\.get\('GRAPH_API_VERSION'\)\|\|'v23\.0'\}/)
  assert.doesNotMatch(worker, /onrender\.com/)
})

// --- FIX: whatsapp_collection_alerts.currency não pode ser hardcoded quando a parcela é EUR --------
test('currency (Latina/EUR): mugozap-api usa a moeda real da parcela, não hardcoda BRL', () => {
  assert.match(mugozapApi, /invoice_installments'\)\.select\('id,organization_id,client_id,contract_id,status,due_date,amount,currency,received_amount,paid_at'\)/)
  assert.match(mugozapApi, /currency:text\(installment\.currency,3\)\|\|'BRL'/)
  assert.doesNotMatch(mugozapApi, /currency:'BRL'/)
})

console.log('Collection notification worker contracts: ok')
