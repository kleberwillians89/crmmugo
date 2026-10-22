// Regras puras da prospecção (pesquisa, mensagens, agenda de envio, HTML do e-mail).

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max)
const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const LINKEDIN_NOTE_LIMIT = 300

export const PROSPECT_RESEARCH_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    fit_score: { type: 'integer', minimum: 0, maximum: 100, description: 'Encaixe com o cliente ideal da Mugô (0-100).' },
    fit_reason: { type: 'string', description: 'Uma frase explicando a nota.' },
    summary: { type: 'string', description: 'O que a empresa faz, para quem, porte aparente. Até 3 frases.' },
    signals: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Observações concretas e verificáveis (site, Instagram, anúncios, SEO).' },
    hook: { type: 'string', description: 'O gancho principal da abordagem: uma oportunidade concreta observada.' },
    decision_maker: {
      type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, role: { type: 'string' }, linkedin_url: { type: 'string' } },
      required: ['name', 'role', 'linkedin_url'],
    },
    linkedin_note: { type: 'string', description: `Nota do convite de conexão, no máximo ${LINKEDIN_NOTE_LIMIT} caracteres.` },
    linkedin_message: { type: 'string', description: 'Mensagem após aceitar a conexão (até 600 caracteres).' },
    email_subject: { type: 'string', description: 'Assunto curto, minúsculo, sem cara de marketing (até 60 caracteres).' },
    email_body: { type: 'string', description: 'Corpo do e-mail em texto puro, 60-120 palavras, sem saudação genérica e sem assinatura.' },
    followups: { type: 'array', maxItems: 2, items: { type: 'string' }, description: 'Dois follow-ups curtos (até 60 palavras cada), sem assinatura.' },
  },
  required: ['fit_score', 'fit_reason', 'summary', 'signals', 'hook', 'decision_maker', 'linkedin_note', 'linkedin_message', 'email_subject', 'email_body', 'followups'],
})

export function buildResearchPrompt({ prospect, settings = {}, knowledge = [], siteSignals = null, cnpjData = null, newsHooks = [] }) {
  const offers = knowledge.filter((entry) => ['empresa', 'servicos', 'cases'].includes(entry.category))
    .map((entry) => `- ${clean(entry.title, 120)}: ${clean(entry.content, 600)}`).join('\n')
  const system = [
    'Você é SDR sênior da Mugô, agência brasileira de marketing digital (SEO, social media, tráfego pago, analytics, design, sites e automação).',
    'Pesquise a empresa do prospect e escreva uma abordagem 1-a-1, em português do Brasil, que pareça escrita à mão por uma pessoa.',
    'Regras: use só fatos que você verificou (site, busca, dados fornecidos). Nada de elogio genérico, nada de "espero que esteja bem", nada de promessas de resultado.',
    'O gancho deve ser uma observação concreta e útil (ex.: site sem pixel da Meta, loja sem avaliações, Instagram sem link de compra, site lento no celular, não aparece no Google para o termo principal).',
    'Tom: direto, curioso, gentil. Uma pergunta no final, de baixo compromisso (ex.: "faz sentido eu te mandar 3 pontos que vi?").',
    `A nota do LinkedIn tem no máximo ${LINKEDIN_NOTE_LIMIT} caracteres. O e-mail é texto puro, sem links e sem assinatura (ela é adicionada depois).`,
    'Se não achar o tomador de decisão, devolva decision_maker com campos vazios. Se a empresa claramente não tem perfil, dê nota baixa e explique.',
    settings.icp ? `\nCliente ideal (ICP) definido pelo time:\n${clean(settings.icp, 1500)}` : '',
    settings.offer ? `\nO que oferecemos nesta abordagem:\n${clean(settings.offer, 1500)}` : '',
    offers ? `\nServiços e cases autorizados (cite só se fizer sentido):\n${offers}` : '',
    'Se alguma notícia da semana do setor (lista fornecida) se conectar de verdade com a empresa, você pode usá-la como gancho de atualidade — com naturalidade, sem forçar.',
    '\nAo terminar, chame a ferramenta de saída com o resultado.',
  ].filter(Boolean).join('\n')
  const facts = {
    empresa: prospect.company_name, site: prospect.website, instagram: prospect.instagram, linkedin_empresa: prospect.linkedin_company_url,
    cnpj: prospect.cnpj, segmento: prospect.segment, cidade: [prospect.city, prospect.state].filter(Boolean).join('/'),
    contato: { nome: prospect.contact_name, cargo: prospect.contact_role, linkedin: prospect.contact_linkedin_url },
    sinais_do_site: siteSignals, dados_cnpj: cnpjData, observacoes_do_time: prospect.notes,
    noticias_da_semana_no_setor: newsHooks.length ? newsHooks : undefined,
  }
  return { system, user: `Prospect:\n${JSON.stringify(facts, null, 2)}` }
}

