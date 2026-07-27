import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describeTemplateFields, maskTemplateRecipient, missingTemplateFields, renderTemplatePreview, suggestTemplateValues, templateCategory, templateSearchText } from '../src/services/whatsapp/templateParameters.js'

const template={
  name:'mugo_pagamento_confirmado',
  display:'Pagamento confirmado',
  category:'UTILITY',
  language:'pt_BR',
  status:'APPROVED',
  preview:'Olá, {{cliente_nome}}. Contrato {{numero_contrato}}.',
  components:[
    {type:'BODY',text:'Olá, {{cliente_nome}}. Contrato {{numero_contrato}}.'},
    {type:'FOOTER',text:'Equipe Mugô'},
  ],
}
const fields=describeTemplateFields(template)
const values=suggestTemplateValues(fields,{client:{contact_name:'Cliente Teste'},contract:{number:'C-42'}})
assert.deepEqual(values,{body_cliente_nome:'Cliente Teste',body_numero_contrato:'C-42'})
assert.equal(missingTemplateFields(fields,values).length,0)
assert.equal(suggestTemplateValues(fields,{client:{}}).body_cliente_nome,undefined)
assert.equal(templateCategory(template),'utility')
assert.match(templateSearchText(template),/pagamento confirmado/)
assert.equal(maskTemplateRecipient('5511972769605'),'•••••••••9605')
assert.deepEqual(renderTemplatePreview(template,fields,values),{header:'',body:'Olá, Cliente Teste. Contrato C-42.',footer:'Equipe Mugô',buttons:[]})

const page=fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx',import.meta.url),'utf8')
const drawer=fs.readFileSync(new URL('../src/components/WhatsAppConversationTemplateDrawer.jsx',import.meta.url),'utf8')
const css=fs.readFileSync(new URL('../src/components/WhatsAppPage.css',import.meta.url),'utf8')
for(const token of ['composer-template','Modelos','templateDrawerOpen','serviceWindowOpen===false','idempotencyKey',"status:'sending'",'mergeMessages'])assert.ok(page.includes(token),`Fluxo ausente: ${token}`)
for(const token of ["item.status==='APPROVED'","item.is_active!==false",'template-context-filters','missingTemplateFields','confirmed','aria-modal="true"',"event.key==='Escape'",'UPSTREAM_TIMEOUT'])assert.ok(drawer.includes(token),`Drawer ausente: ${token}`)
assert.match(css,/width:min\(420px,96vw\)/)
assert.match(css,/height:min\(88dvh,760px\)/)
assert.match(css,/grid-template-columns:auto auto minmax\(0,1fr\) auto/)
for(const token of ['overscroll-behavior:contain','flex:1 1 auto','overflow-y:auto','height:100%','message-composer'])assert.ok(css.includes(token),`Contrato de scroll ausente: ${token}`)
assert.doesNotMatch(`${page}\n${drawer}`,/5511972769605|WHATSAPP_TEMPLATE_TEST_PHONE/)
assert.match(page,/VITE_WHATSAPP_TEMPLATE_SEND_ENABLED/)
assert.match(page,/isAdmin&&canWrite/)

console.log('WhatsApp contextual template selector contracts: OK')
