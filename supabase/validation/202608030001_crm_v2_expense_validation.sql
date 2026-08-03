-- CRM V2 pós-migration: validação estritamente somente leitura.
-- Resultado esperado: todos os checks críticos com status = 'ok'.
with expected_tables(name) as (values
 ('expense_categories'),('cost_centers'),('financial_accounts'),('expenses'),('expense_installments')
)
select 'table:'||name check_name,
 case when to_regclass('public.'||name) is not null then 'ok' else 'error' end status,
 coalesce(to_regclass('public.'||name)::text,'ausente') detail
from expected_tables
union all
select 'columns:required',case when count(*)=38 then 'ok' else 'error' end,count(*)||'/38 colunas obrigatórias encontradas'
from information_schema.columns
where table_schema='public' and (table_name,column_name) in (
 ('expense_categories','id'),('expense_categories','organization_id'),('expense_categories','name'),('expense_categories','active'),('expense_categories','updated_at'),
 ('cost_centers','id'),('cost_centers','organization_id'),('cost_centers','name'),('cost_centers','active'),('cost_centers','updated_at'),
 ('financial_accounts','id'),('financial_accounts','organization_id'),('financial_accounts','name'),('financial_accounts','account_type'),('financial_accounts','opening_balance'),('financial_accounts','updated_at'),
 ('expenses','id'),('expenses','organization_id'),('expenses','category_id'),('expenses','cost_center_id'),('expenses','financial_account_id'),('expenses','scope'),('expenses','total_amount'),('expenses','business_percentage'),('expenses','installment_count'),('expenses','due_day'),('expenses','status'),('expenses','validated'),('expenses','deleted_at'),('expenses','updated_at'),
 ('expense_installments','id'),('expense_installments','organization_id'),('expense_installments','expense_id'),('expense_installments','due_date'),('expense_installments','amount'),('expense_installments','business_amount'),('expense_installments','idempotency_key'),('expense_installments','updated_at')
)
union all
select 'foreign_keys:tenant_safe',case when count(*)=4 then 'ok' else 'error' end,count(*)||'/4 FKs compostas organization_id'
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in('expenses','expense_installments') and c.contype='f'
 and array_length(c.conkey,1)=2 and c.confdeltype in('a','r')
union all
select 'constraints:checks',case when count(*)>=12 then 'ok' else 'error' end,count(*)||' CHECK constraints'
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments') and c.contype='c'
union all
select 'indexes:required',case when count(*)>=8 then 'ok' else 'error' end,count(*)||' índices V2 encontrados'
from pg_indexes where schemaname='public' and indexname in(
 'expense_categories_org_active_idx','cost_centers_org_active_idx','financial_accounts_org_active_idx',
 'expenses_org_status_due_idx','expenses_org_scope_idx','expenses_org_deleted_idx',
 'expense_installments_org_due_idx','expense_installments_expense_idx','expense_installments_idempotency_idx')
union all
select 'rls:enabled',case when bool_and(relrowsecurity) and count(*)=5 then 'ok' else 'error' end,count(*)||'/5 tabelas com RLS'
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments')
union all
select 'policies:read_insert_update',case when count(*)=15 then 'ok' else 'error' end,count(*)||'/15 policies'
from pg_policies where schemaname='public' and tablename in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments')
 and cmd in('SELECT','INSERT','UPDATE')
union all
select 'policies:no_physical_delete',case when count(*)=0 then 'ok' else 'error' end,count(*)||' policies DELETE'
from pg_policies where schemaname='public' and tablename in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments') and cmd in('DELETE','ALL')
union all
select 'policies:tenant_filter',case when count(*)=15 then 'ok' else 'error' end,count(*)||'/15 policies usam current_organization_id'
from pg_policies where schemaname='public' and tablename in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments')
 and (coalesce(qual,'')||coalesce(with_check,'')) like '%current_organization_id%'
union all
select 'functions:present',case when to_regprocedure('public.generate_expense_installments(uuid)') is not null and to_regprocedure('public.expense_business_amount(text,numeric,numeric)') is not null then 'ok' else 'error' end,'geração e rateio'
union all
select 'function:definer_search_path',case when p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%' then 'ok' else 'error' end,coalesce(array_to_string(p.proconfig,','),'sem config')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='generate_expense_installments'
union all
select 'function:not_public',case when not exists(
 select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='public.generate_expense_installments(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'
) then 'ok' else 'error' end,'PUBLIC sem EXECUTE'
union all
select 'function:authenticated',case when has_function_privilege('authenticated','public.generate_expense_installments(uuid)','execute') then 'ok' else 'error' end,'authenticated com EXECUTE'
union all
select 'triggers:updated_at',case when count(*)=5 then 'ok' else 'error' end,count(*)||'/5 triggers'
from information_schema.triggers where trigger_schema='public' and event_object_table in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments') and trigger_name='set_updated_at'
union all
select 'triggers:audit',case when count(distinct event_object_table)=5 then 'ok' else 'error' end,count(distinct event_object_table)||'/5 tabelas com trigger'
from information_schema.triggers where trigger_schema='public' and event_object_table in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments') and trigger_name='audit_changes'
union all
select 'triggers:business_amount',case when count(*)>=1 then 'ok' else 'error' end,count(*)||' eventos de trigger'
from information_schema.triggers where trigger_schema='public' and event_object_table='expense_installments' and trigger_name='enforce_business_amount'
order by check_name;

-- Integridade dos dados existentes. Todos devem retornar zero, exceto soft_deleted (informativo).
select 'missing_organization' check_name,count(*) issue_count from (
 select id from public.expense_categories where organization_id is null union all
 select id from public.cost_centers where organization_id is null union all
 select id from public.financial_accounts where organization_id is null union all
 select id from public.expenses where organization_id is null union all
 select id from public.expense_installments where organization_id is null
) x
union all select 'duplicate_installments',count(*) from (
 select organization_id,expense_id,reference_month,installment_number from public.expense_installments group by 1,2,3,4 having count(*)>1
) x
union all select 'duplicate_idempotency_keys',count(*) from (
 select organization_id,idempotency_key from public.expense_installments where idempotency_key is not null group by 1,2 having count(*)>1
) x
union all select 'installments_without_expense',count(*) from public.expense_installments i left join public.expenses e on e.id=i.expense_id and e.organization_id=i.organization_id where e.id is null
union all select 'invalid_scope_or_percentage',count(*) from public.expenses where
 scope not in('business','personal','shared','pending_review') or business_percentage not between 0 and 100
 or (scope='business' and business_percentage<>100) or (scope in('personal','pending_review') and business_percentage<>0) or (scope='shared' and business_percentage<=0)
union all select 'pending_review_marked_validated',count(*) from public.expenses where scope='pending_review' and validated
union all select 'business_amount_mismatch',count(*) from public.expense_installments i join public.expenses e on e.id=i.expense_id and e.organization_id=i.organization_id
 where i.business_amount<>public.expense_business_amount(e.scope,i.amount,e.business_percentage)
union all select 'negative_or_overpaid',count(*) from public.expense_installments where amount<0 or business_amount<0 or business_amount>amount or paid_amount<0 or paid_amount>amount
union all select 'soft_deleted_info',count(*) from public.expenses where deleted_at is not null
order by check_name;

-- Policies detalhadas para revisão humana dos papéis e isolamento.
select tablename,policyname,cmd,roles,qual,with_check
from pg_policies
where schemaname='public' and tablename in('expense_categories','cost_centers','financial_accounts','expenses','expense_installments')
order by tablename,cmd,policyname;
