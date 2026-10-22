// Regras puras do atendimento comercial (testáveis em Node, usadas pelo worker em Deno).

const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max)

export const KNOWLEDGE_CATEGORY_LABELS = Object.freeze({
  empresa: 'Sobre a Mugô',
  servicos: 'Serviços',
  precos: 'Preços que podem ser informados',
  cases: 'Cases e resultados',
  faq: 'Perguntas frequentes',
  regras: 'Regras — o que NÃO dizer ou prometer',
  tom: 'Tom de voz',
})
const CATEGORY_ORDER = Object.keys(KNOWLEDGE_CATEGORY_LABELS)

/** Texto que entra no system prompt com o que a IA pode usar como fonte. */
export function buildKnowledgePrompt(entries = [], settings = {}, { ownerFirstName = null, operationalOpen = true } = {}) {
  const active = entries.filter((entry) => entry && entry.active !== false && clean(entry.content))
  const sections = CATEGORY_ORDER.map((category) => {
    const items = active.filter((entry) => entry.category === category).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    if (!items.length) return ''
    return `## ${KNOWLEDGE_CATEGORY_LABELS[category]}\n${items.map((item) => `### ${clean(item.title, 200)}\n${clean(item.content, 6000)}`).join('\n')}`
  }).filter(Boolean)
  const lines = ['# Base de conhecimento autorizada da Mugô',
    'Use APENAS estas informações como fonte sobre serviços, preços, prazos e cases. Se a resposta não estiver aqui, diga que vai confirmar com o time — nunca invente.']
  if (sections.length) lines.push(...sections)
  else lines.push('(Base ainda vazia: não cite serviços, preços ou cases específicos; foque em entender a necessidade.)')
  if (clean(settings.voice_tone)) lines.push(`# Tom de voz definido pelo time\n${clean(settings.voice_tone, 1500)}`)
  if (clean(settings.meeting_link)) lines.push(`# Agendamento\nQuando o lead estiver qualificado ou pedir para conversar, ofereça uma conversa rápida e envie exatamente este link para ele escolher o horário: ${clean(settings.meeting_link, 500)}`)
  lines.push(`# Repasse para humano\n${ownerFirstName ? `A pessoa responsável pelo comercial é ${ownerFirstName}.` : 'Ainda não há responsável comercial definido; diga "alguém do time".'} ${operationalOpen ? 'Estamos em horário de atendimento.' : 'Estamos FORA do horário de atendimento: se fizer o repasse, avise que a pessoa responde no próximo período útil.'} Quando fizer handoff, escreva você mesmo uma mensagem curta e natural, retomando em uma frase o que o lead pediu, e dizendo quem continua.`)
  return lines.join('\n\n')
}

/** Junta as mensagens do lead desde a última resposta nossa (ele pode ter mandado 3 seguidas). */
export function pendingInboundText(messages = []) {
  const lastOutbound = messages.map((row) => row.direction).lastIndexOf('out')
  const pending = messages.slice(lastOutbound + 1).filter((row) => row.direction === 'in' && clean(row.text_content))
  if (!pending.length) return clean(messages.filter((row) => row.direction === 'in').at(-1)?.text_content)
  return pending.map((row) => clean(row.text_content, 2000)).join('\n')
}

const CONTINUITY = /continu|segue com voc|fala com voc|retorna|te (?:chama|responde)|vai te|entra em contato|encaminh/i
const OFF_HOURS = /hor[aá]rio|amanh[aã]|pr[oó]ximo per[ií]odo|segunda|assim que/i

/** Mantém a resposta escrita pela IA no repasse; só completa o que faltar. */
export function composeHandoffResponse({ modelResponse, ownerFirstName = null, operationalOpen = true }) {
  let text = clean(modelResponse, 1500)
  const who = ownerFirstName ? `${ownerFirstName}, do nosso time,` : 'Alguém do nosso time'
  if (!text) text = 'Perfeito, já registrei tudo por aqui.'
  if (!CONTINUITY.test(text)) text = `${text.replace(/[.!\s]*$/, '.')} ${who} continua com você por aqui.`
  if (!operationalOpen && !OFF_HOURS.test(text)) text = `${text} Como estamos fora do horário agora, a resposta vem no próximo período útil.`
  return text
}

