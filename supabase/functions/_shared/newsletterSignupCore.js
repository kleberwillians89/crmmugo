// Inscrição pública na newsletter da Mugô (página /news → função newsletter-signup).
// Regras: só entra na lista quem marcou o aceite E clicou no e-mail de confirmação (double opt-in).
// Tudo aqui é puro (sem rede) para ser testado com node --test.

export const CONSENT_TEXT = 'Quero receber a newsletter da Mugô por e-mail. Posso me descadastrar quando quiser, com um clique.'
export const CONTACT_CONSENT_TEXT = 'Quero que a Mugô fale comigo sobre um projeto (WhatsApp ou e-mail).'
export const NEWSLETTER_TAG = 'newsletter'
export const MIN_FILL_MS = 2500
export const CONFIRM_RESEND_MINUTES = 10
export const MAX_CONFIRMATIONS_PER_DAY = 3
export const TOKEN_TTL_DAYS = 7

// eslint-disable-next-line no-control-regex
const clean = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const normalizeEmail = (value) => clean(value, 320).toLowerCase()
export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 320 && !/\.\./.test(value)

// WhatsApp brasileiro: aceita (11) 98888-7777, 11988887777, +55 11 98888-7777. Devolve só dígitos com 55.
export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  if (!/^55\d{10,11}$/.test(digits)) return null
  return digits
}

export const firstName = (name) => clean(name, 120).split(/\s+/)[0] || ''

