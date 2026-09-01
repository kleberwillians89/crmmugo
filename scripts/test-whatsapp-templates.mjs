import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeBrazilianPhone } from '../src/services/whatsapp/phoneNormalization.js'
import { isTemplateAvailable } from '../src/services/whatsapp/templateStatus.js'

const target={name:'mugo_alerta_pagamento_pendente',language:'pt_BR',status:'ACTIVE',quality:'UNKNOWN'}
assert.equal(isTemplateAvailable(target.name,[target]),false)
assert.equal(isTemplateAvailable(target.name,[{...target,status:'APPROVED'}]),true)
assert.equal(isTemplateAvailable(target.name,[{...target,status:'APPROVED',is_active:false}]),false)
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
  "metaStatus(value) === 'APPROVED'",'requiredBodyParameters','requiredHeaderParameters','requiresCoupon',
  'parameters:requiredBodyParameters?[safeName]:[]','collectionSend.body?.messages?.[0]?.id','homologationSend.body?.messages?.[0]?.id',
  'META_TOKEN_EXPIRED','META_PERMISSION_MISSING','TEMPLATE_NOT_FOUND',
  'TEMPLATE_PARAMETERS_MISSING','TEMPLATE_COUPON_REQUIRED','MESSAGE_SEND_UNCONFIRMED',
  'list_templates','raw_payload','rejected_reason','parameter_format','META_PAGINATION_LIMIT',
  'request_id','TEMPLATE_STORAGE_WRITE_FAILED','TEMPLATE_RECONCILIATION_FAILED',
])assert.ok(edge.includes(expected),`Contrato ausente: ${expected}`)
assert.match(edge,/page<100/)
assert.match(edge,/AbortSignal\.timeout/)
assert.match(edge,/onConflict:'organization_id,waba_id,name,language'/)
assert.match(edge,/is_active:false/)
for(const status of [400,401,403])assert.match(edge,new RegExp(`status === ${status}|status === 401|status === 403`))
assert.match(edge,/duplicateResult/)
assert.match(edge,/status:'sending'/)
assert.match(edge,/sanitized_payload/)
// start_template_conversation e send_template_message enviam direto pela Meta Cloud API.
assert.match(edge,/sendMetaMessage\(config, collectionMetaPayload\)/)
assert.match(edge,/sendMetaMessage\(homologationConfig,homologationMetaPayload\)/)
assert.match(edge,/buildTemplateMetaPayload\(normalizedPhone, templateName, language, collectionComponents\)/)
assert.doesNotMatch(edge,/fetch\(`\$\{apiUrl\}`?\$\{path\}`\)?[\s\S]{0,200}start-template/)
for(const line of edge.split('\n').filter(value=>value.includes('console.log')))assert.doesNotMatch(line,/META_ACCESS_TOKEN|accessToken|Authorization/)

const modal=fs.readFileSync(new URL('../src/components/StartWhatsAppConversationModal.jsx',import.meta.url),'utf8')
assert.match(modal,/Template ativo e disponível para envio/)
assert.match(modal,/Sincronizar status/)
assert.match(modal,/loading/)

const migration=fs.readFileSync(new URL('../supabase/migrations/202607270001_whatsapp_templates_production.sql',import.meta.url),'utf8')
for(const field of ['waba_id','rejected_reason','parameter_format','raw_payload','last_synced_at','is_active','meta_template_id','raw_response','pricing_category'])assert.match(migration,new RegExp(field))
assert.match(migration,/organization_id,waba_id,name,language/)
assert.match(migration,/where provider_message_id is not null/)

const catalog=fs.readFileSync(new URL('../src/services/whatsapp/templateCatalog.js',import.meta.url),'utf8')
assert.match(catalog,/listStoredWhatsAppTemplates/)
assert.match(catalog,/syncWhatsAppTemplates/)
assert.match(catalog,/sessionCache\.length\?sessionCache/)

const pages=[
  {data:[{id:'1',name:'approved',language:'pt_BR',status:'APPROVED'}],paging:{next:'page-2'}},
  {data:[{id:'2',name:'pending',language:'pt_BR',status:'PENDING'}],paging:{}},
]
const paginated=pages.flatMap(page=>page.data)
assert.deepEqual(paginated.map(item=>item.status),['APPROVED','PENDING'])
const existing=[{id:'local-1',meta_template_id:'1'},{id:'local-removed',meta_template_id:'removed'}]
const received=new Set(paginated.map(item=>item.id))
assert.deepEqual(existing.filter(item=>!received.has(item.meta_template_id)).map(item=>item.id),['local-removed'])

console.log('WhatsApp template sync and send contracts: OK')
