import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { collectionConfirmation, collectionPhoneOptions, collectionPhoneQuestion, formatCollectionPhone, parseCollectionAmount } from '../supabase/functions/_shared/collectionCore.js'
import { billingPhoneOptions } from '../src/lib/billingPhones.js'
import { buildWhatsAppLink, isValidBrazilianPhone, normalizeBrazilianPhone } from '../src/lib/whatsapp.js'
import { parseMoneyInput } from '../src/lib/moneyInput.js'

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const worker = read('supabase/functions/task-command-worker/index.ts')
const mugozap = read('supabase/functions/mugozap-api/index.ts')
const schemaMigration = read('supabase/migrations/202610300001_contatos_recorrencia.sql')
const migration = read('supabase/migrations/202610300002_limpeza_carteira.sql')

test('telefone internacional com "+" é aceito e não ganha 55; nacional sem DDI ganha 55', () => {
  assert.equal(normalizeBrazilianPhone('+34 632 88 10 89'), '34632881089')
  assert.equal(isValidBrazilianPhone('+34 632 88 10 89'), true)
  assert.equal(buildWhatsAppLink('+34 632 88 10 89', 'oi'), 'https://wa.me/34632881089?text=oi')
  assert.equal(normalizeBrazilianPhone('(11) 99200-0357'), '5511992000357')
  assert.equal(isValidBrazilianPhone('11 99200-0357'), true)
  assert.equal(isValidBrazilianPhone('abc'), false)
})

test('valor digitado no modal: formatos brasileiros', () => {
  assert.equal(parseMoneyInput('2.500,50'), 2500.5)
  assert.equal(parseMoneyInput('R$ 2500'), 2500)
  assert.equal(parseMoneyInput('2.500'), 2500)
  assert.equal(parseMoneyInput('0'), null)
})

test('opções de número na tela: principal primeiro, sem repetir, com reserva nos campos antigos', () => {
  const options = billingPhoneOptions(
    { company_name: 'Origami', contact_name: 'Rodrigo Onias', phone: '11 99200-0357', billing_contact_phone: '+55 11 99200-0357' },
    [{ name: 'Sato', phone: '+5511951288644', is_primary: false }, { name: 'Rodrigo Onias', phone: '+5511992000357', is_primary: true }],
  )
  assert.deepEqual(options.map((item) => item.name), ['Rodrigo Onias', 'Sato'])
  assert.equal(options[0].isPrimary, true)
  assert.deepEqual(billingPhoneOptions({ company_name: 'Sem número' }, []), [])
})

test('WhatsApp interno: só um valor vira edição; "sim", lista e frases não', () => {
  assert.equal(parseCollectionAmount('2300'), 2300)
  assert.equal(parseCollectionAmount('R$ 2.300,00'), 2300)
  assert.equal(parseCollectionAmount('valor 2500'), 2500)
  assert.equal(parseCollectionAmount('muda pra 1300 reais'), 1300)
  for (const text of ['sim', 'não', '1', '2', 'cobra a origami', 'manda pro Sato']) assert.equal(parseCollectionAmount(text), null, text)
})

test('WhatsApp interno: números do cliente para escolher e textos de pergunta/confirmação', () => {
  const options = collectionPhoneOptions(
    { company_name: 'Latinas', phone: '+34632881089' },
    [{ name: 'Carele', phone: '+5511931462536' }, { name: 'Elis', phone: '+34632881089', is_primary: true }, { name: 'Inativo', phone: '+5511900000000', active: false }],
  )
  assert.deepEqual(options.map((item) => [item.name, item.phone, item.is_primary]), [['Elis', '+34632881089', true], ['Carele', '+5511931462536', false]])
  assert.match(collectionPhoneQuestion('Latinas', options), /1\. Elis — \+34632881089 \(principal\)\n2\. Carele — \+55 11 93146-2536/)
  assert.equal(formatCollectionPhone('+5511992000357'), '+55 11 99200-0357')
  assert.match(collectionConfirmation({ clientName: 'Origami', amountLabel: 'R$ 2.500,00', contactName: 'Sato', phone: '+5511951288644' }), /para Sato \(\+55 11 95128-8644\)\?[\s\S]*outro valor/)
})

