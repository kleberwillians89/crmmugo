-- Execute no SQL Editor antes e depois da migration 202607140004.
select n.nspname as schema_name,p.proname as function_name,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where pg_get_functiondef(p.oid) ilike '%setup_received_amount%';

select event_object_schema,event_object_table,trigger_name,action_timing,event_manipulation,action_statement
from information_schema.triggers
where trigger_schema='public'
  and event_object_table in('contracts','invoice_installments','payments','finance','proposals','contract_services')
order by event_object_table,trigger_name;

select table_schema,table_name,column_name,data_type
from information_schema.columns
where table_schema='public' and column_name in('setup_received_amount','monthly_received_amount','received_amount','amount_received','paid_amount','setup_value','monthly_value')
order by table_name,column_name;

-- Teste isolado: substitua apenas pelo UUID de um contrato de teste sem recebimentos.
begin;
select public.get_contract_billing_preview('00000000-0000-0000-0000-000000000000'::uuid,false);
select public.activate_contract_and_generate_installments('00000000-0000-0000-0000-000000000000'::uuid,false);
select installment_type,reference_month,due_date,amount,status
from public.invoice_installments
where contract_id='00000000-0000-0000-0000-000000000000'::uuid
order by installment_type,reference_month;
rollback;
