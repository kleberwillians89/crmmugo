// Regras puras da newsletter automática (RSS, curadoria, HTML, agenda).

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max)
const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const decodeEntities = (value) => String(value ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
const stripTags = (value) => decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return match ? match[1] : ''
}

/** Lê RSS 2.0 e Atom. Tolera feed truncado (ignora o último item incompleto). */
export function parseFeed(xml, { limit = 30 } = {}) {
  const source = String(xml || '')
  const blocks = [...source.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => ({ block: m[0], atom: false }))
    .concat([...source.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => ({ block: m[0], atom: true })))
  const items = []
  for (const { block, atom } of blocks) {
    const title = stripTags(tag(block, 'title'))
    let link = ''
    if (atom) link = (block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || ''
    else link = stripTags(tag(block, 'link')) || stripTags(tag(block, 'guid'))
    const dateRaw = stripTags(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date'))
    const excerpt = stripTags(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded') || tag(block, 'content')).slice(0, 600)
    const published = Date.parse(dateRaw)
    if (!title || !/^https?:\/\//i.test(link)) continue
    items.push({ title: title.slice(0, 300), url: decodeEntities(link).trim(), excerpt, published_at: Number.isFinite(published) ? new Date(published).toISOString() : null })
    if (items.length >= limit) break
  }
  return items
}

const ZONE = 'America/Sao_Paulo'
function zoned(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(date).map((p) => [p.type, p.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}
const toMinutes = (time, fallback) => { const m = String(time || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : fallback }
const addDays = (isoDate, days) => { const d = new Date(`${isoDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

/** Segunda-feira (data em Brasília) da semana de `now`. */
export function weekStart(now = new Date()) {
  const z = zoned(now)
  return addDays(z.date, -((z.weekday + 6) % 7))
}

/** Já passou o dia/hora de gerar a edição desta semana? */
export function generationDue(settings, now = new Date()) {
  if (!settings?.enabled) return false
  const z = zoned(now)
  const target = Number(settings.generate_weekday ?? 1)
  const daysSinceMonday = (z.weekday + 6) % 7, targetSinceMonday = (target + 6) % 7
  if (daysSinceMonday > targetSinceMonday) return true
  return daysSinceMonday === targetSinceMonday && z.minutes >= toMinutes(settings.generate_time, 7 * 60)
}

/** Próximo horário de envio (dia/hora configurados, em Brasília) a partir de `now`. */
export function nextSendAt(settings, now = new Date()) {
  const z = zoned(now)
  const target = Number(settings?.send_weekday ?? 2), minutes = toMinutes(settings?.send_time, 9 * 60)
  let days = (target - z.weekday + 7) % 7
  if (days === 0 && z.minutes >= minutes - 5) days = 7
  const date = addDays(z.date, days)
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0'), mm = String(minutes % 60).padStart(2, '0')
  return new Date(`${date}T${hh}:${mm}:00-03:00`)
}

/**
 * Envio depois da aprovação, sem perder o timing: usa o horário da semana se ainda não passou;
 * se a aprovação atrasou, sai no próximo dia útil no mesmo horário (nunca empurra para a semana seguinte).
 */
export function sendAtAfterApproval(settings, now = new Date()) {
  const minutes = toMinutes(settings?.send_time, 9 * 60)
  const regular = nextSendAt(settings, now)
  if (regular.getTime() - now.getTime() <= 6 * 86_400_000) {
    const z = zoned(now), target = Number(settings?.send_weekday ?? 2)
    const daysUntil = (target - z.weekday + 7) % 7
    // slot ainda nesta semana (até o dia configurado) → mantém
    if (daysUntil > 0 && daysUntil <= 3) return regular
  }
  // atrasou: hoje mesmo se ainda der tempo, senão o próximo dia útil
  const z = zoned(now)
  let date = z.date, weekday = z.weekday
  if (weekday === 0 || weekday === 6 || z.minutes >= minutes - 5) {
    do { date = addDays(date, 1); weekday = (weekday + 1) % 7 } while (weekday === 0 || weekday === 6)
  }
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0'), mm = String(minutes % 60).padStart(2, '0')
  return new Date(`${date}T${hh}:${mm}:00-03:00`)
}

export const CURATION_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: {
    subject: { type: 'string', description: 'Assunto do e-mail, até 60 caracteres, sem clickbait.' },
    preheader: { type: 'string', description: 'Linha de apoio do assunto, até 90 caracteres.' },
    intro: { type: 'string', description: '2-3 frases de abertura no tom da Mugô.' },
    items: {
      type: 'array', minItems: 3, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          url: { type: 'string', description: 'URL exatamente como veio na lista.' },
          title_pt: { type: 'string', description: 'Título em português, claro e factual.' },
          summary_pt: { type: 'string', description: 'Resumo próprio em 2-3 frases. Nunca copie trechos.' },
          impact_pt: { type: 'string', description: 'O que isso muda para uma marca/negócio, 1-2 frases práticas.' },
          segments: { type: 'array', items: { type: 'string', enum: ['ecommerce', 'investimentos', 'talentos', 'servicos', 'todos'] } },
        },
        required: ['url', 'title_pt', 'summary_pt', 'impact_pt', 'segments'],
      },
    },
    linkedin_post: { type: 'string', description: 'Post para a PÁGINA da Mugô no LinkedIn, voz institucional ("nós", "aqui na Mugô"), até 1.300 caracteres: 1ª linha é um gancho forte, depois 1 linha por notícia com o impacto prático, uma pergunta para comentários e a chamada para assinar a newsletter. Sem hashtags (são adicionadas depois).' },
  },
  required: ['subject', 'preheader', 'intro', 'items', 'linkedin_post'],
})

export function buildCurationPrompt({ candidates, settings = {}, count = 5, knowledge = [] }) {
  const tone = knowledge.filter((entry) => entry.category === 'tom').map((entry) => clean(entry.content, 600)).join('\n')
  const system = [
    'Você é editor da newsletter semanal da Mugô, agência brasileira de marketing digital (tráfego pago, SEO, social media, analytics, design, sites e automação).',
    'Leitores: donos e gestores de e-commerce, gestoras de investimento e criadores/talentos — ocupados, querem saber o que muda no negócio deles.',
    `Escolha as ${count} notícias mais úteis e recentes da lista. Prefira mudanças de plataforma (Meta, Google, TikTok, Instagram), tendências com dado concreto e novidades de e-commerce no Brasil. Evite notícias repetidas, puramente corporativas ou sem impacto prático.`,
    'Escreva tudo em português do Brasil, com resumo PRÓPRIO (nunca copie frases da fonte) e um "impacto" prático e honesto. Não invente números ou fatos além do que o título/trecho indica.',
    'Use a URL exatamente como recebida.',
    settings.focus ? `Foco definido pelo time: ${clean(settings.focus, 800)}` : '',
    tone ? `Tom de voz da Mugô:\n${tone}` : 'Tom: direto, leve, sem jargão e sem emoji.',
  ].filter(Boolean).join('\n')
  const list = candidates.map((item, index) => ({ n: index + 1, url: item.url, fonte: item.source_name, data: item.published_at?.slice(0, 10) || null, titulo: item.title, trecho: clean(item.excerpt, 400) }))
  return { system, user: `Notícias da semana:\n${JSON.stringify(list)}` }
}

/** Mantém só itens cujas URLs vieram da lista (a IA não pode inventar notícia). */
export function validateCuration(raw, candidates, count = 5) {
  const allowed = new Map(candidates.map((item) => [item.url, item]))
  const seen = new Set()
  const items = (Array.isArray(raw?.items) ? raw.items : []).filter((item) => {
    const url = clean(item?.url, 1000)
    if (!allowed.has(url) || seen.has(url)) return false
    seen.add(url); return true
  }).slice(0, count).map((item) => {
    const source = allowed.get(clean(item.url, 1000))
    return {
      url: source.url, source_name: source.source_name || '', news_id: source.id || null,
      title_pt: clean(item.title_pt, 200) || source.title, summary_pt: clean(item.summary_pt, 700), impact_pt: clean(item.impact_pt, 500),
      segments: Array.isArray(item.segments) ? item.segments.filter((segment) => ['ecommerce', 'investimentos', 'talentos', 'servicos', 'todos'].includes(segment)) : [],
    }
  }).filter((item) => item.summary_pt)
  if (items.length < 3) return null
  return { subject: clean(raw.subject, 120) || 'O que mudou no marketing esta semana', preheader: clean(raw.preheader, 160), intro: clean(raw.intro, 800), items, linkedin_post: clean(raw.linkedin_post, 2600) }
}

const DEFAULT_ITEM = '<tr><td style="padding:0 0 22px"><p style="margin:0 0 4px;font-size:12px;color:#8b97a7;text-transform:uppercase;letter-spacing:.04em">{{fonte}}</p><h2 style="margin:0 0 8px;font-size:18px;line-height:1.3;color:#101828">{{titulo}}</h2><p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#344054">{{resumo}}</p><p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#004f6e"><b>Na prática:</b> {{impacto}}</p><a href="{{link}}" style="font-size:14px;color:#004f6e">Ler na fonte →</a></td></tr>'
const DEFAULT_TEMPLATE = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6f8"><span style="display:none;max-height:0;overflow:hidden">{{preheader}}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px;font-family:Arial,Helvetica,sans-serif"><tr><td style="padding:0 0 8px;font-size:13px;color:#8b97a7">Mugô · O que mudou esta semana</td></tr><tr><td style="padding:0 0 24px;font-size:16px;line-height:1.6;color:#101828">Oi, {{nome}}! {{intro}}</td></tr>{{itens}}<tr><td style="padding:8px 0 0;border-top:1px solid #e4e9ee;font-size:15px;line-height:1.55;color:#344054">Quer entender como alguma dessas mudanças afeta a sua marca? É só responder este e-mail.</td></tr><tr><td style="padding:20px 0 0;font-size:12px;color:#8b97a7">Você recebe este e-mail por ter relação com a Mugô. <a href="{{descadastro}}" style="color:#8b97a7">Descadastrar</a></td></tr></table></td></tr></table></body></html>`

/** Monta o HTML da edição. {{nome}} e {{descadastro}} ficam para o envio personalizar. */
export function renderNewsletterHtml({ template, itemTemplate, edition }) {
  const itemHtml = clean(itemTemplate, 20_000) || DEFAULT_ITEM
  const items = (edition.items || []).map((item) => itemHtml
    .replaceAll('{{titulo}}', escapeHtml(item.title_pt))
    .replaceAll('{{resumo}}', escapeHtml(item.summary_pt))
    .replaceAll('{{impacto}}', escapeHtml(item.impact_pt))
    .replaceAll('{{fonte}}', escapeHtml(item.source_name))
    .replaceAll('{{link}}', escapeHtml(item.url))).join('')
  return (clean(template, 100_000) || DEFAULT_TEMPLATE)
    .replaceAll('{{intro}}', escapeHtml(edition.intro))
    .replaceAll('{{preheader}}', escapeHtml(edition.preheader))
    .replaceAll('{{itens}}', items)
}

/** Notícias recentes resumidas para dar gancho à prospecção de um segmento. */
export function newsHooksFor(news = [], segment = '', limit = 3) {
  const target = clean(segment, 120).toLowerCase()
  const wanted = /e-?commerce|loja|varejo|moda|beleza/.test(target) ? 'ecommerce' : /invest|gestora|financ|asset/.test(target) ? 'investimentos' : /criador|influenc|talent|artista/.test(target) ? 'talentos' : ''
  return news.filter((item) => item.summary_pt && (!wanted || (item.segments || []).some((s) => s === wanted || s === 'todos')))
    .slice(0, limit).map((item) => ({ titulo: item.title, resumo: item.summary_pt, impacto: item.impact_pt, link: item.url }))
}

/** Post final do LinkedIn: texto da edição + hashtags configuradas (sem repetir). */
export function composeLinkedinPost(edition, hashtags = '') {
  const text = clean(edition?.linkedin_post, 2600)
  const tags = String(hashtags || '').split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.startsWith('#') ? tag : `#${tag}`)
  const missing = tags.filter((tag) => !text.toLowerCase().includes(tag.toLowerCase()))
  return [text, missing.join(' ')].filter(Boolean).join('\n\n').slice(0, 3000)
}

const SLIDE_BASE = 'width:1080px;height:1350px;box-sizing:border-box;padding:96px 88px;font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;justify-content:space-between'
const DEFAULT_COVER = `<div style="${SLIDE_BASE};background:#10262f;color:#ffffff"><div style="font-size:30px;letter-spacing:.12em;text-transform:uppercase;color:#8fa4ad">Mugô · {{data}}</div><div><div style="font-size:84px;line-height:1.05;font-weight:800">{{titulo_edicao}}</div><div style="margin-top:40px;font-size:36px;line-height:1.4;color:#d0dde2">{{intro}}</div></div><div style="font-size:30px;color:#8fa4ad">Arraste para o lado →</div></div>`
const DEFAULT_SLIDE = `<div style="${SLIDE_BASE};background:#f4f6f8;color:#101828"><div style="display:flex;justify-content:space-between;font-size:28px;color:#475467"><span>{{numero}}</span><span>{{fonte}}</span></div><div><div style="font-size:64px;line-height:1.1;font-weight:800">{{titulo}}</div><div style="margin-top:36px;font-size:34px;line-height:1.45;color:#344054">{{resumo}}</div><div style="margin-top:40px;padding:32px;border-radius:24px;background:#004f6e;color:#ffffff;font-size:34px;line-height:1.4"><b>Na prática:</b> {{impacto}}</div></div><div style="font-size:28px;color:#475467">mugoagencia.com.br</div></div>`

/** Slides do carrossel (capa + 1 por notícia), cada um um HTML de 1080×1350 para exportar como imagem. */
export function renderLinkedinSlides({ coverTemplate, slideTemplate, edition }) {
  const items = edition?.items || []
  const date = String(edition?.week_start || '').split('-').reverse().join('/')
  const cover = (clean(coverTemplate, 50_000) || DEFAULT_COVER)
    .replaceAll('{{titulo_edicao}}', escapeHtml(edition?.subject || 'O que mudou no marketing'))
    .replaceAll('{{data}}', escapeHtml(date))
    .replaceAll('{{intro}}', escapeHtml(clean(edition?.intro, 220)))
  const slides = items.map((item, index) => (clean(slideTemplate, 50_000) || DEFAULT_SLIDE)
    .replaceAll('{{numero}}', `${String(index + 1).padStart(2, '0')}/${String(items.length).padStart(2, '0')}`)
    .replaceAll('{{titulo}}', escapeHtml(item.title_pt))
    .replaceAll('{{resumo}}', escapeHtml(item.summary_pt))
    .replaceAll('{{impacto}}', escapeHtml(item.impact_pt))
    .replaceAll('{{fonte}}', escapeHtml(item.source_name)))
  return [cover, ...slides]
}
