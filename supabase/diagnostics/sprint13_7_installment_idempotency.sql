-- Substitua pelo UUID de um contrato de teste. Todo o teste é revertido no final.
begin;

select public.get_contract_billing_preview('00000000-0000-0000-0000-000000000000'::uuid,false) as preview_before;
select public.activate_contract_and_generate_installments('00000000-0000-0000-0000-000000000000'::uuid,false) as first_run;
select public.activate_contract_and_generate_installments('00000000-0000-0000-0000-000000000000'::uuid,false) as double_click_run;
select public.get_contract_billing_preview('00000000-0000-0000-0000-000000000000'::uuid,false) as preview_after;

select installment_type,date_trunc('month',reference_month)::date as competence,count(*)
from public.invoice_installments
where contract_id='00000000-0000-0000-0000-000000000000'::uuid
group by installment_type,date_trunc('month',reference_month)::date
having count(*)>1;

select installment_type,reference_month,due_date,amount,status,idempotency_key
from public.invoice_installments
where contract_id='00000000-0000-0000-0000-000000000000'::uuid
order by installment_type,reference_month;

rollback;
