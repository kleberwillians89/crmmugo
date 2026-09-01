import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeBrazilianPhone } from '../src/lib/whatsapp.js'
import { validateGraph } from '../src/services/whatsapp/automationGraph.js'
import { executeGraphRun } from '../src/services/whatsapp/automationExecutor.js'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const edge = read('../supabase/functions/mugozap-api/index.ts')
const page = read('../src/components/WhatsAppPage.jsx')
const builder = read('../src/components/AutomationFlowBuilder.jsx')
const panel = read('../src/components/WhatsAppAutomationPanel.jsx')
const templateModal = read('../src/components/WhatsAppTemplateSendModal.jsx')
const repository = read('../src/services/data/automationsRepository.js')
const worker = read('../supabase/functions/whatsapp-automation-worker/index.ts')
const between = (start,end) => edge.slice(edge.indexOf(start), edge.indexOf(end, edge.indexOf(start)))

// Editor existente: carrega a definição salva, preserva o ID e cria uma nova versão.
assert.match(panel, /setDraft\(fromFlow\(flow\)\)/)
assert.match(panel, /saveAutomationFlowDefinition\(next\.id/)
assert.match(repository, /from\('automation_versions'\)[\s\S]*?\.insert\(buildVersionRow/)
assert.match(repository, /\.eq\('id', id\)[\s\S]*?active_version_id: inserted\.id/)
for (const token of ['node.position.x','node.position.y','next.definition.edges.push','branch: connecting.branch','removeNode','validateGraph']) assert.ok(builder.includes(token), `builder não preserva ${token}`)
assert.match(panel, /status === 'APPROVED' && item\.is_active !== false/)
assert.match(builder, /Selecione um template aprovado/)
assert.match(builder, /template\.display\|\|template\.name/)
assert.match(builder, /item\.config\.template_name=template\?\.name/)
assert.match(builder, /<option value="minutes">Minutos<\/option><option value="hours">Horas<\/option><option value="days">Dias<\/option>/)
assert.match(builder, /item\.config\.minutes=Math\.max\(1/)

// Definição editada continua válida e executável pelo executor atual.
const editedGraph={schema_version:2,nodes:[
  {id:'trigger_1',type:'trigger',position:{x:90,y:120},config:{trigger_type:'manual_event'}},
  {id:'wait_1',type:'wait',position:{x:360,y:220},config:{minutes:120}},
  {id:'end_1',type:'end_flow',position:{x:650,y:220},config:{}},
],edges:[{id:'edge_1',source:'trigger_1',target:'wait_1',branch:'always'},{id:'edge_2',source:'wait_1',target:'end_1',branch:'always'}]}
assert.equal(validateGraph(editedGraph).valid,true)
const execution=await executeGraphRun({definition:editedGraph,now:()=>new Date('2026-09-01T12:00:00Z')})
assert.equal(execution.status,'waiting')
assert.equal(execution.wait.resumeAt,'2026-09-01T14:00:00.000Z')

// Cadastro interno: write autorizado, tenant vindo do perfil, conexão ativa e nenhuma
// mensagem/transporte externo no bloco.
const createContact = between("if(operation==='create_whatsapp_contact'){", "if(operation==='list_crm_message_history'){")
assert.match(edge, /create_whatsapp_contact: \{ method: 'POST',[^\n]*write: true \}/)
assert.match(createContact, /organization_id',profile\.organization_id/)
assert.match(createContact, /\.eq\('status','active'\)/)
assert.match(createContact, /\.eq\('connection_id',connectionId\)\.eq\('wa_id',recipient\)/)
assert.match(createContact, /CONTACT_ALREADY_EXISTS/)
assert.match(createContact, /CONTACT_CLIENT_CONFLICT/)
assert.match(createContact, /CLIENT_NOT_FOUND/)
assert.doesNotMatch(createContact, /sendMetaMessage|MUGOZAP|whatsapp_messages|whatsapp_conversations|provider_message_id/)
assert.match(page, /await createCrmWhatsAppContact\(payload\);await loadContacts\(\)/)
assert.match(page, /\+ Novo contato/)
assert.match(page, /contacts=\{whatsappContacts\}/)
assert.match(templateModal, /Contatos do WhatsApp/)
assert.match(templateModal, /contact\?\.waId\|\|contact\?\.wa_id/)
for(const input of ['11 99999-9999','(11) 99999-9999','+55 11 99999-9999'])assert.equal(normalizeBrazilianPhone(input),'5511999999999')

// Produção: não há whitelist de homologação no caminho normal; template e destinatário
// são revalidados dentro do tenant antes de sendMetaMessage.
const sendTemplate = between("if(operation==='send_template_message'){", 'const identifierOperations =')
assert.doesNotMatch(sendTemplate, /WHATSAPP_TEMPLATE_TEST_PHONE|WHATSAPP_TEMPLATE_TEST_NAME|authorizedPhone|authorizedTemplate|TEMPLATE_TEST_PHONE_FORBIDDEN|TEMPLATE_TEST_NAME_FORBIDDEN/)
assert.match(sendTemplate, /\.eq\('organization_id',profile\.organization_id\)\.eq\('waba_id',wabaId\)[\s\S]*?\.eq\('status','APPROVED'\)\.eq\('is_active',true\)/)
assert.match(sendTemplate, /from\('whatsapp_contacts'\)[\s\S]*?\.eq\('organization_id',profile\.organization_id\)[\s\S]*?\.eq\('connection_id',tenantConnectionId\)\.eq\('wa_id',recipient\)/)
assert.match(sendTemplate, /from\('clients'\)[\s\S]*?\.eq\('id',genericTemplateClientId\)\.eq\('organization_id',profile\.organization_id\)/)
assert.match(sendTemplate, /TEMPLATE_RECIPIENT_NOT_REGISTERED/)
assert.match(sendTemplate, /PHONE_MISMATCH/)
assert.match(sendTemplate, /TEMPLATE_NOT_APPROVED/)
assert.match(sendTemplate, /organizationClients[\s\S]*?\.eq\('organization_id',profile\.organization_id\)[\s\S]*?billing_contact_phone/)
assert.equal((sendTemplate.match(/await sendMetaMessage\(/g)||[]).length,1)

// Automação continua aceitando qualquer APPROVED+ACTIVE do WABA do tenant, enquanto
// mensagem livre mantém a janela de atendimento.
assert.match(worker, /send_template:[\s\S]*?\.eq\('organization_id', organizationId\)[\s\S]*?\.eq\('waba_id', meta\.wabaId\)[\s\S]*?\.eq\('status', 'APPROVED'\)\.eq\('is_active', true\)/)
assert.match(worker, /send_message:[\s\S]*?service_window_expires_at[\s\S]*?SERVICE_WINDOW_CLOSED/)

console.log('WhatsApp automation editor, contacts and production templates: OK')
