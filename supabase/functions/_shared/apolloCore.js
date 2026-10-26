// Busca de prospects no Apollo direto do CRM (função prospecting, ações apollo_search / apollo_import).
// A busca do Apollo não gasta crédito, mas devolve o sobrenome mascarado e sem LinkedIn/e-mail;
// trazer a pessoa para o CRM usa o "match" (1 crédito), que revela LinkedIn e e-mail.
// Tudo aqui é puro para testar com node --test.

export const APOLLO_SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search'
export const APOLLO_MATCH_URL = 'https://api.apollo.io/api/v1/people/match'
export const MAX_IMPORT = 25

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max)
const list = (value, max = 15) => (Array.isArray(value) ? value : String(value || '').split(/[,;\n]/))
  .map((item) => clean(item, 120)).filter(Boolean).slice(0, max)

export const EMPLOYEE_RANGES = ['1,10', '11,20', '21,50', '51,100', '101,200', '201,500', '501,1000']

const DECISION_TITLES = ['Founder', 'Co-Founder', 'CEO', 'Owner', 'Sócio', 'Sócio Fundador', 'Diretor', 'Head of Marketing', 'Marketing Manager', 'Gerente de Marketing']
export const APOLLO_PRESETS = Object.freeze({
  moda_beleza: { label: 'E-commerce de moda e beleza', titles: [...DECISION_TITLES, 'Head of E-commerce'], keywords: ['loja online', 'e-commerce', 'moda feminina', 'moda masculina', 'skincare', 'cosméticos', 'perfumaria'], employees: ['11,20', '21,50', '51,100', '101,200'], technologies: ['shopify', 'vtex', 'nuvemshop', 'tray', 'woocommerce'] },
  casa: { label: 'Casa, decoração e bem-estar', titles: [...DECISION_TITLES, 'Head of E-commerce'], keywords: ['loja online', 'decoração', 'cama mesa e banho', 'bem-estar', 'suplementos'], employees: ['11,20', '21,50', '51,100', '101,200'], technologies: ['shopify', 'vtex', 'nuvemshop', 'tray', 'woocommerce'] },
  gestoras: { label: 'Gestoras de investimento', titles: ['Sócio', 'Partner', 'CEO', 'Diretor', 'Head of Marketing', 'Relações com Investidores', 'Investor Relations'], keywords: ['gestora de recursos', 'asset management', 'wealth management', 'family office', 'fundos de investimento'], employees: ['11,20', '21,50', '51,100', '101,200', '201,500'], technologies: [] },
  criadores: { label: 'Artistas e criadores', titles: ['Founder', 'CEO', 'Manager', 'Empresário', 'Artista', 'Produtor'], keywords: ['artista', 'cantor', 'produtora musical', 'music label', 'creator', 'entretenimento'], employees: ['1,10', '11,20', '21,50'], technologies: [] },
})

/** Monta o corpo da busca do Apollo a partir dos filtros da tela. */
export function buildApolloSearchBody(filters = {}) {
  const page = Math.max(1, Math.min(500, Math.round(Number(filters.page) || 1)))
  const body = { page, per_page: 25 }
  const titles = list(filters.titles)
  const keywords = list(filters.keywords)
  const locations = list(filters.locations, 5)
  const employees = list(filters.employees, 7).filter((range) => EMPLOYEE_RANGES.includes(range))
  const technologies = list(filters.technologies, 10).map((tech) => tech.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
  if (titles.length) { body.person_titles = titles; body.include_similar_titles = true }
  if (keywords.length) body.q_organization_keyword_tags = keywords
  if (locations.length) body.organization_locations = locations
  if (employees.length) body.organization_num_employees_ranges = employees
  if (technologies.length) body.currently_using_any_of_technology_uids = technologies
  return body
}

const AGENCY = /\b(ag[eê]ncia|agency|marketing|publicidade|propaganda|comunica[cç][aã]o|digital|consultoria|consulting|software|tecnologia|sistemas)\b/i
export const looksLikeAgency = (companyName) => AGENCY.test(String(companyName || ''))

const domainOf = (value) => clean(value, 300).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')

/** Linha da busca (sobrenome pode vir mascarado). */
export function normalizeSearchPerson(person = {}) {
  const org = person.organization || {}
  const company = clean(org.name || person.organization_name, 240)
  return {
    apollo_id: clean(person.id, 80),
    first_name: clean(person.first_name, 80),
    last_name: clean(person.last_name || person.last_name_obfuscated, 80),
    title: clean(person.title, 160),
    company,
    website: domainOf(org.website_url || org.primary_domain || ''),
    city: clean(person.city || org.city, 80),
    state: clean(person.state || org.state, 80),
    has_email: Boolean(person.has_email ?? person.email),
    maybe_agency: looksLikeAgency(company),
  }
}

/** Pessoa revelada pelo match → linha da tabela prospects. */
export function matchToProspect(person = {}, { listId = null } = {}) {
  const org = person.organization || {}
  const company = clean(org.name || person.organization_name, 240)
  if (!company) return null
  const linkedin = clean(person.linkedin_url, 300)
  const email = clean(person.email, 320).toLowerCase()
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) && !/email_not_unlocked|domain\.com$/i.test(email) && person.email_status !== 'unavailable'
  return {
    list_id: listId,
    source: 'apollo',
    company_name: company,
    website: domainOf(org.website_url || org.primary_domain || '') || null,
    linkedin_company_url: clean(org.linkedin_url, 300) || null,
    segment: clean(org.industry, 120) || null,
    city: clean(person.city || org.city, 80) || null,
    state: clean(person.state || org.state, 80) || null,
    contact_name: [clean(person.first_name, 80), clean(person.last_name, 80)].filter(Boolean).join(' ') || null,
    contact_role: clean(person.title, 160) || null,
    contact_linkedin_url: /linkedin\.com\//i.test(linkedin) ? linkedin.replace(/^http:/, 'https:') : null,
    contact_email: emailOk ? email : null,
  }
}

export function apolloErrorMessage(status, body = {}) {
  const detail = clean(body?.error || body?.message || '', 200)
  if (status === 401 || status === 403) return `O Apollo recusou a chave (${status}). Confira o APOLLO_API_KEY e se a conta tem acesso à API.${detail ? ` Detalhe: ${detail}` : ''}`
  if (status === 422) return `O Apollo não aceitou a busca${detail ? `: ${detail}` : '.'} (a busca pela API pode exigir conta com e-mail de trabalho).`
  if (status === 429) return 'Limite do Apollo atingido por agora. Tente de novo em alguns minutos.'
  return `O Apollo respondeu ${status}${detail ? `: ${detail}` : ''}.`
}

/** Sem acesso ao match (plano grátis): monta o prospect só com o que a busca devolveu. */
export function searchRowToProspect(row = {}, { listId = null } = {}) {
  const company = clean(row.company, 240)
  if (!company) return null
  const last = clean(row.last_name, 80)
  return {
    list_id: listId,
    source: 'apollo',
    company_name: company,
    website: domainOf(row.website) || null,
    city: clean(row.city, 80) || null,
    state: clean(row.state, 80) || null,
    contact_name: [clean(row.first_name, 80), /\*/.test(last) ? '' : last].filter(Boolean).join(' ') || null,
    contact_role: clean(row.title, 160) || null,
    contact_linkedin_url: null,
    contact_email: null,
    notes: last && /\*/.test(last) ? `Apollo: sobrenome ${last} (mascarado no plano grátis).` : null,
  }
}