export function normalizeResearch(raw = {}) {
  const note = clean(raw.linkedin_note, 1000)
  return {
    fit_score: Math.max(0, Math.min(100, Math.round(Number(raw.fit_score) || 0))),
    fit_reason: clean(raw.fit_reason, 500),
    summary: clean(raw.summary, 1200),
    signals: Array.isArray(raw.signals) ? raw.signals.map((item) => clean(item, 300)).filter(Boolean).slice(0, 6) : [],
    hook: clean(raw.hook, 600),
    decision_maker: {
      name: clean(raw.decision_maker?.name, 160), role: clean(raw.decision_maker?.role, 160),
      linkedin_url: /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(clean(raw.decision_maker?.linkedin_url, 300)) ? clean(raw.decision_maker.linkedin_url, 300) : '',
    },
    linkedin_note: note.length > LINKEDIN_NOTE_LIMIT ? `${note.slice(0, LINKEDIN_NOTE_LIMIT - 1).replace(/\s+\S*$/, '')}…` : note,
    linkedin_message: clean(raw.linkedin_message, 1200),
    email_subject: clean(raw.email_subject, 120),
    email_body: clean(raw.email_body, 3000),
    followups: Array.isArray(raw.followups) ? raw.followups.map((item) => clean(item, 1500)).filter(Boolean).slice(0, 2) : [],
  }
}

/** Sinais rápidos do site para a mini-auditoria (sem IA). */
export function extractSiteSignals(html = '', { url = '', elapsedMs = null } = {}) {
  const source = String(html).slice(0, 600_000)
  const lower = source.toLowerCase()
  const title = clean(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' '), 200)
  const description = clean(source.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1], 300)
  const platform = lower.includes('cdn.shopify.com') ? 'Shopify'
    : lower.includes('nuvemshop') || lower.includes('tiendanube') ? 'Nuvemshop'
      : lower.includes('vtex') ? 'VTEX'
        : lower.includes('wp-content') ? 'WordPress'
          : lower.includes('wix.com') || lower.includes('wixstatic') ? 'Wix'
            : lower.includes('lojaintegrada') ? 'Loja Integrada' : null
  const text = clean(source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '), 3500)
  return {
    url,
    https: url.startsWith('https://'),
    title,
    meta_description: description || null,
    platform,
    meta_pixel: /fbq\(|connect\.facebook\.net\/[^"']*fbevents/.test(lower),
    google_analytics: /gtag\(|googletagmanager\.com\/gtag|google-analytics\.com/.test(lower),
    google_tag_manager: /googletagmanager\.com\/gtm\.js|gtm-[a-z0-9]+/.test(lower),
    tiktok_pixel: lower.includes('analytics.tiktok.com'),
    whatsapp_button: /wa\.me\/|api\.whatsapp\.com/.test(lower),
    mobile_viewport: /<meta[^>]+name=["']viewport["']/i.test(source),
    response_ms: elapsedMs,
    text_excerpt: text,
  }
}

const ZONE = 'America/Sao_Paulo'
function zonedParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]))
  return { ...parts, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun' }
}
const toMinutes = (time, fallback) => { const match = String(time || '').match(/^(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : fallback }

/** Próximo horário válido de envio (dias úteis, dentro da janela, horário de Brasília). */
export function nextSendSlot(from, settings = {}) {
  const start = toMinutes(settings.send_window_start, 8 * 60 + 30), end = toMinutes(settings.send_window_end, 18 * 60)
  let cursor = new Date(from)
  for (let guard = 0; guard < 14 * 24 * 4; guard += 1) {
    const parts = zonedParts(cursor)
    if (!parts.weekend && parts.minutes >= start && parts.minutes < end) return cursor
    cursor = new Date(cursor.getTime() + 15 * 60_000)
    // alinha em blocos de 15 minutos
    cursor.setUTCSeconds(0, 0)
  }
  return new Date(from)
}

/** Sequência: e-mail 1 agora (na janela) e follow-ups em N dias, todos em dia útil. */
export function planSequence({ prospect, settings = {}, now = new Date() }) {
  const days = Array.isArray(settings.followup_days) && settings.followup_days.length ? settings.followup_days : [3, 7]
  const subject = clean(prospect.email_subject, 160)
  const steps = [{ step: 0, subject, body_text: clean(prospect.email_body, 4000), scheduled_for: nextSendSlot(now, settings) }]
  const followups = Array.isArray(prospect.email_followups) ? prospect.email_followups : []
  followups.slice(0, days.length).forEach((body, index) => {
    if (!clean(body)) return
    const base = new Date(steps[0].scheduled_for.getTime() + Number(days[index]) * 86_400_000)
    steps.push({ step: index + 1, subject: subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`, body_text: clean(body, 4000), scheduled_for: nextSendSlot(base, settings) })
  })
  return steps
}

const DEFAULT_TEMPLATE = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2933;max-width:560px">{{corpo}}{{assinatura}}</div>'

/** Aplica o HTML leve do Kleber: {{corpo}}, {{assinatura}}, {{nome}}, {{empresa}}. */
export function renderOutreachHtml({ template, signature, bodyText, prospect = {} }) {
  const firstName = clean(prospect.contact_name, 120).split(/\s+/)[0] || ''
  const paragraphs = clean(bodyText, 6000).split(/\n{2,}|\r\n\r\n/).map((block) => `<p style="margin:0 0 12px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('')
  const html = (clean(template, 50_000) || DEFAULT_TEMPLATE)
    .replaceAll('{{corpo}}', paragraphs)
    .replaceAll('{{assinatura}}', clean(signature, 20_000))
    .replaceAll('{{nome}}', escapeHtml(firstName))
    .replaceAll('{{empresa}}', escapeHtml(clean(prospect.company_name, 200)))
  return html
}

export function personalize(text, prospect = {}) {
  const firstName = clean(prospect.contact_name, 120).split(/\s+/)[0] || ''
  return String(text || '').replaceAll('{{nome}}', firstName).replaceAll('{{empresa}}', clean(prospect.company_name, 200))
}

export const isValidEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(clean(value, 320))
