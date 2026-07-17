import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {normalizeContract} from '../src/lib/normalizeContract.js'
const member=(id,name)=>({id,name,email:`${id}@mugo.test`,active:true})

let contract=normalizeContract({id:'all',responsible_id:'commercial',commercial_responsible:member('commercial','Comercial'),delivery_responsible:member('delivery','Entrega'),financial_responsible:member('financial','Financeiro')})
assert.deepEqual([contract.commercialResponsibleName,contract.deliveryResponsibleName,contract.financialResponsibleName],['Comercial','Entrega','Financeiro'])
assert.equal(contract.responsibilitySource,'contracts.responsible_id')
contract=normalizeContract({id:'commercial',responsible_id:'commercial',commercial_responsible:member('commercial','Comercial')})
assert.deepEqual([contract.commercialResponsibleName,contract.deliveryResponsibleName,contract.financialResponsibleName],['Comercial','Não definido','Não definido'])
contract=normalizeContract({id:'none'})
assert.deepEqual([contract.commercialResponsibleName,contract.deliveryResponsibleName,contract.financialResponsibleName],['Não definido','Não definido','Não definido'])
contract=normalizeContract({id:'legacy',team_members:member('legacy','Comercial legado')})
assert.equal(contract.commercialResponsibleName,'Comercial legado')
assert.equal(contract.responsibilitySource,'legacy-commercial-responsible')
assert.equal(contract.deliveryResponsible,null)
assert.equal(contract.financialResponsible,null)

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),contracts=read('src/services/data/contractsRepository.js'),finance=read('src/services/data/financeRepository.js'),assistant=read('supabase/functions/mugo-ai-assistant/index.ts'),search=read('src/components/GlobalSearch.jsx')
for(const [alias,fkey] of [['commercial_responsible','contracts_responsible_id_fkey'],['delivery_responsible','contracts_delivery_responsible_id_fkey'],['financial_responsible','contracts_financial_responsible_id_fkey']]){assert.match(contracts,new RegExp(`${alias}:team_members!${fkey}`));assert.match(finance,new RegExp(`${alias}:team_members!${fkey}`))}
assert.match(assistant,/commercial_responsible:team_members!contracts_responsible_id_fkey\(name\)/)
assert.doesNotMatch(contracts,/\*,\s*team_members\(/)
assert.doesNotMatch(finance,/contracts\([^)]*responsible_id,team_members\(/)
assert.match(contracts,/Não foi possível carregar os responsáveis dos contratos\./)
assert.match(finance,/Não foi possível carregar os responsáveis dos contratos\./)
assert.match(search,/contracts\.filter/)
assert.doesNotMatch(`${contracts}${finance}${assistant}${search}`,/sendMessage|sendTemplate/)
console.log('Contract relationships passed: explicit FK embeds, three roles, null safety, explicit legacy fallback, friendly PGRST201 handling and global search compatibility.')
