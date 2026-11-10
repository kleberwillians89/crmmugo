// Origem de uma conversa do WhatsApp: anúncio Click-to-WhatsApp (objeto `referral` da Meta) ou código de
// entrada colocado no texto pré-preenchido de um link/QR ("Oi! (ref:loja-qr)").
//
// Função pura, sem rede nem banco (testada em tests/whatsapp-origin.test.mjs). Nunca inventa origem:
// sem referral e sem código, devolve null e o contato fica com a origem que já tinha.
import { extractLeadAttribution } from './commercialAgentCore.js'

const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max)
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '')

// "ref:loja-qr", "ref loja-qr", "ref#loja-qr" — só letras minúsculas, números, _ e -.
const ENTRY_CODE = /(?:^|[\s(\[])ref[:#\s-]+([a-z0-9][a-z0-9_-]{1,39})(?=$|[\s)\].,!?])/i

export function extractEntryCode(text) {
  const match = ENTRY_CODE.exec(String(text ?? ''))
  return match ? match[1].toLowerCase() : null
}

export function extractOriginTouch(message, bodyText = '') {
  const referral = message?.referral && typeof message.referral === 'object' ? message.referral : null
  const entryCode = extractEntryCode(bodyText)
  if (!referral && !entryCode) return null
  const attribution = extractLeadAttribution({ referral: referral?.source_type, metadata: referral || {} })
  const adId = digitsOnly(referral?.source_id).slice(0, 30)
  return {
    source: referral ? attribution.source : 'ENTRY_CODE',
    referral_source_type: clean(referral?.source_type, 40) || null,
    // source_id só é o ID do anúncio quando a origem é um anúncio; post orgânico também manda source_id.
    ad_id: referral && /^ad/i.test(clean(referral.source_type)) && adId ? adId : null,
    ctwa_clid: clean(referral?.ctwa_clid, 500) || null,
    source_url: clean(referral?.source_url, 1000) || null,
    headline: clean(referral?.headline) || null,
    body: clean(referral?.body, 500) || null,
    media_type: clean(referral?.media_type, 40) || null,
    entry_code: entryCode,
    utm: Object.fromEntries(Object.entries(attribution.utm).filter(([, value]) => value)),
  }
}

// Chave de telefone para casar conversa e pedido SEM trocar o número entre os sistemas.
// Celular BR com ou sem o 9º dígito vira a mesma chave (55 + DDD + 8 últimos dígitos).
// O MUGOVERSO calcula a mesma chave do telefone do pedido (services/whatsapp_insights.py: phone_key).
export function phoneKeySource(value) {
  let d = digitsOnly(value)
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `55${d.slice(2, 4)}${d.slice(-8)}`
  return d.length >= 8 && d.length <= 15 ? d : ''
}

export async function phoneKey(value) {
  const source = phoneKeySource(value)
  if (!source) return null
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mugo-wa:${source}`))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
