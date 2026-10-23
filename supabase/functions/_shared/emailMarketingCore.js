// Regras puras do e-mail marketing (Resend).
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max)
const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function unsubscribeUrl(baseUrl, token) {
  return `${String(baseUrl).replace(/\/$/, '')}/functions/v1/email-unsubscribe?t=${encodeURIComponent(token)}`
}

/** Personaliza o HTML do Kleber: {{nome}}, {{email}}, {{descadastro}}. Sem {{descadastro}}, adiciona rodapé. */
export function renderCampaignHtml(html, { name = '', email = '', unsubscribe = '' } = {}) {
  const firstName = clean(name, 120).split(/\s+/)[0] || ''
  // Sem nome: "Oi, {{nome}}!" vira "Oi!" (nunca "Oi, !").
  let output = String(html || '')
  if (!firstName) output = output.replace(/,?[ \t]*\{\{nome\}\}/g, '')
  output = output
    .replaceAll('{{nome}}', escapeHtml(firstName))
    .replaceAll('{{email}}', escapeHtml(email))
  if (output.includes('{{descadastro}}')) output = output.replaceAll('{{descadastro}}', escapeHtml(unsubscribe))
  else {
    const footer = `<div style="font-family:Arial,sans-serif;font-size:12px;color:#8b97a7;text-align:center;padding:24px 12px">Você recebe este e-mail por ter relação com a Mugô. <a href="${escapeHtml(unsubscribe)}" style="color:#8b97a7">Descadastrar</a></div>`
    output = /<\/body>/i.test(output) ? output.replace(/<\/body>/i, `${footer}</body>`) : `${output}${footer}`
  }
  return output
}

export function htmlToText(html) {
  return clean(String(html || '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n'), 100_000)
}

/** Quem recebe a campanha: inscritos, não suprimidos, que batem com tags/origens do público. */
export function matchesAudience(contact, audience = {}) {
  if (!contact?.subscribed || !contact.email) return false
  const tags = Array.isArray(audience.tags) ? audience.tags.filter(Boolean) : []
  const sources = Array.isArray(audience.sources) ? audience.sources.filter(Boolean) : []
  if (tags.length && !tags.some((tag) => (contact.tags || []).includes(tag))) return false
  if (sources.length && !sources.includes(contact.source)) return false
  return true
}

export const RESEND_STATUS = Object.freeze({
  'email.sent': 'sent', 'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'clicked',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.delivery_delayed': null,
})
const RANK = { queued: 0, skipped: 0, failed: 1, sent: 2, delivered: 3, opened: 4, clicked: 5, bounced: 6, complained: 7 }
export const shouldAdvanceRecipient = (current, next) => Boolean(next) && (RANK[next] ?? 0) > (RANK[current] ?? 0)

const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
const toBase64 = (bytes) => { let binary = ''; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary) }

/** Assinatura Svix usada pelo Resend: v1,base64(HMAC-SHA256(secret, "id.timestamp.body")). */
export async function verifySvixSignature({ secret, id, timestamp, signature, body, now = Date.now(), toleranceSeconds = 300 }) {
  if (!secret || !id || !timestamp || !signature) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return false
  const key = await crypto.subtle.importKey('raw', fromBase64(String(secret).replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = toBase64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)))
  return String(signature).split(' ').some((part) => {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value || value.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < value.length; i += 1) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
  })
}
