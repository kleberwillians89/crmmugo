import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const oldMigration=read('supabase/migrations/202607130003_sprint10_1_receivables.sql')
const fix=read('supabase/migrations/202607140004_sprint13_6_fix_financial_trigger.sql')
const integration=read('supabase/migrations/202607140003_sprint13_5_commercial_integration.sql')

assert.match(oldMigration,/tg_table_name='contracts' and coalesce\(new\.setup_received_amount,0\)/)
assert.match(oldMigration,/require_installment_payment_audit before insert on public\.invoice_installments.*require_audited_receivable_registration/s)
assert.match(fix,/function public\.require_contract_setup_audit\(\)/)
assert.match(fix,/function public\.require_installment_payment_audit\(\)/)
assert.match(fix,/function public\.audit_contract_setup_receivable\(\)/)
assert.match(fix,/function public\.audit_installment_receivable\(\)/)
assert.doesNotMatch(fix,/tg_table_name/)
const installmentGuard=fix.match(/function public\.require_installment_payment_audit\(\)[\s\S]*?end\$\$/)?.[0]||''
assert.doesNotMatch(installmentGuard,/setup_received_amount/)
const installmentAudit=fix.match(/function public\.audit_installment_receivable\(\)[\s\S]*?end\$\$/)?.[0]||''
assert.doesNotMatch(installmentAudit,/setup_received_amount/)
assert.match(integration,/insert into public\.invoice_installments/)
assert.match(integration,/on conflict\(organization_id,contract_id,installment_type,reference_month\) do nothing/)
assert.match(integration,/update public\.contracts set status='active'/)
console.log('Financial trigger regression passed: table-specific NEW fields, atomic billing and idempotency preserved.')
