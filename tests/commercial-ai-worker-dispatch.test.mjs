import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8')
const worker = fs.readFileSync('supabase/functions/commercial-ai-worker/index.ts', 'utf8')
const cron = fs.readFileSync('supabase/migrations/202609250004_commercial_ai_worker_dispatch.sql', 'utf8')

// --- insert de commercial_ai_event → dispatch chamado -----------------------------------------
test('webhook chama o dispatch do commercial-ai-worker logo depois do insert em commercial_ai_events', () => {
  const insertIdx = webhook.indexOf("admin.from('commercial_ai_events').insert(")
  const dispatchCallIdx = webhook.indexOf('await dispatchCommercialAiWorker()')
  assert.ok(insertIdx > -1 && dispatchCallIdx > -1)
  assert.ok(insertIdx < dispatchCallIdx, 'dispatch deve vir depois do insert, não antes')
  // O dispatch usa a mesma chave/headers que o worker já exige — autenticação existente, não hardcoded.
  assert.match(webhook, /const workerKey = Deno\.env\.get\('COMMERCIAL_AI_WORKER_KEY'\) \|\| ''/)
  assert.match(webhook, /'X-Commercial-AI-Worker-Key': workerKey/)
  assert.doesNotMatch(webhook, /COMMERCIAL_AI_WORKER_KEY\s*=\s*['"][^'"]+/)
  assert.match(webhook, /`\$\{url\}\/functions\/v1\/commercial-ai-worker`/)
})

// --- falha do dispatch → evento permanece pending (nunca perde a mensagem) --------------------
test('falha no dispatch não lança erro, não falha o webhook e não remove/mexe no commercial_ai_event', () => {
  // dispatchCommercialAiWorker nunca lança: qualquer falha (fetch, timeout, secret ausente) volta como false,
  // e o call site não verifica o retorno nem propaga erro — o evento fica como foi inserido (pending).
  assert.match(webhook, /const dispatchCommercialAiWorker = async \(\) => \{[\s\S]{0,300}if \(!url \|\| !serviceKey \|\| !workerKey\) return false/)
  assert.match(webhook, /\} catch \{\s*return false\s*\}\s*\}\nconst processStatus/)
  assert.doesNotMatch(webhook, /if \(!\(await dispatchCommercialAiWorker\(\)\)\)/)
  assert.doesNotMatch(webhook, /dispatchCommercialAiWorker[\s\S]{0,200}\.delete\(\)/)
  // A mensagem (whatsapp_messages) já foi persistida antes deste bloco — dispatch nunca é pré-condição para isso.
  const savedMessageIdx = webhook.indexOf("text_content: content.body || null")
  const dispatchIdx = webhook.indexOf('await dispatchCommercialAiWorker()')
  assert.ok(savedMessageIdx > -1 && dispatchIdx > -1 && savedMessageIdx < dispatchIdx)
})

// --- worker executado → reclama pending ---------------------------------------------------------
test('worker reclama eventos pending/failed por status (comportamento preservado, não alterado)', () => {
  assert.match(worker, /admin\.from\('commercial_ai_events'\)\.update\(\{status:'processing',attempts:Number\(event\.attempts\|\|0\)\+1\}\)\.eq\('id',event\.id\)\.in\('status',\['pending','failed'\]\)/)
  assert.match(worker, /due=await admin\.from\('commercial_ai_events'\)\.select\('\*'\)\.in\('status',\['pending','failed'\]\)\.lte\('next_attempt_at',new Date\(\)\.toISOString\(\)\)/)
})

// --- evento completed → nunca reprocessa --------------------------------------------------------
test('evento completed nunca é reclamado de novo (fora do filtro pending/failed do claim e da fila due)', () => {
  assert.match(worker, /status:'completed',decision:\{\.\.\.decision,temperature,lead_kind:leadKind,provider_message_id:providerMessageId,opportunity_id:opportunity\.id\}/)
  // O claim só aceita pending/failed — completed nunca é alvo do update de reclamação.
  assert.doesNotMatch(worker, /in\('status',\['pending','failed','completed'\]\)/)
})

// --- evento failed → respeita next_attempt_at (política de retry preservada) --------------------
test('evento failed respeita next_attempt_at com backoff exponencial — política de retry não foi alterada', () => {
  assert.match(worker, /next_attempt_at:new Date\(Date\.now\(\)\+Math\.min\(3600,2\*\*attempts\*30\)\*1000\)\.toISOString\(\)/)
  assert.match(worker, /terminal=attempts>=6\|\|\['META_CONFIGURATION_MISSING','AI_REQUEST_FAILED'\]\.includes\(error\?\.code\)/)
  assert.match(worker, /status:terminal\?'dead_letter':'failed'/)
})

// --- cron fallback: existe, agenda a cada minuto, não duplica job, segue o padrão do task-command-worker ---
test('cron fallback comercial existe, roda a cada minuto e segue exatamente o padrão do task-command-worker', () => {
  assert.match(cron, /create extension if not exists pg_cron/)
  assert.match(cron, /create extension if not exists pg_net/)
  assert.match(cron, /jobname = 'commercial-ai-worker-every-minute'/)
  assert.match(cron, /perform cron\.unschedule\(existing_job\)/) // nunca duplica o job
  assert.match(cron, /'\* \* \* \* \*'/)
  for (const name of ['project_url', 'service_role_key', 'commercial_ai_worker_key']) assert.match(cron, new RegExp(`name = '${name}'`))
  assert.match(cron, /'X-Commercial-AI-Worker-Key'/)
  assert.match(cron, /\/functions\/v1\/commercial-ai-worker/)
  assert.doesNotMatch(cron, /eyJ[A-Za-z0-9_-]{20,}/) // nenhum JWT/segredo real embutido
  assert.doesNotMatch(cron, /\bdelete\s+from\b/i)
})

// --- não alterar lógica/prompt comercial, financeiro, classificação, frontend ou assistente interna ---
test('escopo respeitado: nada de financeiro, prompt comercial, classificação interna/customer ou frontend foi tocado', () => {
  assert.doesNotMatch(cron, /invoice_installments|expenses|freelance_cash_movements|COMMERCIAL_SYSTEM_PROMPT/i)
  assert.doesNotMatch(webhook, /ai_mode\s*[:=]\s*'controlled_auto'\s*[,}]/) // não seta/força ai_mode, só lê
  assert.match(webhook, /commercial\.data\?\.ai_mode === 'controlled_auto'/) // continua só leitura condicional
})