test('worker: escolhe número antes do "sim", envia para o número escolhido e edita valor sem perder a sessão', () => {
  assert.match(worker, /pending_action:'select_collection_phone'/)
  assert.match(worker, /sendCollectionViaMugozap\(event,installment\.data,event\.session\.context\?\.collection_phone\|\|null\)/)
  assert.match(worker, /event\.session\.pending_action!=='send_collection_template'/)
  assert.match(worker, /command\.intent!=='COLLECTION_AMOUNT_EDIT' && command\.intent!==event\.session\.active_intent\)await clearAssistantSession/)
  assert.match(worker, /\|\| command\.intent==='COLLECTION_AMOUNT_EDIT'/)
  assert.match(worker, /FINANCIAL_ADMIN_INTENTS = new Set\(\[[^\]]*'COLLECTION_AMOUNT_EDIT'/)
})

test('mugozap aceita qualquer contato ativo do cliente como destino e cumprimenta o contato escolhido', () => {
  assert.match(mugozap, /from\('client_contacts'\)\.select\('name,phone'\)/)
  assert.match(mugozap, /chosenContact\?\.name \|\| clientRow\.contact_name/)
})

test('migration: estrutura separada da limpeza; limpeza transacional, aborta em cliente ambíguo e não apaga dados', () => {
  assert.match(schemaMigration, /create table if not exists public\.client_contacts/)
  assert.doesNotMatch(schemaMigration, /Limpeza abortada/)
  assert.match(migration, /^begin;/m)
  assert.match(migration, /^commit;/m)
  assert.match(migration, /raise exception 'Limpeza abortada/)
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i)
  for (const name of ['Origami', 'Ruah', 'Roove', 'Rodrigo Mancusi', 'CAFIFA / Santo Circuito', 'Curavino', 'Latinas']) assert.ok(migration.includes(`'${name}'`), name)
})

