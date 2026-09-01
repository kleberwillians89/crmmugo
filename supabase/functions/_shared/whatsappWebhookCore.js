export const webhookText = (value, max = 500) => String(value ?? '').trim().slice(0, max)
export const webhookDigits = (value) => webhookText(value, 40).replace(/\D/g, '')
export const webhookTimestamp = (value, now = () => new Date()) => {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : now().toISOString()
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('')

export const verifyMetaSignature = async (body, signature, secret) => {
  if (!secret || !signature.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = `sha256=${hex(await crypto.subtle.sign('HMAC', key, body))}`
  if (expected.length !== signature.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  return difference === 0
}

export const hashWebhookPayload = async (value) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))

export const verifyWebhookChallenge = (searchParams, verifyToken) =>
  Boolean(verifyToken && searchParams.get('hub.mode') === 'subscribe' && searchParams.get('hub.verify_token') === verifyToken)

export const webhookMessageContent = (message) => {
  const type = webhookText(message?.type, 40) || 'unknown'
  if (type === 'text') return { type, body: webhookText(message?.text?.body, 4000), media: {} }
  if (type === 'interactive') return { type, body: webhookText(message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title, 4000), media: { reply_id: webhookText(message?.interactive?.button_reply?.id || message?.interactive?.list_reply?.id, 200) } }
  if (type === 'button') return { type, body: webhookText(message?.button?.text, 4000), media: { payload: webhookText(message?.button?.payload, 500) } }
  const media = message?.[type] || {}
  return { type, body: webhookText(media?.caption, 4000), media: { id: webhookText(media?.id, 200), mime_type: webhookText(media?.mime_type, 120), sha256: webhookText(media?.sha256, 200), filename: webhookText(media?.filename, 240) } }
}

export const META_STATUS_RANK = Object.freeze({ queued: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5 })
export const shouldApplyMetaStatus = (current, next) => {
  if (!(next in META_STATUS_RANK)) return false
  if (['delivered', 'read'].includes(current) && next === 'failed') return false
  return next === 'failed' || (META_STATUS_RANK[current] ?? 0) <= META_STATUS_RANK[next]
}

export const inboundEventKey = (providerMessageId) => `message:${webhookText(providerMessageId, 240)}`
export const statusEventKey = (providerMessageId, status, timestamp) => `status:${webhookText(providerMessageId, 240)}:${webhookText(status, 30).toLowerCase()}:${webhookText(timestamp, 40)}`
