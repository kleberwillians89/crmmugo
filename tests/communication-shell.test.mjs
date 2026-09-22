import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const routes = read('../src/config/appRoutes.js')
const app = read('../src/App.jsx')
const page = read('../src/components/WhatsAppPage.jsx')
const nav = read('../src/config/navigationGroups.js')
const usage = read('../src/components/WhatsAppUsagePanel.jsx')

// ---------------------------------------------------------------------------
// Rotas da área de Comunicação existem e apontam para os caminhos esperados.
// ---------------------------------------------------------------------------
for (const [pageId, path] of [
  ['inbox', '/comunicacao/caixa-de-entrada'],
  ['contacts', '/contatos'],
  ['automations', '/comunicacao/automacoes'],
  ['templates', '/comunicacao/templates'],
  ['collections', '/financeiro/cobrancas'],
  ['whatsapp', '/whatsapp'],
]) assert.match(routes, new RegExp(`${JSON.stringify(pageId).replace(/"/g, '"?')}\\s*:\\s*"${path.replace(/\//g, '\\/')}"`), `rota ${pageId} → ${path}`)

// App renderiza essas seções pelo mesmo componente (nada duplicado).
assert.match(app, /const WHATSAPP_DOMAIN_SECTIONS = \{[\s\S]*?contacts: "contacts"[\s\S]*?inbox: "inbox"[\s\S]*?automations: "automations"[\s\S]*?templates: "templates"[\s\S]*?whatsapp: "channel"[\s\S]*?collections: "collections"[\s\S]*?\}/)
assert.match(app, /whatsappDomainSection && \(\s*<WhatsAppPage\s+section=\{whatsappDomainSection\}/)
assert.equal((app.match(/<WhatsAppPage\b/g) || []).length, 1, 'WhatsAppPage é montado uma única vez no App')

// ---------------------------------------------------------------------------
// 1) Subnavegação horizontal de comunicação — aponta para rotas existentes.
// ---------------------------------------------------------------------------
assert.match(page, /const COMMUNICATION_NAV = \[[\s\S]*?\['inbox', 'Caixa de entrada'\][\s\S]*?\['contacts', 'Contatos'\][\s\S]*?\['collections', 'Cobranças'\][\s\S]*?\['templates', 'Templates'\][\s\S]*?\['automations', 'Automações'\][\s\S]*?\]/)
assert.match(page, /COMMUNICATION_SECTIONS\.has\(section\)[\s\S]*?whatsapp-domain-nav[\s\S]*?COMMUNICATION_NAV\.map\(\(\[id,label\]\)=>[\s\S]*?onNavigate\(id\)/)

// ---------------------------------------------------------------------------
// 2 + 5) Caixa de entrada mostra "Novo contato" e "Cobrar cliente".
// ---------------------------------------------------------------------------
const header = page.slice(page.indexOf('whatsapp-header-actions'), page.indexOf('</header>', page.indexOf('whatsapp-header-actions')))
assert.match(header, /section==='inbox'\|\|section==='contacts'[\s\S]*?setNewContactOpen\(true\)[\s\S]*?Novo contato/)
assert.match(header, /section==='inbox'&&<button[\s\S]*?onNavigate\('collections'\)[\s\S]*?Cobrar cliente/)

// ---------------------------------------------------------------------------
// 2 + 3) Novo contato abre o modal existente e recarrega a lista após criar.
// ---------------------------------------------------------------------------
assert.match(page, /import \{ WhatsAppNewContactModal \} from '\.\/WhatsAppNewContactModal'/)
assert.match(page, /\{newContactOpen&&<WhatsAppNewContactModal [\s\S]*?onSave=\{createWhatsAppContact\}/)
assert.match(page, /async function createWhatsAppContact\(payload\)\{[\s\S]*?await createCrmWhatsAppContact\(payload\)[\s\S]*?await loadContacts\(\)/)

// ---------------------------------------------------------------------------
// 4) Contato pode iniciar template (painel de templates recebe contatos + envio).
// ---------------------------------------------------------------------------
assert.match(page, /tab==='templates'&&<WhatsAppTemplatesPanel [^>]*contacts=\{whatsappContacts\}[^>]*onSendTemplate=\{sendApprovedTemplate\}/)

// ---------------------------------------------------------------------------
// 6) "Cobrar" reutiliza o fluxo existente — nenhum novo transporte de envio.
// ---------------------------------------------------------------------------
assert.match(page, /startTemplateConversation\(\{client_id:collectionTarget\.client\.id,installment_id:collectionTarget\.installment\.id/)
assert.match(page, /async function openCollection\(item\)/)
assert.doesNotMatch(page, /fetch\(\s*['"`]https:\/\/graph\.facebook\.com/, 'a página não fala direto com a Meta — isso é backend')

// ---------------------------------------------------------------------------
// 6-técnico) "Uso e custos": estado neutro, sem erro vermelho estrutural do MugoZap.
// ---------------------------------------------------------------------------
assert.match(usage, /USAGE_UNAVAILABLE_CODES=new Set\(\[[\s\S]*?'UPSTREAM_NOT_FOUND'/)
assert.match(usage, /const usageUnavailable=cause=>USAGE_UNAVAILABLE_CODES\.has\(cause\?\.code\)/)
assert.match(usage, /if\(usageUnavailable\(cause\)\)\{setUnavailable\(true\);setError\(''\)\}/)
assert.match(usage, /Dados de uso ainda não disponíveis\./)
assert.doesNotMatch(usage, /Contadores reais do MugoZap/)

// ---------------------------------------------------------------------------
// 8) /financeiro/cobrancas e /financeiro/fluxo-de-caixa têm destino no App.
// ---------------------------------------------------------------------------
assert.match(app, /activePage === "cash-flow" &&[\s\S]*?<CashFlowPage \/>/)
// collections é servido pela seção de comunicação (não há tela órfã).
assert.match(app, /collections: "collections"/)

// ---------------------------------------------------------------------------
// 10) Automação intacta — editor e núcleo não foram tocados por esta entrega.
// ---------------------------------------------------------------------------
const panel = read('../src/components/WhatsAppAutomationPanel.jsx')
assert.match(panel, /import \{ AutomationFlowBuilder \} from '\.\/AutomationFlowBuilder'/)
assert.match(page, /tab==='automations'&&<WhatsAppAutomationPanel canWrite=\{canWrite\}/) // renderizado igual
const builder = read('../src/components/AutomationFlowBuilder.jsx')
assert.ok(builder.length > 1000, 'AutomationFlowBuilder continua presente')

// ---------------------------------------------------------------------------
// Sidebar por domínios preservada (não voltou para a lista plana antiga).
// ---------------------------------------------------------------------------
assert.match(nav, /id:\s*"communication"[\s\S]*?label:\s*"Comunicação"/)
assert.match(nav, /id:\s*"finance"[\s\S]*?label:\s*"Financeiro"/)

console.log('Communication shell + navigation: OK')
