import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildDuplicateGroups, compareClients, digits, nameSimilarity, normalizeEmail, normalizeInstagram, normalizeName, normalizePhone, normalizeWebsite } from '../src/lib/clientDeduplication.js'

assert.equal(normalizeName('Mugô Serviços LTDA.'),'mugo')
assert.equal(normalizeName('  Santo   Circuito EPP '),'santo circuito')
assert.equal(digits('12.345.678/0001-90'),'12345678000190')
assert.equal(normalizePhone('(11) 99999-0000'),'5511999990000')
assert.equal(normalizeEmail(' TESTE@MUGO.COM '),'teste@mugo.com')
assert.equal(normalizeWebsite('https://www.mugo.com.br/'),'mugo.com.br')
assert.equal(normalizeInstagram('https://instagram.com/Mugo/'),'mugo')
assert.ok(nameSimilarity('Santo Circuito','Santo Circuto')>.78)
const organization='00000000-0000-0000-0000-000000000001'
const clients=[{id:'a',organization_id:organization,company_name:'Amalie LTDA',document_number:'123',phone:'11999990000'},{id:'b',organization_id:organization,company_name:'Amálie',document_number:'123',phone:'5511999990000'},{id:'c',organization_id:organization,company_name:'Outro cliente'}]
assert.equal(compareClients(clients[0],clients[1]).level,'strong')
assert.equal(compareClients(clients[0],{...clients[1],organization_id:'other'}).level,'blocked')
const groups=buildDuplicateGroups(clients)
assert.equal(groups.length,1)
assert.deepEqual(groups[0].members.map((item)=>item.id),['a','b'])

const page=fs.readFileSync(new URL('../src/components/ClientsPage.jsx',import.meta.url),'utf8')
assert.ok(page.indexOf('client-list-primary')<page.indexOf('client-form-drawer'),'A lista precisa aparecer antes do formulário')
assert.match(page,/formOpen\s*&&/)
assert.match(page,/Novo cliente/)
assert.match(page,/client-cards-mobile/)
assert.doesNotMatch(page,/deleteDocument|Excluir este documento/)
const migration=fs.readFileSync(new URL('../supabase/migrations/202608030003_client_deduplication_and_merge.sql',import.meta.url),'utf8')
for(const token of ['data_merge_batches','data_merge_items','duplicate_review_status','preview_client_merge','execute_client_merge','current_organization_id','can_write','for update','approved_preview','request_key'])assert.ok(migration.includes(token),`Garantia ausente: ${token}`)
assert.doesNotMatch(migration,/delete from public\.(clients|contracts|proposals|invoice_installments|payments|documents)/i)
assert.match(migration,/update public\.clients set status='archived'/)
assert.match(migration,/invoice_installments/)
assert.match(migration,/whatsapp_conversation_links/)
console.log('CRM V2 client deduplication and consolidation: ok')
