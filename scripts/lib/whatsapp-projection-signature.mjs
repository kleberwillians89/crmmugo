import crypto from 'node:crypto'

export const SIGNATURE_VERSION = 'v1'

export function bodyHash(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex')
}

export function signProjection(secret, { eventId, timestamp, rawBody }) {
  if (!secret || !eventId || !timestamp) throw new Error('PROJECTION_SIGNATURE_INPUT_MISSING')
  const canonical = `${SIGNATURE_VERSION}\n${eventId}\n${timestamp}\n${bodyHash(rawBody)}`
  const digest = crypto.createHmac('sha256', secret).update(canonical).digest('hex')
  return `${SIGNATURE_VERSION}=${digest}`
}
