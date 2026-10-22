// Importação de prospects por CSV (export do Apollo, Casa dos Dados, Sales Navigator via ferramenta, planilha própria).

/** CSV simples com aspas, vírgula ou ponto e vírgula (detectado pela 1ª linha). */
export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] || ''
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1
      row.push(field); field = ''
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
    } else field += char
  }
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  if (rows.length < 2) return []
  const headers = rows[0].map((header) => header.trim())
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || '').trim()])))
}

const fold = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const FIELD_ALIASES = {
  company_name: ['company', 'company name', 'empresa', 'nome fantasia', 'nome da empresa', 'organization', 'account name', 'razao social'],
  website: ['website', 'site', 'company website', 'url', 'dominio', 'domain'],
  instagram: ['instagram', 'ig'],
  linkedin_company_url: ['company linkedin url', 'linkedin empresa', 'company linkedin'],
  cnpj: ['cnpj'],
  segment: ['industry', 'segmento', 'setor', 'nicho', 'cnae descricao', 'atividade principal'],
  city: ['city', 'cidade', 'municipio'],
  state: ['state', 'estado', 'uf'],
  contact_first: ['first name', 'primeiro nome'],
  contact_last: ['last name', 'sobrenome'],
  contact_name: ['name', 'nome', 'full name', 'nome completo', 'contato', 'decisor'],
  contact_role: ['title', 'cargo', 'job title', 'funcao', 'position'],
  contact_linkedin_url: ['person linkedin url', 'linkedin', 'linkedin url', 'perfil linkedin', 'profile url'],
  contact_email: ['email', 'e mail', 'work email', 'email do contato', 'correio eletronico'],
  contact_phone: ['phone', 'telefone', 'mobile phone', 'celular', 'whatsapp', 'work direct phone', 'corporate phone'],
}

export function normalizeProspectRow(raw) {
  const byKey = new Map(Object.entries(raw || {}).map(([key, value]) => [fold(key), String(value || '').trim()]))
  const pick = (field) => { for (const alias of FIELD_ALIASES[field]) { const value = byKey.get(alias); if (value) return value } return '' }
  const fantasia = byKey.get('nome fantasia')
  const company = fantasia || pick('company_name')
  if (!company) return null
  const name = [pick('contact_first'), pick('contact_last')].filter(Boolean).join(' ') || pick('contact_name')
  const email = pick('contact_email').toLowerCase()
  const website = pick('website').replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return {
    company_name: company.slice(0, 240),
    website: website || null,
    instagram: pick('instagram') || null,
    linkedin_company_url: pick('linkedin_company_url') || null,
    cnpj: pick('cnpj').replace(/\D/g, '') || null,
    segment: pick('segment') || null,
    city: pick('city') || null,
    state: pick('state') || null,
    contact_name: name || null,
    contact_role: pick('contact_role') || null,
    contact_linkedin_url: /linkedin\.com\//i.test(pick('contact_linkedin_url')) ? pick('contact_linkedin_url') : null,
    contact_email: /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) ? email : null,
    contact_phone: pick('contact_phone').replace(/[^\d+]/g, '') || null,
  }
}
