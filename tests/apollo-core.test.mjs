import test from 'node:test'
import assert from 'node:assert/strict'
import { APOLLO_PRESETS, buildApolloSearchBody, looksLikeAgency, matchToProspect, normalizeSearchPerson, apolloErrorMessage } from '../supabase/functions/_shared/apolloCore.js'
import { profileLinksRule } from '../supabase/functions/_shared/prospectingCore.js'

test('corpo da busca do Apollo a partir dos filtros', () => {
  const body = buildApolloSearchBody({ titles: 'CEO, Founder', keywords: ['loja online', ''], locations: 'São Paulo, Brazil', employees: ['11,20', 'x'], technologies: 'Shopify, Loja Integrada', page: 3 })
  assert.deepEqual(body.person_titles, ['CEO', 'Founder'])
  assert.equal(body.include_similar_titles, true)
  assert.deepEqual(body.q_organization_keyword_tags, ['loja online'])
  assert.deepEqual(body.organization_locations, ['São Paulo', 'Brazil'])
  assert.deepEqual(body.organization_num_employees_ranges, ['11,20'])
  assert.deepEqual(body.currently_using_any_of_technology_uids, ['shopify', 'loja_integrada'])
  assert.equal(body.page, 3); assert.equal(body.per_page, 25)
  assert.ok(APOLLO_PRESETS.moda_beleza.titles.includes('CEO'))
})

test('resultado da busca e pessoa revelada', () => {
  const row = normalizeSearchPerson({ id: 'p1', first_name: 'Marcelo', last_name_obfuscated: 'Po***o', title: 'CEO', organization: { name: 'Tuff', website_url: 'http://www.tuffoficial.com.br/' } })
  assert.deepEqual([row.apollo_id, row.last_name, row.company, row.website, row.maybe_agency], ['p1', 'Po***o', 'Tuff', 'tuffoficial.com.br', false])
  assert.equal(looksLikeAgency('Octopuz Marketing'), true)
  const prospect = matchToProspect({ first_name: 'Marcelo', last_name: 'Porto', title: 'CEO', linkedin_url: 'http://www.linkedin.com/in/marcelo', email: 'email_not_unlocked@domain.com', organization: { name: 'Tuff', website_url: 'https://tuffoficial.com.br', industry: 'apparel & fashion' } }, { listId: 'l1' })
  assert.equal(prospect.contact_linkedin_url, 'https://www.linkedin.com/in/marcelo')
  assert.equal(prospect.contact_email, null)
  assert.equal(prospect.source, 'apollo'); assert.equal(prospect.list_id, 'l1'); assert.equal(prospect.contact_name, 'Marcelo Porto')
  assert.equal(matchToProspect({}), null)
  assert.match(apolloErrorMessage(403, { error: 'x' }), /APOLLO_API_KEY/)
})

test('mensagem pós-aceite convida para a newsletter (nunca na nota)', () => {
  const rule = profileLinksRule({ newsletter_url: 'https://crm.mugoagencia.com.br/news?utm_source=linkedin', mugo_instagram_url: 'https://instagram.com/mugo' })
  assert.match(rule, /Link preferido.*newsletter/)
  assert.match(rule, /Nunca coloque link na nota de conexão/)
  assert.match(rule, /Instagram da Mugô/)
})

test('plano grátis: prospect com os dados da busca (sobrenome mascarado vai para a nota)', async () => {
  const { searchRowToProspect } = await import('../supabase/functions/_shared/apolloCore.js')
  const row = searchRowToProspect({ apollo_id: 'p1', first_name: 'Marcelo', last_name: 'Po***o', title: 'CEO', company: 'Tuff', website: 'tuffoficial.com.br', city: 'Jacareí' }, { listId: 'l1' })
  assert.equal(row.contact_name, 'Marcelo')
  assert.match(row.notes, /Po\*\*\*o/)
  assert.equal(row.contact_linkedin_url, null)
  assert.equal(searchRowToProspect({ company: 'Loja', first_name: 'Ana', last_name: 'Souza' }).contact_name, 'Ana Souza')
})
