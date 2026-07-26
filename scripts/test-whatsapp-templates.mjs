import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeBrazilianPhone } from '../src/services/whatsapp/phoneNormalization.js'
import { isTemplateAvailable } from '../src/services/whatsapp/templateStatus.js'

const target={name:'mugo_alerta_pagamento_pendente',language:'pt_BR',status:'ACTIVE',quality:'UNKNOWN'}
assert.equal(isTemplateAvailable(target.name,[target]),true)
assert.equal(isTemplateAvailable(target.name,[{...target,status:'APPROVED'}]),true)
assert.equal(isTemplateAvailable(target.name,[{...target,status:'PENDING'}]),false)
assert.equal(isTemplateAvailable(target.name,[{...target,status:'PAUSED'}]),false)
assert.equal(isTemplateAvailable(target.name,[{...target,status:'REJECTED'}]),false)
assert.equal(isTemplateAvailable(target.name,[{...target,language:'en_US'}]),false)
assert.equal(target.quality,'UNKNOWN','Qualidade pendente não altera a disponibilidade')

assert.equal(normalizeBrazilianPhone('+55 (11) 99999-9999'),'5511999999999')
assert.equal(normalizeBrazilianPhone('(11) 99999-9999'),'5511999999999')
assert.equal(normalizeBrazilianPhone('555511999999999'),null)
assert.equal(normalizeBrazilianPhone('123'),null)

const edge=fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts',import.meta.url),'utf8')
for(const expected of [
  'WABA_ID','PHONE_NUMBER_ID','META_ACCESS_TOKEN','GRAPH_API_VERSION',
  '/message_templates?fields=','quality_score','item.name===templateName&&item.language===language',
  "['ACTIVE','APPROVED']",'requiredBodyParameters','requiredHeaderParameters',
  'parameters:requiredBodyParameters?[safeName]:[]','provider_message_id || sent.messages?.[0]?.id',
  'META_TOKEN_EXPIRED','META_PERMISSION_MISSING','TEMPLATE_NOT_FOUND',
  'TEMPLATE_PARAMETERS_MISSING','MESSAGE_SEND_UNCONFIRMED',
])assert.ok(edge.includes(expected),`Contrato ausente: ${expected}`)
for(const status of [400,401,403])assert.match(edge,new RegExp(`status === ${status}|status === 401|status === 403`))
assert.match(edge,/duplicateResult/)
assert.match(edge,/status:'sending'/)
assert.match(edge,/sanitized_payload/)
for(const line of edge.split('\n').filter(value=>value.includes('console.log')))assert.doesNotMatch(line,/META_ACCESS_TOKEN|accessToken|Authorization/)

const modal=fs.readFileSync(new URL('../src/components/StartWhatsAppConversationModal.jsx',import.meta.url),'utf8')
assert.match(modal,/Template ativo e disponível para envio/)
assert.match(modal,/Sincronizar status/)
assert.match(modal,/loading/)

console.log('WhatsApp template sync and send contracts: OK')
