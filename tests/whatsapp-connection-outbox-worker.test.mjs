import assert from 'node:assert/strict'
import { dryRunPending, projectEvent, retryDelayMs } from '../scripts/whatsapp-connection-outbox-worker.mjs'

const event = {
  event_id: '11111111-1111-4111-8111-111111111111',
  connection: { id: '22222222-2222-4222-8222-222222222222' },
}
let request
const projection = await projectEvent(event, {
  endpoint: 'https://internal.invalid',
  secret: 'fixture',
  fetchImpl: async (url, init) => {
    request = { url: String(url), init }
    return { status: 200, json: async () => ({ ok: true, result: 'applied' }) }
  },
})
assert.equal(projection.result.result, 'applied')
assert.match(request.url, /internal\/v1\/whatsapp\/connections\/project$/)
assert.equal(request.init.headers['X-Mugo-Event-Id'], event.event_id)
assert.equal(request.init.headers['X-Mugo-Signature-Version'], 'v1')
assert.match(request.init.headers['X-Mugo-Signature'], /^v1=[a-f0-9]{64}$/)

let dryRunMethod
const result = await dryRunPending({
  url: 'https://crm.invalid',
  key: 'fixture-service-key',
  secret: 'fixture',
  limit: 10,
  fetchImpl: async (_url, init) => {
    dryRunMethod = init.method
    return {
      ok: true,
      status: 200,
      json: async () => [{
        id: 'row-a', event_id: event.event_id,
        aggregate_id: event.connection.id, payload: event, attempts: 0,
      }],
    }
  },
})
assert.equal(dryRunMethod, 'GET')
assert.deepEqual(result, { selected: 1, dry_run: true })
assert.equal(retryDelayMs(1), 1000)
assert.equal(retryDelayMs(20), 300000)
console.log('WhatsApp outbox worker tests: ok')
