import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import {execFileSync,spawn} from 'node:child_process'

const org='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002',contract='20000000-0000-4000-8000-000000000001'
const values={organization_id:foreign,contract_id:contract,installment_type:'monthly',reference_month:'2026-10-01',installment_number:2,amount:300,due_date:'2026-10-30',status:'pending'}
const lit=value=>value===null?'null':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`
test('isolated PostgreSQL: installment indexes, real repository concurrency, RLS and no financial overwrite',{timeout:30000},async(t)=>{
  const dir=fs.mkdtempSync('/private/tmp/mugo-installment-pg-')
  const args=['-X','-qAt','-h',dir,'-p','55495','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
  let started=false
  t.after(()=>{if(started)execFileSync('pg_ctl',['-D',`${dir}/data`,'-m','immediate','-w','stop'],{stdio:'pipe'});fs.rmSync(dir,{recursive:true,force:true})})
  execFileSync('initdb',['-D',`${dir}/data`,'-U','postgres','-A','trust','--no-locale'],{stdio:'pipe'})
  execFileSync('pg_ctl',['-D',`${dir}/data`,'-l',`${dir}/server.log`,'-o',`-F -k ${dir} -h '' -p 55495`,'-w','start'],{stdio:'pipe'});started=true
  const sync=q=>execFileSync('psql',args,{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
  const sql=q=>new Promise((resolve,reject)=>{const p=spawn('psql',args,{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code?reject(Object.assign(new Error(err),{code:err.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]})):resolve(out.trim()));p.stdin.end(q)})
  sync(`create role authenticated;create table invoice_installments(id uuid primary key default gen_random_uuid(),organization_id uuid not null,contract_id uuid not null,client_id uuid,installment_type text not null check(installment_type in('monthly','setup')),reference_month date not null,installment_number integer not null check(installment_number>0),amount numeric not null check(amount>=0),received_amount numeric default 0,status text default 'pending',due_date date,provider text,revenue_type text,
    unique(organization_id,contract_id,reference_month,installment_number));
    create unique index invoice_installments_contract_type_competence_unique on invoice_installments(organization_id,contract_id,installment_type,reference_month);
    alter table invoice_installments enable row level security;alter table invoice_installments force row level security;
    create policy tenant on invoice_installments for all to authenticated using(organization_id=nullif(current_setting('test.org',true),'')::uuid) with check(organization_id=nullif(current_setting('test.org',true),'')::uuid);
    grant select,insert on invoice_installments to authenticated;`)
  const source=fs.readFileSync('src/services/data/financeRepository.js','utf8').replace(/^import .*\n/gm,'').replace(/\bexport /g,'').replaceAll('import.meta.env.DEV','false')
  let arrivals=0,release
  const gate=new Promise(resolve=>release=resolve)
  function repository({race=false}={}){
    const db=()=>({from(){let filters=[],payload,op='read',result;const query={select(){return query},eq(k,v){assert.match(k,/^[a-z_]+$/);filters.push(`${k}=${lit(v)}`);return query},insert(v){op='insert';payload=v;return query},single(){return run(true)},then(resolve,reject){return run(false).then(resolve,reject)}};function run(single){return result??=(async()=>{
      if(op==='insert'&&race){arrivals++;if(arrivals===2)release();await gate}
      const statement=op==='read'?`select * from invoice_installments where ${filters.join(' and ')}`:`insert into invoice_installments (${Object.keys(payload).join(',')}) values (${Object.values(payload).map(lit).join(',')}) returning *`
      try{const rows=JSON.parse(await sql(`set role authenticated;set test.org='${org}';with rows as (${statement}) select coalesce(json_agg(row_to_json(r)),'[]') from rows r;`));return{data:single?rows[0]:rows,error:null}}catch(error){return{data:null,error}}
    })()}return query}})
    return vm.runInNewContext(source+'\ncreateInstallment',{db,isSupabaseProvider:()=>true,organizationId:async()=>org,unwrap:result=>{if(result.error)throw result.error;return result.data},invalidateCrmData(){},Map,JSON,Number,Error})
  }
  const results=await Promise.allSettled([repository({race:true})(values),repository({race:true})(values)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  const conflict=results.find(r=>r.status==='rejected').reason
  assert.equal(conflict.code,'INSTALLMENT_ALREADY_EXISTS');assert.ok(conflict.existingInstallment.id)
  assert.equal(sync('select count(*) from invoice_installments'),'1')
  const row=JSON.parse(sync('select row_to_json(r) from invoice_installments r'))
  assert.deepEqual([row.organization_id,row.contract_id,row.reference_month,row.amount,row.due_date,row.installment_number],[org,contract,'2026-10-01',300,'2026-10-30',2])
  await assert.rejects(repository()({...values,installment_number:3,amount:900}),e=>e.code==='INSTALLMENT_ALREADY_EXISTS')
  await assert.rejects(repository()({...values,installment_type:'setup'}),e=>e.code==='INSTALLMENT_ALREADY_EXISTS')
  sync('update invoice_installments set received_amount=150')
  await assert.rejects(repository()(values),e=>e.code==='INSTALLMENT_ALREADY_EXISTS'&&e.existingInstallment.received_amount===150)
  assert.equal(sync('select amount||\'|\'||received_amount from invoice_installments'),'300|150')
  assert.equal(sync(`set role authenticated;set test.org='${foreign}';select count(*) from invoice_installments`),'0')
  const setup=await repository()({...values,installment_type:'setup',installment_number:3})
  assert.equal(setup.installment_type,'setup');assert.equal(sync('select count(*) from invoice_installments'),'2')
  t.diagnostic('Two independent repository contexts raced: one insert, one readable conflict; existing amount/payment preserved.')
})
