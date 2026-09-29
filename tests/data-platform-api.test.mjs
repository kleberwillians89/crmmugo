import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const api = fs.readFileSync(new URL('../supabase/functions/data-platform-api/index.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase/migrations/202609290001_external_integrations.sql', import.meta.url), 'utf8')

// --- Identidade: nunca aceita organization_id do chamador, só external_client_id -------------------
test('tenant: organization_id nunca vem do chamador — só é resolvido via external_integrations', () => {
  assert.doesNotMatch(api, /searchParams\.get\('organization_id'\)/)
  assert.match(api, /const externalClientId = text\(url\.searchParams\.get\('external_client_id'\), 200\)/)
  assert.match(api, /\.eq\('provider', 'mugo_dados'\)\.eq\('external_client_id', externalClientId\)\.eq\('status', 'active'\)\.maybeSingle\(\)/)
})

// --- CLIENT_A tenta CLIENT_B → 403 -------------------------------------------------------------------
test('CLIENT_A não resolve CLIENT_B: external_client_id desconhecido/inativo nunca retorna dado, só 403', () => {
  assert.match(api, /if \(!integration\.data\) return json\(\{ ok: false, code: 'UNKNOWN_EXTERNAL_CLIENT' \}, 403\)/)
  // Toda query subsequente usa o organizationId RESOLVIDO, nunca um valor vindo da querystring.
  const afterLookup = api.slice(api.indexOf('const organizationId = integration.data.organization_id'))
  assert.doesNotMatch(afterLookup, /searchParams\.get\('organization_id'\)/)
})

// --- Autenticação: sem chave correta, nunca processa ------------------------------------------------
test('autenticação: sem X-Data-Platform-Key correta, 401 antes de qualquer query', () => {
  assert.match(api, /if \(!expectedKey \|\| request\.headers\.get\('X-Data-Platform-Key'\) !== expectedKey\) return json\(\{ ok: false, code: 'UNAUTHORIZED' \}, 401\)/)
  // Dentro do handler HTTP (Deno.serve), a checagem de chave vem antes de qualquer query — comparado
  // só dentro desse bloco, já que as funções handleFunnel/handleAttribution/handleRevenue são
  // declaradas antes no arquivo mas só executam depois de autenticar.
  const serveBlock = api.slice(api.indexOf('Deno.serve('))
  const authIdx = serveBlock.indexOf('X-Data-Platform-Key')
  const firstQueryIdx = serveBlock.indexOf('admin.from(')
  assert.ok(authIdx > -1 && firstQueryIdx > authIdx)
})

// --- Nunca expõe service_role nem aceita JWT de usuário final ---------------------------------------
test('nunca expõe service_role ao chamador; nunca autentica por JWT de usuário final (só a chave de API)', () => {
  // serviceKey só é usado para criar o client admin — nunca aparece dentro de um json({...}) de resposta.
  const jsonPayloads = [...api.matchAll(/json\(\{[^)]*\}, \d+\)/g)].map((m) => m[0])
  for (const payload of jsonPayloads) assert.doesNotMatch(payload, /serviceKey|SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(api, /auth\.getUser/)
})

// --- Período obrigatório e validado -------------------------------------------------------------------
test('período: exige period_start/period_end em formato ISO válido, e start<=end', () => {
  assert.match(api, /if \(!isIsoDate\(periodStart\) \|\| !isIsoDate\(periodEnd\)\) return json\(\{ ok: false, code: 'INVALID_PERIOD' \}, 400\)/)
  assert.match(api, /if \(periodEnd < periodStart\) return json\(\{ ok: false, code: 'INVALID_PERIOD_RANGE' \}, 400\)/)
})

// --- Funil: proposal != sale; nunca infere venda de conversa ----------------------------------------
test('funil: proposals sem sent_at não contam como proposta; won/lost só de proposals.status, nunca de conversa', () => {
  assert.match(api, /\.not\('sent_at', 'is', null\)\.gte\('sent_at', start\)\.lte\('sent_at', end\)/)
  assert.match(api, /won_sales: proposals\.data\.filter\(\(row: any\) => row\.status === 'won'\)\.length/)
  assert.match(api, /lost_sales: proposals\.data\.filter\(\(row: any\) => row\.status === 'lost'\)\.length/)
  assert.doesNotMatch(api, /whatsapp_messages|conversation_summaries|internal_notes/)
})

// --- Revenue: sale != received cash; nunca soma moedas diferentes; nunca converte EUR ---------------
test('revenue: revenue (proposta ganha) e received_revenue (parcela paga) vêm de tabelas diferentes; moedas nunca somadas/convertidas', () => {
  assert.match(api, /admin\.from\('proposals'\)\.select\('total_value'\)\.eq\('organization_id', org\)\.eq\('status', 'won'\)/)
  assert.match(api, /admin\.from\('invoice_installments'\)\.select\('amount,original_amount,currency'\)\.eq\('organization_id', org\)\.eq\('status', 'paid'\)/)
  assert.match(api, /const value = currency === 'BRL' \? Number\(row\.amount \|\| 0\) : Number\(row\.original_amount \|\| 0\)/)
  assert.doesNotMatch(api, /exchange_rate|conversionRate|\* 1\.0\d/)
})

// --- Atribuição: origem desconhecida permanece desconhecida -----------------------------------------
test('atribuição: agrupa por source/campaign/utm reais das oportunidades; nunca adivinha canal', () => {
  assert.match(api, /select\('id,source,campaign,utm_source,utm_medium,utm_campaign,stage'\)/)
  assert.match(api, /row\.source \|\| null, row\.campaign \|\| null, row\.utm_source \|\| null/)
})

// --- Paginação --------------------------------------------------------------------------------------
test('paginação: attribution aceita limit com teto (nunca lista ilimitada)', () => {
  assert.match(api, /const clampLimit = \(value: unknown, fallback = 100, max = 500\)/)
  assert.match(api, /groups: \[\.\.\.groups\.values\(\)\]\.slice\(0, limit\)/)
})

// --- Logs sem PII -------------------------------------------------------------------------------------
test('logs: nunca registram conteúdo de mensagem ou nome de cliente — só organization_id/endpoint/duração', () => {
  const logLines = [...api.matchAll(/console\.log\(JSON\.stringify\(\{([^}]*)\}\)\)/g)].map((m) => m[1])
  for (const line of logLines) assert.doesNotMatch(line, /text_content|company_name|contact_name|profile_name/)
})

// --- Migration: nenhum secret na tabela; vínculo único por organização+provedor ----------------------
test('migration external_integrations: sem colunas de secret; unique por organization+provider e por provider+external_client_id', () => {
  const createTableBlock = migration.slice(migration.indexOf('create table if not exists public.external_integrations('), migration.indexOf(');') + 2)
  assert.doesNotMatch(createTableBlock, /secret|api_key|token/i)
  assert.match(migration, /unique\(organization_id, provider\)/)
  assert.match(migration, /unique\(provider, external_client_id\)/)
  assert.match(migration, /provider text not null check\(provider in\('mugo_dados'\)\)/)
})

// --- Migration: somente admin configura ---------------------------------------------------------------
test('migration external_integrations: RLS restringe a is_admin() — perfil comum não pode configurar', () => {
  assert.match(migration, /using\(organization_id=public\.current_organization_id\(\) and public\.is_admin\(\)\)/)
  assert.match(migration, /with check\(organization_id=public\.current_organization_id\(\) and public\.is_admin\(\)\)/)
})

console.log('CRM Data Bridge (external_integrations + data-platform-api): ok')
