import assert from 'node:assert/strict'
import { findFinancialImportMatch, normalizeFinancialName, validateFinancialImportRow } from '../src/lib/financialImport.js'

assert.equal(normalizeFinancialName(' Inteligência Artificial '),'inteligencia artificial')
const valid={key:'mugo-v1:canva',name:'Canva',amount:40,start_date:'2026-08-01',due_day:10,scope:'business',business_percentage:100}
assert.deepEqual(validateFinancialImportRow(valid),{valid:true,errors:[]})
assert.equal(validateFinancialImportRow({...valid,amount:''}).valid,false)
assert.equal(validateFinancialImportRow({...valid,due_day:0}).valid,false)
assert.equal(validateFinancialImportRow({...valid,scope:'shared',business_percentage:101}).valid,false)
assert.equal(validateFinancialImportRow({...valid,scope:'personal',business_percentage:0}).valid,true)
assert.equal(validateFinancialImportRow({...valid,scope:'pending_review',business_percentage:0}).valid,true)
const existing=[{id:'1',name:'Canva',import_key:'mugo-v1:canva'}]
assert.equal(findFinancialImportMatch(valid,existing)?.id,'1')
assert.equal(findFinancialImportMatch({...valid,key:'other',name:'Cánva'},existing)?.id,'1')
console.log('CRM V2 controlled import: ok')
