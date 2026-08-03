import assert from 'node:assert/strict'
import { bodyHash, SIGNATURE_VERSION, signProjection } from '../scripts/lib/whatsapp-projection-signature.mjs'

const input = { eventId: '11111111-1111-4111-8111-111111111111', timestamp: '1000', rawBody: '{"ok":true}' }
const signature = signProjection('fixture-secret', input)
assert.equal(SIGNATURE_VERSION, 'v1')
assert.match(signature, /^v1=[a-f0-9]{64}$/)
assert.equal(bodyHash(input.rawBody).length, 64)
assert.equal(signature, signProjection('fixture-secret', input))
assert.notEqual(signature, signProjection('fixture-secret', { ...input, eventId: 'other' }))
assert.notEqual(signature, signProjection('fixture-secret', { ...input, rawBody: '{"ok":false}' }))
assert.throws(() => signProjection('', input), /INPUT_MISSING/)
console.log('WhatsApp projection signature tests: ok')
