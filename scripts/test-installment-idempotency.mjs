import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const migration=read('supabase/migrations/202607140005_sprint13_7_installment_idempotency.sql')
const modal=read('src/components/ContractBillingPreviewModal.jsx')

assert.match(migration,/create or replace function public\.get_contract_billing_preview/)
assert.match(migration,/create or replace function public\.activate_contract_and_generate_installments/)
assert.match(migration,/existingCompetences/)
assert.match(migration,/newCompetences/)
assert.match(migration,/not exists\(select 1 from public\.invoice_installments/)
assert.match(migration,/on conflict do nothing/g)
assert.doesNotMatch(migration,/drop constraint|drop index|alter table/)
assert.match(migration,/Nenhuma competência pendente\./)
assert.match(migration,/setup_exists:=exists/)
assert.match(migration,/setup_reference:=\(date_trunc/)
assert.match(modal,/Competências existentes/)
assert.match(modal,/Competências novas/)
assert.match(modal,/setupWillBeCreated/)
console.log('Installment idempotency regression passed: missing-only preview, targetless conflict handling, setup protection and preserved constraints.')
