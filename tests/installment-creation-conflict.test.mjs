import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
const values={contract_id:'contract',client_id:'client',installment_type:'monthly',reference_month:'2026-10-01',installment_number:2,amount:300,due_date:'2026-10-30',status:'pending'}
function fixture({existing=[],collision=false}={}){
  let inserts=0
  const rows=[...existing]
  const db=()=>({from(){let filters=[],inserted,mode='read';const query={select(){return query},eq(key,value){filters.push(row=>row[key]===value);return query},limit(){return query},insert(row){inserted=row;mode='insert';inserts++;return query},single(){return Promise.resolve(run(true))},maybeSingle(){return Promise.resolve(run(true))},then(resolve,reject){return Promise.resolve(run(false)).then(resolve,reject)}};function run(single){if(mode==='insert'){if(collision){if(!rows.length)rows.push({...inserted,id:'winner',installment_number:1});return {error:{code:'23505',message:'duplicate key value violates unique constraint "invoice_installments_contract_type_competence_unique"'}}}const row={...inserted,id:'new'};rows.push(row);return{data:row,error:null}}const matches=rows.filter(row=>filters.every(filter=>filter(row)));return{data:single?matches[0]||null:matches,error:null}}return query}})
  const source=fs.readFileSync('src/services/data/financeRepository.js','utf8').replace(/^import .*\n/gm,'').replace(/\bexport /g,'').replaceAll('import.meta.env.DEV','false')
  const create=vm.runInNewContext(source+'\ncreateInstallment',{db,isSupabaseProvider:()=>true,organizationId:async()=> 'org',unwrap:result=>{if(result.error)throw result.error;return result.data},Map,JSON,Number,Error,invalidateCrmData:()=>{}})
  return {create,rows,inserts:()=>inserts}
}
test('existing monthly installment is located even with a different installment number',async()=>{
  const h=fixture({existing:[{...values,id:'existing',organization_id:'org',installment_number:1,received_amount:150}]})
  await assert.rejects(h.create(values),error=>error.code==='INSTALLMENT_ALREADY_EXISTS'&&error.existingInstallment.id==='existing'&&/já existe/i.test(error.message))
  assert.equal(h.inserts(),0);assert.equal(h.rows[0].received_amount,150)
})
test('number constraint also blocks a different type without overwriting existing row',async()=>{
  const h=fixture({existing:[{...values,id:'existing',organization_id:'org',installment_type:'setup'}]})
  await assert.rejects(h.create(values),error=>error.code==='INSTALLMENT_ALREADY_EXISTS')
  assert.equal(h.inserts(),0)
})
test('race is recovered into a readable conflict with the winning row',async()=>{
  const h=fixture({collision:true})
  await assert.rejects(h.create(values),error=>error.code==='INSTALLMENT_ALREADY_EXISTS'&&error.existingInstallment.id==='winner'&&!/unique constraint/.test(error.message))
  assert.equal(h.rows.length,1)
})
test('same double-submit shares a single insert and preserves values',async()=>{
  const h=fixture();const result=await Promise.all([h.create(values),h.create(values)])
  assert.equal(h.inserts(),1);assert.deepEqual(result[0],result[1]);assert.equal(result[0].amount,300);assert.equal(result[0].due_date,'2026-10-30')
})
test('unsupported types never reach insert; extra nature remains allowed',async()=>{
  for(const type of ['project','other']){const h=fixture();await assert.rejects(h.create({...values,installment_type:type}),error=>error.code==='INVALID_INSTALLMENT_TYPE');assert.equal(h.inserts(),0)}
  const h=fixture();assert.equal((await h.create({...values,installment_type:'setup',revenue_type:'extra'})).revenue_type,'extra')
})
test('form serializes competence to the first day without changing due date and synchronously guards submit',()=>{
  const form=fs.readFileSync('src/components/InstallmentFormModal.jsx','utf8')
  assert.match(form,/reference_month:`\$\{\(form.reference_month\|\|form.due_date\)\.slice\(0,7\)\}-01`/)
  assert.match(form,/if\(savingRef.current\)return/)
  assert.doesNotMatch(form,/<option value="(?:project|other)">/)
})
