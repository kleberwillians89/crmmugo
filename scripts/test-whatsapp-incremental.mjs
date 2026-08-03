import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getMetaCredentialStatus } from '../src/services/whatsapp/metaCredentialStatus.js'
import { buildTemplateComponents, describeTemplateFields, missingTemplateFields, normalizeTemplateRecipient } from '../src/services/whatsapp/templateParameters.js'

assert.equal(getMetaCredentialStatus('',new Date('2026-07-27T12:00:00Z')).state,'unknown')
assert.equal(getMetaCredentialStatus('2026-07-20T00:00:00Z',new Date('2026-07-27T12:00:00Z')).state,'expired')
assert.equal(getMetaCredentialStatus('2026-08-05T00:00:00Z',new Date('2026-07-27T12:00:00Z')).state,'warning')
const credential=getMetaCredentialStatus('2026-09-25T23:59:59-03:00',new Date('2026-07-27T12:00:00Z'))
assert.equal(credential.state,'valid')
assert.match(credential.message,/25 de setembro de 2026/)

const template={components:[
  {type:'HEADER',format:'IMAGE'},
  {type:'BODY',text:'Olá {{1}}, código {{2}}'},
  {type:'BUTTONS',buttons:[{type:'COPY_CODE'},{type:'URL',url:'https://example.com/{{1}}'}]},
]}
const fields=describeTemplateFields(template)
assert.equal(fields.length,5)
const values=Object.fromEntries(fields.map(field=>[field.key,field.kind==='coupon_code'?'CODIGO':field.kind==='image'?'https://example.com/a.jpg':'Maria']))
assert.equal(missingTemplateFields(fields,values).length,0)
const components=buildTemplateComponents(fields,values)
assert.deepEqual(components.find(item=>item.sub_type==='copy_code'),{type:'button',sub_type:'copy_code',index:'0',parameters:[{type:'coupon_code',coupon_code:'CODIGO'}]})
assert.equal(normalizeTemplateRecipient('+55 (11) 99999-9999'),'5511999999999')
assert.equal(normalizeTemplateRecipient('(11) 99999-9999'),'')

const edge=fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts',import.meta.url),'utf8')
for(const token of ['send_template_message','TEMPLATE_NOT_APPROVED','TEMPLATE_PARAMETERS_INVALID','TEMPLATE_PARAMETERS_MISSING','provider_message_id'])assert.match(edge,new RegExp(token))
const page=fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx',import.meta.url),'utf8')
for(const token of ['postgres_changes','removeChannel','visibilityState','30000','60000','mergeMessages','shouldAutoScrollRef','realtimeConnectedRef'])assert.match(page,new RegExp(token))
assert.match(page,/import\.meta\.env\.DEV/)
assert.doesNotMatch(page,/META_ACCESS_TOKEN/)

console.log('WhatsApp incremental sprint contracts: OK')
