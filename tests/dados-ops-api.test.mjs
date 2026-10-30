import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const api = fs.readFileSync(new URL('../supabase/functions/dados-ops-api/index.ts', import.meta.url), 'utf8')
const dataPlatform = fs.readFileSync(new URL('../supabase/functions/data-platform-api/index.ts', import.meta.url), 'utf8')
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
const serve = api.slice(api.indexOf('Deno.serve('))

test('autenticação: chave própria (X-Dados-Ops-Key) antes de qualquer query; nunca JWT de usuário', () => {
  assert.match(serve, /if \(!expectedKey \|\| request\.headers\.get\('X-Dados-Ops-Key'\) !== expectedKey\) return json\(\{ ok: false, code: 'UNAUTHORIZED' \}, 401\)/)
  assert.ok(serve.indexOf('X-Dados-Ops-Key') < serve.indexOf('admin.from('))
  assert.doesNotMatch(api, /auth\.getUser|X-Data-Platform-Key|DATA_PLATFORM_API_KEY/)
  assert.match(config, /\[functions\.dados-ops-api\]\nverify_jwt = false/)
})

test('somente leitura: só GET e nenhuma escrita no banco', () => {
  assert.match(serve, /if \(request\.method !== 'GET'\) return json\(\{ ok: false, code: 'METHOD_NOT_ALLOWED' \}, 405\)/)
  assert.doesNotMatch(api, /\.(insert|update|upsert|delete)\(/)
})

test('tenant: organização e cliente só vêm de external_integrations, nunca do chamador', () => {
  assert.doesNotMatch(api, /searchParams\.get\('(organization_id|client_id)'\)/)
  assert.match(serve, /\.eq\('provider', 'mugo_dados'\)\.eq\('external_client_id', externalClientId\)\.eq\('status', 'active'\)\.maybeSingle\(\)/)
  assert.match(serve, /if \(!integration\.data\) return json\(\{ ok: false, code: 'UNKNOWN_EXTERNAL_CLIENT' \}, 403\)/)
})

test('toda query de tarefa/contato filtra organização E cliente', () => {
  assert.match(api, /from\('crm_tasks'\)[\s\S]*?\.eq\('organization_id', org\)\.eq\('client_id', clientId\)/)
  assert.match(api, /from\('whatsapp_contacts'\)\.select\('id,display_name,profile_name,wa_id'\)\s*\.eq\('organization_id', org\)\.eq\('client_id', clientId\)/)
})

test('mensagens: conversa de outro cliente da mesma organização responde 404', () => {
  const handler = api.slice(api.indexOf('async function handleMessages'), api.indexOf('Deno.serve('))
  assert.match(handler, /\.eq\('organization_id', org\)\.eq\('client_id', clientId\)\.eq\('id', conversation\.data\.contact_id\)/)
  assert.match(handler, /if \(!contact\.data\) return json\(\{ ok: false, code: 'CONVERSATION_NOT_FOUND' \}, 404\)/)
})

test('financeiro fica fora das tarefas', () => {
  assert.match(api, /\.is\('installment_id', null\)/)
  assert.match(api, /FINANCE_CATEGORY = \/\^financ\/i/)
  assert.match(api, /filter\(\(row: any\) => !FINANCE_CATEGORY\.test/)
})

test('limites: nenhuma lista sem teto', () => {
  assert.match(api, /const clampLimit = \(value: unknown, fallback = 50, max = 200\)/)
})

test('telefone sai mascarado e logs nunca carregam texto, nome ou telefone', () => {
  assert.match(api, /phone_masked: maskPhone\(contact\.wa_id\)/)
  assert.doesNotMatch(api, /wa_id: contact|phone: contact/)
  const logs = [...api.matchAll(/console\.log\(JSON\.stringify\(\{([^}]*)\}\)\)/g)].map((m) => m[1])
  assert.ok(logs.length >= 3)
  for (const line of logs) assert.doesNotMatch(line, /text|name|phone|wa_id|content/)
})

test('a ponte de números (data-platform-api) continua sem ler conversa', () => {
  assert.doesNotMatch(dataPlatform, /whatsapp_messages|conversation_summaries|internal_notes/)
})

test('visão do cliente: só etiqueta "cliente" e sem nada interno da Mugô', () => {
  assert.match(api, /const CLIENT_TAG = 'cliente'/)
  assert.match(api, /\.filter\(\(row: any\) => !forClient \|\| hasClientTag\(row\.tags\)\)/)
  const clientBranch = api.slice(api.indexOf('if (forClient) {'), api.indexOf('const memberIds'))
  assert.match(clientBranch, /id: row\.id, title: row\.title, status: row\.status, due_date: row\.due_date, updated_at: row\.updated_at/)
  assert.doesNotMatch(clientBranch, /notes|assign|tags|category|team_members/)
})

test('telefone só volta inteiro quando o próprio Dados mandou (e com variante do 9º dígito)', () => {
  assert.match(api, /matched_phone: requested\.get\(digits\(contact\.wa_id\)\) \|\| null/)
  assert.match(api, /if \(d\.startsWith\('55'\) && d\.length === 13 && d\[4\] === '9'\) out\.add/)
  assert.match(api, /split\(','\)\.slice\(0, 30\)/)
})