// Banco real (PostgreSQL local, sem Supabase): aplica todas as migrations sobre stubs de auth/storage.
test('PostgreSQL: limpeza idempotente, contatos, recorrência e valor editado', async (t) => {
  const bin = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/opt/homebrew/bin', '/usr/local/bin', ''].find((dir) => { try { execFileSync(path.join(dir, 'initdb'), ['--version'], { stdio: 'pipe' }); return true } catch { return false } })
  if (bin === undefined || (process.getuid && process.getuid() === 0)) { t.skip('PostgreSQL local indisponível (ou rodando como root)'); return }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugo-cobranca-pg-')), port = '55531'
  const psql = (sql, extra = []) => execFileSync('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', ...extra], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  execFileSync(path.join(bin, 'initdb'), ['-D', `${dir}/data`, '-U', 'postgres', '-A', 'trust', '--no-locale'], { stdio: 'pipe' })
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', `${dir}/data`, '-l', `${dir}/log`, '-o', `-F -k ${dir} -h '' -p ${port}`, '-w', 'start'], { stdio: 'pipe' })
  try {
    psql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select coalesce(current_setting('request.jwt.claim.role',true),'authenticated')$$;
      create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
      create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
      create schema extensions; create extension pgcrypto with schema extensions;`)
    const files = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((file) => file.endsWith('.sql')).sort()
    const target = '202610300002_limpeza_carteira.sql'
    for (const file of files.filter((file) => file !== target)) { try { psql(read(`supabase/migrations/${file}`)) } catch { /* migrations de dados reais não se aplicam ao banco vazio */ } }
    psql(`grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated;
      insert into clients(id,organization_id,company_name,trade_name,status,contact_name,phone,billing_contact_name,billing_contact_phone) select v.id::uuid,o.id,v.c,v.t,v.s,v.n,v.p,v.bn,v.bp from organizations o, (values
        ('a0000000-0000-4000-8000-000000000001','ORIGAMI INVESTIMENTOS','Origami','active','Velho','11 90000-0001','Fin','11 90000-0002'),
        ('a0000000-0000-4000-8000-000000000004','Latina Studio','Latina','active',null,null,null,null),
        ('a0000000-0000-4000-8000-000000000005','Amalie','Amalie','active','X','11 98888-7777',null,null),
        ('a0000000-0000-4000-8000-000000000006','Prospect','Prospect','lead',null,null,null,null)) v(id,c,t,s,n,p,bn,bp) where o.slug='mugo';
      insert into contracts(id,organization_id,client_id,status,start_date,monthly_value,billing_day) select v.id::uuid,o.id,v.c::uuid,'active','2026-08-01',v.m,v.d from organizations o,(values
        ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',1500,5),
        ('b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000004',null,10),
        ('b0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000005',4000,20)) v(id,c,m,d) where o.slug='mugo';
      insert into invoice_installments(organization_id,client_id,contract_id,reference_month,installment_number,due_date,amount,status,installment_type,currency,exchange_rate,original_amount) select o.id,v.c::uuid,v.k::uuid,v.r::date,1,v.d::date,v.a,v.s,'monthly',v.cur,v.x,v.o from organizations o,(values
        ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','2026-09-01','2026-09-05',1500,'overdue','BRL',null::numeric,null::numeric),
        ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','2026-11-01','2026-11-05',1500,'pending','BRL',null,null),
        ('a0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000004','2026-11-01','2026-11-10',0,'pending','EUR',6.2,100),
        ('a0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000005','2099-11-01','2099-11-20',4000,'pending','BRL',null,null)) v(c,k,r,d,a,s,cur,x,o) where o.slug='mugo';`)
    psql(read(`supabase/migrations/${target}`))
    psql(read(`supabase/migrations/${target}`))
    assert.equal(psql(`select string_agg(trade_name||':'||status, ',' order by trade_name) from clients where trade_name in ('Amalie','Prospect','Origami','Latina')`), 'Amalie:inactive,Latina:active,Origami:active,Prospect:lead')
    assert.equal(psql(`select string_agg(amount::text, ',' order by reference_month) from invoice_installments where client_id='a0000000-0000-4000-8000-000000000001'`), '1500.00,2500.00')
    assert.equal(psql(`select amount||currency||' '||due_date from invoice_installments where client_id='a0000000-0000-4000-8000-000000000004'`), '600.00BRL 2026-11-20')
    assert.equal(psql(`select due_date from invoice_installments where client_id='a0000000-0000-4000-8000-000000000001' and reference_month='2026-11-01'`), '2026-11-05')
    assert.equal(psql(`select string_agg(cl.trade_name||':'||k.monthly_value||':'||k.billing_day, ',' order by cl.trade_name) from contracts k join clients cl on cl.id=k.client_id where k.status='active' and cl.trade_name in ('Roove','Santo Circuito','CAFIFA / Santo Circuito')`), 'CAFIFA / Santo Circuito:2500.00:10,Roove:3200.00:30')
    assert.equal(psql(`select status from invoice_installments where client_id='a0000000-0000-4000-8000-000000000005'`), 'cancelled')
    assert.equal(psql(`select string_agg(name||(case when is_primary then '*' else '' end), ',' order by is_primary desc, name) from client_contacts where client_id='a0000000-0000-4000-8000-000000000001' and active`), 'Rodrigo Onias*,Sato')
    assert.equal(psql(`select contact_name||' '||billing_contact_phone from clients where id='a0000000-0000-4000-8000-000000000001'`), 'Rodrigo Onias +5511992000357')
    assert.equal(psql(`select count(*) from clients where trade_name in ('Ruah','Roove','Curavino','Rodrigo Mancusi')`), '4')
    const as = `insert into auth.users(id) values('c0000000-0000-4000-8000-000000000001'); insert into profiles(id,organization_id,role,active) select 'c0000000-0000-4000-8000-000000000001',id,'admin',true from organizations where slug='mugo';`
    psql(as)
    const user = `set role authenticated; set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';`
    psql(`update contracts set is_recurring=true where client_id=(select id from clients where trade_name='Ruah');`)
    assert.equal(psql(`${user} select public.ensure_recurring_installments(2);`).split('\n').pop(), '2')
    assert.equal(psql(`${user} select public.ensure_recurring_installments(2);`).split('\n').pop(), '0')
    assert.equal(psql(`${user} select amount from public.update_open_installment_amount((select id from invoice_installments where client_id='a0000000-0000-4000-8000-000000000001' and reference_month='2026-11-01'), 2300, 'teste');`).split('\n').pop(), '2300.00')
    assert.throws(() => psql(`${user} select public.update_open_installment_amount((select id from invoice_installments where client_id='a0000000-0000-4000-8000-000000000005'), 100);`), /aberto/)
    assert.equal(psql(`${user} select name from public.set_primary_client_contact((select id from client_contacts where name='Sato'));`).split('\n').pop(), 'Sato')
    assert.equal(psql(`select billing_contact_phone from clients where id='a0000000-0000-4000-8000-000000000001'`), '+5511951288644')
  } finally {
    try { execFileSync(path.join(bin, 'pg_ctl'), ['-D', `${dir}/data`, '-m', 'immediate', 'stop'], { stdio: 'pipe' }) } catch { /* já parado */ }
  }
})
