do $test$
declare
  v_org constant uuid := '1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f';
  v_request constant text := 'bulk-sanitation-2026-08-v1';
  v_curavino_contract uuid := md5(v_request||':curavino:contract')::uuid;
  v_cafifa_contract uuid := md5(v_request||':cafifa:contract')::uuid;
begin
  if not exists(select 1 from public.bulk_data_sanitation_batches where organization_id=v_org and request_key=v_request and status='completed') then
    raise exception 'Batch não concluído';
  end if;
  if (select count(*) from public.bulk_data_sanitation_batches where organization_id=v_org and request_key=v_request)<>1 then
    raise exception 'Idempotência do batch falhou';
  end if;
  if exists(select 1 from public.clients where id=any(array[
    'cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611'::uuid,'c68ebe35-e064-4fa1-9160-98725063c920'::uuid,
    '078a840a-5363-4a33-b6fe-646c1a5b851c'::uuid]) and (status<>'archived' or deleted_at is null)) then
    raise exception 'Consolidação/arquivamento falhou';
  end if;
  if not exists(select 1 from public.invoice_installments where id='91000000-0000-0000-0000-000000000001'
    and amount=4000 and received_amount=4000 and status='paid' and payment_method='pix') then
    raise exception 'Parcela paga foi alterada';
  end if;
  if not exists(select 1 from public.invoice_installments where id='91000000-0000-0000-0000-000000000005'
    and amount=4000 and received_amount=4000 and installment_type='setup' and paid_at is not null) then
    raise exception 'Setup foi alterado';
  end if;
  if not exists(select 1 from public.invoice_installments where id='91000000-0000-0000-0000-000000000002'
    and client_id='5e1646d2-6163-4164-9772-2acf31731eac' and amount=4000 and extract(day from due_date)=20) then
    raise exception 'Amalie futura inválida';
  end if;
  if not exists(select 1 from public.invoice_installments where id='91000000-0000-0000-0000-000000000004'
    and client_id='e7919cd3-c989-49c9-994f-eb31aa9ce294' and amount=3200 and extract(day from due_date)=20) then
    raise exception 'Roove futura inválida';
  end if;
  if not exists(select 1 from public.invoice_installments where id='91000000-0000-0000-0000-000000000007'
    and amount=5000 and extract(day from due_date)=10) then
    raise exception 'Gabi futura inválida';
  end if;
  if (select count(*) from public.invoice_installments where contract_id=v_curavino_contract)<>12
    or (select count(*) from public.invoice_installments where contract_id=v_cafifa_contract)<>12 then
    raise exception 'Horizonte de parcelas inválido';
  end if;
  if exists(select 1 from public.invoice_installments where contract_id=any(array[v_curavino_contract,v_cafifa_contract])
    and due_date<case when contract_id=v_curavino_contract then date '2026-08-07' else date '2026-08-15' end) then
    raise exception 'Cobrança retroativa criada';
  end if;
  if exists(select 1 from public.invoice_installments where organization_id=v_org group by idempotency_key
    having idempotency_key is not null and count(*)>1) then raise exception 'Idempotência de parcelas falhou'; end if;
  if exists(select 1 from public.bulk_data_sanitation_items where batch_id=(select id from public.bulk_data_sanitation_batches
    where organization_id=v_org and request_key=v_request) and operation in('move','archive','update','preserve') and after_data is null) then
    raise exception 'Snapshot after ausente';
  end if;
  if not exists(select 1 from public.contracts where id='40000000-0000-0000-0000-000000000002'
    and organization_id='20000000-0000-0000-0000-000000000002' and monthly_value=1000 and billing_day=10) then
    raise exception 'Isolamento por organização falhou';
  end if;

  begin
    update public.contracts set monthly_value=9999 where id='31978937-d01e-4aa6-925a-04e1901aafe7';
    raise exception 'rollback-probe';
  exception when others then
    if sqlerrm<>'rollback-probe' then raise; end if;
  end;
  if exists(select 1 from public.contracts where id='31978937-d01e-4aa6-925a-04e1901aafe7' and monthly_value=9999) then
    raise exception 'Rollback transacional falhou';
  end if;
end
$test$;

select 'bulk_real_data_sanitation_ok' as result;
