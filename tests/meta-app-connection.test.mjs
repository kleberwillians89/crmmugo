import assert from 'node:assert/strict'
import {
  metaAppEnvName,
  resolveWebhookApp,
  connectionMatchesWebhookApp,
  resolveConnectionAccessToken,
  resolveMetaTransportForConnection,
} from '../supabase/functions/_shared/metaAppConnection.js'

const env = new Map([
  ['META_APP_SECRET', 'legacy-app-secret'],
  ['META_WEBHOOK_VERIFY_TOKEN', 'legacy-verify'],
  ['META_ACCESS_TOKEN', 'legacy-token'],
  ['GRAPH_API_VERSION', 'v23.0'],
  ['META_APP_1161210926623351_APP_SECRET', 'roove-app-secret'],
  ['META_APP_1161210926623351_WEBHOOK_VERIFY_TOKEN', 'roove-verify'],
  ['META_APP_1161210926623351_ACCESS_TOKEN', 'roove-token'],
])
const getEnv = (key) => env.get(key)
const legacy = resolveWebhookApp(new URL('https://example.test/whatsapp-webhook'), getEnv)
const roove = resolveWebhookApp(new URL('https://example.test/whatsapp-webhook?meta_app_id=1161210926623351'), getEnv)
assert.equal(legacy.appSecret, 'legacy-app-secret')
assert.equal(roove.appSecret, 'roove-app-secret')
assert.equal(roove.verifyToken, 'roove-verify')
assert.notEqual(roove.appSecret, legacy.appSecret)
assert.equal(metaAppEnvName('../a', 'APP_SECRET'), null)
assert.equal(resolveWebhookApp(new URL('https://example.test/?meta_app_id=999'), getEnv), null)

const legacyConnection = { id: 'legacy-id', organization_id: 'mugo', waba_id: '111', phone_number_id: '222', credential_reference: 'env://legacy-default', metadata: {}, graph_api_version: 'v23.0' }
const rooveConnection = { id: 'roove-id', organization_id: 'roove', waba_id: '1491824329400600', phone_number_id: '1063683626819387', credential_reference: 'env://meta-app-1161210926623351', metadata: { meta_app_id: '1161210926623351' }, graph_api_version: 'v23.0' }
assert.equal(connectionMatchesWebhookApp(legacyConnection, legacy), true)
assert.equal(connectionMatchesWebhookApp(rooveConnection, legacy), false)
assert.equal(connectionMatchesWebhookApp(legacyConnection, roove), false)
assert.equal(connectionMatchesWebhookApp(rooveConnection, roove), true)
assert.equal(resolveConnectionAccessToken(legacyConnection, getEnv), 'legacy-token')
assert.equal(resolveConnectionAccessToken(rooveConnection, getEnv), 'roove-token')
assert.equal(resolveConnectionAccessToken({...rooveConnection, credential_reference:'env://legacy-default'}, getEnv), '')
assert.equal(resolveConnectionAccessToken({...rooveConnection, metadata:{}}, getEnv), '')
assert.equal(resolveConnectionAccessToken({...rooveConnection, credential_reference:'env://meta-app-999'}, getEnv), '')
const sharedAppConnection = { ...rooveConnection, id:'12345678-1234-4123-8123-123456789abc', credential_reference:'env://connection/12345678-1234-4123-8123-123456789abc' }
env.set('WHATSAPP_CONNECTION_12345678_1234_4123_8123_123456789ABC_ACCESS_TOKEN', 'dedicated-client-token')
assert.equal(resolveConnectionAccessToken(sharedAppConnection, getEnv),'dedicated-client-token')
assert.equal(resolveConnectionAccessToken({...sharedAppConnection, id:'87654321-1234-4123-8123-123456789abc'}, getEnv),'')


const fakeAdmin = {
  from(table) {
    assert.equal(table, 'whatsapp_connections')
    const checks = []
    const query = {
      select() { return query },
      eq(key,value) { checks.push([key,value]); return query },
      in() { return query },
      async maybeSingle() {
        const org = checks.find(([key])=>key==='organization_id')?.[1]
        const id = checks.find(([key])=>key==='id')?.[1]
        return {data: org === 'roove' && id === 'roove-id' ? rooveConnection : null,error:null}
      },
    }
    return query
  },
}
const transport=await resolveMetaTransportForConnection(fakeAdmin,'roove','roove-id',getEnv)
assert.deepEqual({phoneNumberId:transport.phoneNumberId,wabaId:transport.wabaId,accessToken:transport.accessToken},
  {phoneNumberId:'1063683626819387',wabaId:'1491824329400600',accessToken:'roove-token'})
assert.equal(await resolveMetaTransportForConnection(fakeAdmin,'mugo','roove-id',getEnv),null)
console.log('Meta apps / tenants: isolated credentials OK')