const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']
export function pickAttribution(input = {}) {
  const out = {}
  for (const key of ATTRIBUTION_KEYS) {
    const value = clean(input[key], key.endsWith('clid') ? 300 : 200)
    if (value) out[key] = value
  }
  const referrer = clean(input.referrer, 500)
  if (/^https?:\/\//i.test(referrer)) out.referrer = referrer
  const landing = clean(input.landing_url, 500)
  if (/^https?:\/\//i.test(landing)) out.landing_url = landing
  return out
}

// Rótulo curto da origem para a tela: "meta / paid · black-friday".
export function attributionLabel(attribution = {}) {
  const a = attribution || {}
  const base = [a.utm_source, a.utm_medium].filter(Boolean).join(' / ')
  const label = [base, a.utm_campaign].filter(Boolean).join(' · ')
  if (label) return label
  if (a.fbclid) return 'meta (sem UTM)'
  if (a.gclid) return 'google (sem UTM)'
  if (a.referrer) { try { return new URL(a.referrer).hostname.replace(/^www\./, '') } catch { return 'link' } }
  return 'direto'
}

export function validateSignup(body = {}, now = Date.now()) {
  const errors = []
  if (clean(body.website, 200)) return { ok: false, bot: true, errors: ['bot'] }
  const startedAt = Number(body.started_at)
  if (!Number.isFinite(startedAt) || now - startedAt < MIN_FILL_MS) return { ok: false, bot: true, errors: ['too_fast'] }

  const email = normalizeEmail(body.email)
  if (!isValidEmail(email)) errors.push('email')
  if (body.consent !== true && body.consent !== 'true' && body.consent !== 'on') errors.push('consent')
  const name = clean(body.name, 120)
  if (!name) errors.push('name')

  const wantsContact = body.wants_contact === true || body.wants_contact === 'true' || body.wants_contact === 'on'
  let phone = null
  if (wantsContact) {
    phone = normalizePhone(body.whatsapp)
    if (!phone) errors.push('whatsapp')
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      email, name, phone, wants_contact: wantsContact,
      company: wantsContact ? clean(body.company, 160) || null : null,
      interest: wantsContact ? clean(body.interest, 400) || null : null,
      attribution: pickAttribution(body),
    },
  }
}

export const ERROR_MESSAGES = Object.freeze({
  email: 'Confere o e-mail? Parece que falta alguma coisa.',
  name: 'Como a gente te chama?',
  consent: 'Marca a caixinha de aceite pra gente poder te enviar a newsletter.',
  whatsapp: 'Deixa um WhatsApp com DDD pra gente falar com você.',
})

// Pode mandar de novo o e-mail de confirmação? (evita spam de reenvio e abuso de formulário)
export function confirmationAllowed(signup, now = Date.now()) {
  if (!signup) return true
  const last = signup.confirmation_sent_at ? Date.parse(signup.confirmation_sent_at) : 0
  if (last && now - last < CONFIRM_RESEND_MINUTES * 60_000) return false
  const sameDay = last && now - last < 24 * 3600_000
  if (sameDay && Number(signup.confirmations_sent || 0) >= MAX_CONFIRMATIONS_PER_DAY) return false
  return true
}

export const tokenExpired = (signup, now = Date.now()) =>
  !signup?.created_at || now - Date.parse(signup.created_at) > TOKEN_TTL_DAYS * 24 * 3600_000

export const confirmUrl = (siteUrl, token) => `${String(siteUrl).replace(/\/$/, '')}/confirmar?c=${encodeURIComponent(token)}`

// ---------- E-mails (tabelas + estilos inline: funciona em Gmail, Outlook e Apple Mail) ----------
const RED = '#b22234', CREAM = '#fffdf8', INK = '#111111'

function shell({ preheader, body, footer, logoUrl }) {
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="120" height="56" alt="MUGÔ" style="display:block;width:120px;height:56px;border:0;outline:none;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:700;letter-spacing:-0.03em;color:${RED}">`
    : `<div style="font-size:26px;font-weight:700;letter-spacing:-0.03em;color:${RED}">MUGÔ</div>`
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no, date=no, address=no, email=no"><title>Mugô</title><style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}</style></head>
<body style="margin:0;padding:0;background-color:#f0f1f5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" bgcolor="#f0f1f5" style="background-color:#f0f1f5"><tr><td align="center" style="padding:24px 12px">
<table width="560" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:560px;background-color:${CREAM};border-radius:14px;font-family:Arial,Helvetica,sans-serif;color:${INK}">
<tr><td style="padding:28px 32px 8px">${logo}</td></tr>
${body}
<tr><td style="background-color:${INK};border-radius:0 0 14px 14px;padding:20px 32px;font-size:12px;line-height:1.6;color:#b9b6ae" align="center">${footer}</td></tr>
</table></td></tr></table></body></html>`
}

const button = (href, label) => `<tr><td style="padding:8px 32px 28px">
<a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;background-color:${RED};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:15px 34px;border-radius:100px">${escapeHtml(label)}</a></td></tr>`

export function confirmationEmail({ name, url, logoUrl }) {
  const hi = firstName(name) ? `Oi, ${escapeHtml(firstName(name))}!` : 'Oi!'
  const body = `<tr><td style="padding:18px 32px 6px;font-size:32px;line-height:1.1;letter-spacing:-0.03em;font-weight:700">${hi}</td></tr>
<tr><td style="padding:6px 32px 18px;font-size:17px;line-height:1.55;color:#333333">Falta só um clique pra você entrar na newsletter da Mugô: marketing, negócios e o melhor da cultura de São Paulo, toda terça de manhã.</td></tr>
${button(url, 'Confirmar inscrição')}
<tr><td style="padding:0 32px 28px;font-size:13px;line-height:1.5;color:#6b6b6b">Não foi você? É só ignorar este e-mail — sem a confirmação, você não entra na lista.</td></tr>`
  const html = shell({ preheader: 'Confirme com um clique e chega na terça.', body, logoUrl, footer: 'Mugô · São Paulo · mugoagencia.com.br' })
  const text = `${firstName(name) ? `Oi, ${firstName(name)}!` : 'Oi!'}\n\nFalta só um clique pra você entrar na newsletter da Mugô (toda terça de manhã).\n\nConfirmar inscrição: ${url}\n\nNão foi você? É só ignorar este e-mail.`
  return { subject: 'Confirme sua inscrição na newsletter da Mugô', html, text }
}

export function welcomeEmail({ name, unsubscribeUrl, siteUrl = 'https://mugoagencia.com.br', logoUrl }) {
  const hi = firstName(name) ? `Que bom ter você aqui, ${escapeHtml(firstName(name))}.` : 'Que bom ter você aqui.'
  const body = `<tr><td style="padding:18px 32px 6px;font-size:32px;line-height:1.1;letter-spacing:-0.03em;font-weight:700">${hi}</td></tr>
<tr><td style="padding:6px 32px 14px;font-size:17px;line-height:1.55;color:#333333">Inscrição confirmada. Toda terça, às 7h45, você recebe uma seleção curta do que importa:</td></tr>
<tr><td style="padding:0 32px 18px"><table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td style="background-color:${RED};border-radius:16px;padding:20px 22px;font-size:16px;line-height:1.7;color:${CREAM}">
<b>Marketing</b> — o que mudou em mídia, redes e IA, sem enrolação.<br><b>Negócios</b> — movimentos de mercado com o “e daí?” pra sua marca.<br><b>Cultura</b> — shows, exposições, teatro e onde comer em SP.
</td></tr></table></td></tr>
<tr><td style="padding:0 32px 8px;font-size:16px;line-height:1.55;color:#333333">Enquanto a próxima não chega, dá uma olhada no que a gente faz:</td></tr>
${button(siteUrl, 'Conhecer a Mugô')}`
  const footer = `Você recebe porque se inscreveu na newsletter da Mugô. <a href="${escapeHtml(unsubscribeUrl)}" style="color:${CREAM};text-decoration:underline">Descadastrar</a>`
  const html = shell({ preheader: 'Inscrição confirmada — a primeira chega na terça.', body, logoUrl, footer })
  const text = `${firstName(name) ? `Que bom ter você aqui, ${firstName(name)}.` : 'Que bom ter você aqui.'}\n\nInscrição confirmada. Toda terça, às 7h45, você recebe marketing, negócios e cultura de SP.\n\nConhecer a Mugô: ${siteUrl}\n\nDescadastrar: ${unsubscribeUrl}`
  return { subject: 'Inscrição confirmada — bem-vindo(a) à newsletter da Mugô', html, text }
}

// Lead do site que pediu contato: texto da tarefa para o comercial.
export function leadTaskNotes(value) {
  return [
    'Inscreveu-se na newsletter pelo site e pediu para a Mugô entrar em contato.',
    value.company ? `Empresa: ${value.company}` : '',
    value.interest ? `Interesse: ${value.interest}` : '',
    value.phone ? `WhatsApp: +${value.phone}` : '',
    `E-mail: ${value.email}`,
    `Origem: ${attributionLabel(value.attribution)}`,
  ].filter(Boolean).join('\n')
}

// Resumo para a tela de contatos: totais e desempenho por origem/campanha.
export function summarizeSignups(rows = [], now = Date.now()) {
  const weekAgo = now - 7 * 24 * 3600 * 1000
  const byOrigin = new Map()
  for (const row of rows) {
    const key = attributionLabel(row.attribution)
    const item = byOrigin.get(key) || { origin: key, total: 0, confirmed: 0, contact: 0 }
    item.total += 1
    if (row.status === 'confirmed') item.confirmed += 1
    if (row.wants_contact && row.status === 'confirmed') item.contact += 1
    byOrigin.set(key, item)
  }
  return {
    confirmed: rows.filter((row) => row.status === 'confirmed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    week: rows.filter((row) => row.status === 'confirmed' && Date.parse(row.confirmed_at || row.created_at) >= weekAgo).length,
    leads: rows.filter((row) => row.wants_contact && row.status === 'confirmed').length,
    origins: [...byOrigin.values()].sort((a, b) => b.confirmed - a.confirmed || b.total - a.total).slice(0, 12),
  }
}
