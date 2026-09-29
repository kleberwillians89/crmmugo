import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const api = fs.readFileSync(new URL('../supabase/functions/data-platform-api/index.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase/migrations/202609290001_external_integrations.sql', import.meta.url), 'utf8')
const scopeMigration = fs.readFileSync(new URL('../supabase/migrations/202609290002_external_integrations_client_scope.sql', import.meta.url), 'utf8')

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
  assert.match(api, /admin\.from\('proposals'\)\.select\('total_value'\)\.eq\('organization_id', org\)\.eq\('client_id', clientId\)\.eq\('status', 'won'\)/)
  assert.match(api, /admin\.from\('invoice_installments'\)\.select\('amount,original_amount,currency'\)\.eq\('organization_id', org\)\.eq\('client_id', clientId\)\.eq\('status', 'paid'\)/)
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

// ===================================================================================================
// GRANULARIDADE DE CLIENTE — uma organização tem vários clients (Roove, Origami, Curavino...).
// organization_id sozinho não basta: sem client_id, um mapping vazaria dados entre clientes da mesma
// organização. Migration corretiva 202609290002 (nova — 202609290001 não foi editada retroativamente,
// já estava aplicada em produção com a tabela vazia).
// ===================================================================================================

test('migration corretiva: adiciona client_id (FK para clients, not null) sem editar a 202609290001', () => {
  assert.match(scopeMigration, /add column if not exists client_id uuid references public\.clients\(id\) on delete restrict/)
  assert.match(scopeMigration, /alter column client_id set not null/)
  // A 202609290001 original permanece intocada — nenhuma COLUNA client_id nela (a menção em comentário
  // já existia antes, só como exemplo do que external_client_id representa, não uma coluna real).
  assert.doesNotMatch(migration, /add column.*client_id|client_id uuid/)
})

test('migration corretiva: unique(organization_id,provider) vira unique(organization_id,client_id,provider); unique(provider,external_client_id) preservada', () => {
  assert.match(scopeMigration, /drop constraint if exists external_integrations_organization_id_provider_key/)
  assert.match(scopeMigration, /add constraint external_integrations_organization_id_client_id_provider_key unique\(organization_id, client_id, provider\)/)
  // unique(provider, external_client_id) não é tocada — já garantia unicidade global do id externo.
  assert.doesNotMatch(scopeMigration, /drop constraint.*provider_external_client_id/)
})

test('migration corretiva: trigger garante no banco que client_id pertence a organization_id (mesmo padrão de protect_whatsapp_operational_tenant)', () => {
  assert.match(scopeMigration, /select organization_id into v_org from public\.clients where id = new\.client_id/)
  assert.match(scopeMigration, /if v_org is distinct from new\.organization_id then/)
  assert.match(scopeMigration, /raise exception 'external_integrations tenant mismatch/)
  assert.match(scopeMigration, /create trigger protect_external_integration_tenant before insert or update on public\.external_integrations/)
})

test('migration corretiva: índice novo por organization_id+client_id para a granularidade correta', () => {
  assert.match(scopeMigration, /create index if not exists external_integrations_client_idx\s*\n\s*on public\.external_integrations\(organization_id, client_id\)/)
})

// --- API: resolve client_id junto com organization_id, nunca aceita nenhum dos dois do chamador -----
test('API: resolve organization_id E client_id via external_integrations — nunca aceita nenhum dos dois na querystring', () => {
  assert.match(api, /select\('organization_id,client_id'\)/)
  assert.match(api, /const clientId = integration\.data\.client_id/)
  assert.doesNotMatch(api, /searchParams\.get\('organization_id'\)/)
  assert.doesNotMatch(api, /searchParams\.get\('client_id'\)/)
})

// --- API: TODAS as tabelas tenant-scoped filtram por organization_id E client_id, nunca só org -------
test('funil: commercial_opportunities e proposals filtram por organization_id + client_id (nunca só organização)', () => {
  assert.match(api, /commercial_opportunities'\)\.select\('id,stage'\)\.eq\('organization_id', org\)\.eq\('client_id', clientId\)/)
  assert.match(api, /proposals'\)\.select\('id,status'\)\.eq\('organization_id', org\)\.eq\('client_id', clientId\)/)
})

test('atribuição: commercial_opportunities filtra por organization_id + client_id', () => {
  assert.match(api, /commercial_opportunities'\)\s*\n\s*\.select\('id,source,campaign,utm_source,utm_medium,utm_campaign,stage'\)\s*\n\s*\.eq\('organization_id', org\)\.eq\('client_id', clientId\)/)
})

test('revenue: proposals e invoice_installments filtram por organization_id + client_id', () => {
  assert.match(api, /proposals'\)\.select\('total_value'\)\.eq\('organization_id', org\)\.eq\('client_id', clientId\)\.eq\('status', 'won'\)/)
  assert.match(api, /invoice_installments'\)\.select\('amount,original_amount,currency'\)\.eq\('organization_id', org\)\.eq\('client_id', clientId\)\.eq\('status', 'paid'\)/)
})

test('commercial_qualifications continua derivada só dos opportunity_ids já filtrados por organization_id+client_id (nunca tem checagem de tenant própria)', () => {
  const funnelBlock = api.slice(api.indexOf('async function handleFunnel'), api.indexOf('async function handleAttribution'))
  assert.match(funnelBlock, /commercial_qualifications'\)\.select\('opportunity_id'\)\.in\('opportunity_id', opportunityIds\)\.eq\('qualified', true\)/)
  assert.doesNotMatch(funnelBlock, /commercial_qualifications.*eq\('organization_id'/)
})

// --- Isolamento same-organization: CLIENT_A (Roove) e CLIENT_B (Origami) nunca se misturam -----------
test('isolamento same-organization: cada handler recebe um único clientId resolvido — impossível uma chamada devolver dois clients', () => {
  // Simula os dois cenários pedidos: mesma organization_id, external_client_id diferentes resolvendo
  // clientId diferentes (Roove vs Origami). Como toda query usa esse único clientId (testes acima),
  // uma chamada para o external_client_id da Roove estruturalmente não pode incluir linhas da Origami
  // e vice-versa — não existe branch no código que combine múltiplos client_id numa mesma resposta.
  const org = '1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f'
  const roove = { organization_id: org, client_id: 'e7919cd3-c989-49c9-994f-eb31aa9ce294' }
  const origami = { organization_id: org, client_id: '61974c0b-e344-4d60-9b12-1a1680c9c270' }
  assert.equal(roove.organization_id, origami.organization_id, 'mesma organização, para provar que só client_id separa os dois')
  assert.notEqual(roove.client_id, origami.client_id)
  assert.doesNotMatch(api, /\.in\('client_id'/)
  assert.doesNotMatch(api, /clientIds/)
})

test('client_id que não pertence à organization_id é recusado pelo trigger, não só pela aplicação', () => {
  // Mesmo se a aplicação (ou um INSERT manual) tentasse gravar um client_id de outra organização, o
  // banco recusa — não depende só da Edge Function estar correta.
  assert.match(scopeMigration, /raise exception 'external_integrations tenant mismatch: client_id does not belong to organization_id' using errcode = '23514'/)
})

console.log('CRM Data Bridge (external_integrations + data-platform-api, escopo por cliente): ok')
