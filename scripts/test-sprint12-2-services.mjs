import assert from 'node:assert/strict'
import {normalizeService,SERVICE_STATUS_LABELS} from '../src/lib/normalizeService.js'
import {normalizeContract} from '../src/lib/normalizeContract.js'
const profiles={julia:{id:'julia',name:'Julia'},kleber:{id:'kleber',name:'Kleber'}}
const social=normalizeService({id:'social',service_name:'Gestão de Mídias Sociais',service_status:'active',commercial_responsible_id:'julia',delivery_responsible_id:'julia',support_responsible_id:'julia',commercial_responsible:profiles.julia,delivery_responsible:profiles.julia,support_responsible:profiles.julia,monthly_value:2000,scope_summary:'Gestão dos canais',deliverables:'Calendário mensal'})
const traffic=normalizeService({id:'traffic',service_name:'Gestão de Tráfego Pago',service_status:'approved',commercial_responsible_id:'kleber',delivery_responsible_id:'kleber',support_responsible_id:'julia',commercial_responsible:profiles.kleber,delivery_responsible:profiles.kleber,support_responsible:profiles.julia,monthly_value:2000})
const contract=normalizeContract({id:'amalie',status:'draft',clients:{company_name:'AMALIE CONFECÇÕES LTDA'},contract_services:[social,traffic]})
assert.equal(contract.services.length,2)
assert.equal(contract.services[0].commercialResponsible.name,'Julia')
assert.equal(contract.services[1].deliveryResponsible.name,'Kleber')
assert.equal(contract.services[1].supportResponsible.name,'Julia')
assert.equal(SERVICE_STATUS_LABELS.active,'Em execução')
assert.equal(contract.services.reduce((sum,item)=>sum+item.monthlyValue,0),4000)