const URL_PATTERN = /\bhttps?:\/\/[^\s)>\]]+/gi
/** Remove links que não estão na base autorizada (evita a IA inventar URL). */
export function stripUnauthorizedLinks(text, { meetingLink = '', knowledge = [] } = {}) {
  const allowed = new Set()
  const add = (url) => { if (url) allowed.add(url.replace(/[.,;!?]+$/, '').toLowerCase()) }
  add(clean(meetingLink))
  for (const entry of knowledge) for (const match of String(entry?.content || '').match(URL_PATTERN) || []) add(match)
  return clean(text, 4000).replace(URL_PATTERN, (url) => {
    const normalized = url.replace(/[.,;!?]+$/, '').toLowerCase()
    return allowed.has(normalized) ? url : ''
  }).replace(/\s{2,}/g, ' ').trim()
}

/**
 * Retomada única: o lead ficou sem responder nossa última mensagem.
 * Só dentro da janela de 24h do WhatsApp e só uma vez por mensagem nossa.
 */
export function followupDue(conversation, settings, now = Date.now()) {
  if (!settings?.followup_enabled || settings.ai_mode !== 'controlled_auto') return false
  if (!conversation || conversation.attendance_mode !== 'bot' || conversation.automation_paused) return false
  const inbound = Date.parse(conversation.last_inbound_at || ''), outbound = Date.parse(conversation.last_outbound_at || '')
  if (!Number.isFinite(inbound) || !Number.isFinite(outbound) || outbound <= inbound) return false
  const waitMs = Math.max(30, Number(settings.followup_after_minutes) || 240) * 60_000
  if (now - outbound < waitMs) return false
  // janela de atendimento de 24h a partir da última mensagem do lead (margem de 30 min)
  return now - inbound < 23.5 * 3_600_000
}

export const FOLLOWUP_FALLBACK = 'Oi! Passando só para saber se ficou alguma dúvida. Se quiser, me conta um pouco mais e eu já te ajudo por aqui.'

export const FOLLOWUP_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: { send: { type: 'boolean' }, text: { type: 'string' } },
  required: ['send', 'text'],
})

/**
 * Botão de triagem: no repasse para o time, a mensagem sai com um botão que abre o WhatsApp da equipe Mugô.
 * Se o link for wa.me, já leva uma mensagem pronta com o assunto, para a equipe saber quem é e o que precisa.
 * Limites da Meta: texto do botão até 20 caracteres, corpo até 1024.
 */
export function buildTriageCta(settings = {}, { summary = '', contactName = '' } = {}) {
  const url = clean(settings.triage_cta_url, 500)
  if (!/^https:\/\//i.test(url)) return null
  const label = clean(settings.triage_cta_label, 20) || 'Falar com a equipe'
  let finalUrl = url
  if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(url) && !/[?&]text=/.test(url)) {
    const intro = [contactName ? `Oi! Aqui é ${clean(contactName, 60)}` : 'Oi!', 'vim do atendimento da Mugô', summary ? `Assunto: ${clean(summary, 200)}` : ''].filter(Boolean).join(' — ')
    finalUrl = `${url}${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(intro)}`
  }
  return { label, url: finalUrl }
}

export function interactiveCtaBody(text, cta) {
  return { type: 'cta_url', body: { text: clean(text, 1024) }, action: { name: 'cta_url', parameters: { display_text: cta.label, url: cta.url } } }
}

/** Até 2 botões de triagem (o WhatsApp aceita 1 por mensagem; o segundo vai numa mensagem curta logo depois). */
export function buildTriageCtas(settings = {}, context = {}) {
  const first = buildTriageCta(settings, context)
  const second = buildTriageCta({ triage_cta_url: settings.triage_cta_url_2, triage_cta_label: settings.triage_cta_label_2 || 'Outro atendente' }, context)
  return [first, second].filter(Boolean)
}
export const SECOND_CTA_TEXT = 'Se preferir, você também pode falar com a gente por aqui:'

// A mensagem fala em passar para o time? Então os botões da equipe vão junto.
const TEAM_MENTION = /\b(nosso time|do time|o time|nossa equipe|da equipe|a equipe|pessoa respons[aá]vel|algu[eé]m (?:do|da) (?:time|equipe)|vou encaminhar|vou passar|encaminhei|especialista|consultor|comercial (?:vai|continua|te chama))/i
export const mentionsTeam = (text) => TEAM_MENTION.test(String(text || ''))
