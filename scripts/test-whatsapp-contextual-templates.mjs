import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildTemplateComponents, describeTemplateFields, formatTemplateFieldOnBlur, maskTemplateRecipient, missingTemplateFields, renderTemplatePreview, suggestTemplateValues, templateCategory, templateSearchText, validateTemplateField } from '../src/services/whatsapp/templateParameters.js'

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

const appointment={name:'mugo_agendamento_confirmado',components:[{type:'BODY',text:'Olá, {{1}}. Seu atendimento com a equipe da Mugô está confirmado para {{2}}, às {{3}}.'}]}
const appointmentFields=describeTemplateFields(appointment)
assert.deepEqual(appointmentFields.map(field=>field.label),['Nome do cliente','Dia do atendimento','Horário do atendimento'])
assert.deepEqual(appointmentFields.map(field=>field.inputMode),['text','numeric','numeric'])
assert.equal(appointmentFields[2].placeholder,'Ex.: 20:30')
assert.equal(formatTemplateFieldOnBlur(appointmentFields[2],'2030'),'20:30')
assert.equal(formatTemplateFieldOnBlur({...appointmentFields[1],semantic:'date'},'10082026'),'10/08/2026')
assert.equal(validateTemplateField(appointmentFields[2],'20:30'),'')
assert.match(validateTemplateField(appointmentFields[2],'29:90'),/horário válido/)
assert.equal(validateTemplateField({...appointmentFields[1],semantic:'date'},'10/08/2026'),'')
assert.match(validateTemplateField({...appointmentFields[1],semantic:'date'},'31/02/2026'),/não existe/)
let stableValues={}
for(const character of '20:30')stableValues={...stableValues,[appointmentFields[2].key]:(stableValues[appointmentFields[2].key]||'')+character}
assert.equal(stableValues[appointmentFields[2].key],'20:30')
stableValues={...stableValues,[appointmentFields[2].key]:'19:45'}
assert.equal(stableValues[appointmentFields[2].key],'19:45')
const ordered=buildTemplateComponents(appointmentFields,{body_1:'Kleber Willians',body_2:'10',body_3:'20:30'})
assert.deepEqual(ordered[0].parameters.map(item=>item.text),['Kleber Willians','10','20:30'])
assert.equal(renderTemplatePreview(appointment,appointmentFields,{body_1:'Kleber Willians',body_2:'10',body_3:'20:30'}).body,'Olá, Kleber Willians. Seu atendimento com a equipe da Mugô está confirmado para 10, às 20:30.')

const page=fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx',import.meta.url),'utf8')
const drawer=fs.readFileSync(new URL('../src/components/WhatsAppConversationTemplateDrawer.jsx',import.meta.url),'utf8')
const css=fs.readFileSync(new URL('../src/components/WhatsAppPage.css',import.meta.url),'utf8')
const edge=fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts',import.meta.url),'utf8')
for(const token of ['composer-template','Modelos','templateDrawerOpen','serviceWindowOpen===false','idempotencyKey',"status:'sending'",'mergeMessages'])assert.ok(page.includes(token),`Fluxo ausente: ${token}`)
for(const token of ["item.status==='APPROVED'","item.is_active!==false",'template-context-filters','validateTemplateField','confirmed','aria-modal="true"',"event.key==='Escape'",'UPSTREAM_TIMEOUT'])assert.ok(drawer.includes(token),`Drawer ausente: ${token}`)
assert.match(css,/width:min\(420px,96vw\)/)
assert.match(css,/height:min\(88dvh,760px\)/)
assert.match(css,/grid-template-columns:auto auto minmax\(0,1fr\) auto/)
for(const token of ['overscroll-behavior:contain','flex:1 1 auto','overflow-y:auto','height:100%','message-composer'])assert.ok(css.includes(token),`Contrato de scroll ausente: ${token}`)
assert.doesNotMatch(`${page}\n${drawer}`,/5511972769605|WHATSAPP_TEMPLATE_TEST_PHONE/)
assert.match(page,/VITE_WHATSAPP_TEMPLATE_SEND_ENABLED/)
assert.match(page,/isAdmin&&canWrite/)
assert.match(drawer,/key=\{field\.id\|\|field\.key\}/)
assert.match(drawer,/setValues\(current=>\(\{\.\.\.current,\[field\.key\]:nextValue\}\)\)/)
assert.doesNotMatch(drawer,/\[open,onClose\]/)
for(const token of ['get_template_test_access','TEMPLATE_TEST_PHONE_FORBIDDEN','TEMPLATE_TEST_NAME_FORBIDDEN','WHATSAPP_TEMPLATE_TEST_PHONE','WHATSAPP_TEMPLATE_TEST_NAME'])assert.ok(edge.includes(token),`Proteção de homologação ausente: ${token}`)

console.log('WhatsApp contextual template selector contracts: OK')
