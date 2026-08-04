begin;

create table if not exists public.bulk_data_sanitation_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_key text not null,
  reason text not null,
  status text not null check (status in ('processing', 'completed')),
  parameters jsonb not null,
  report jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, request_key)
);

create table if not exists public.bulk_data_sanitation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  batch_id uuid not null references public.bulk_data_sanitation_batches(id) on delete restrict,
  table_name text not null,
  record_id uuid,
  operation text not null check (operation in ('move', 'archive', 'update', 'create', 'preserve')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bulk_data_sanitation_items_batch_idx
  on public.bulk_data_sanitation_items(batch_id, table_name, operation);

alter table public.bulk_data_sanitation_batches enable row level security;
alter table public.bulk_data_sanitation_items enable row level security;

do $bulk$
declare
  v_org constant uuid := '1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f';
  v_request constant text := 'bulk-sanitation-2026-08-v1';
  v_reason constant text := 'Saneamento integral aprovado dos dados reais do CRM em agosto de 2026';
  v_amalie_month constant date := date '2026-08-01';
  v_roove_month constant date := date '2026-08-01';
  v_gabi_month constant date := date '2026-08-01';
  v_curavino_start constant date := date '2026-08-07';
  v_cafifa_start constant date := date '2026-08-15';
  v_cafifa_service constant text := 'Gestão mensal de marketing, comunicação e projetos';
  v_horizon constant integer := 12;
  v_batch uuid;
  v_table text;
  v_count bigint;
  v_primary uuid;
  v_secondary uuid;
  v_contract uuid;
  v_new_contract uuid;
  v_new_service uuid;
  v_effective_month date;
  v_start_date date;
  v_monthly_value numeric;
  v_billing_day integer;
  v_service_name text;
  v_report jsonb;
  v_moved_contracts integer := 0;
  v_moved_installments integer := 0;
  v_changed_contracts integer := 0;
  v_changed_installments integer := 0;
  v_created_contracts integer := 0;
  v_created_installments integer := 0;
  v_paid_preserved integer := 0;
  v_archived integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_request, 0));

  if exists (
    select 1 from public.bulk_data_sanitation_batches
    where organization_id = v_org and request_key = v_request and status = 'completed'
  ) then
    raise notice 'Saneamento % já concluído; nenhuma operação foi repetida.', v_request;
    return;
  end if;

  if v_amalie_month <> date_trunc('month', v_amalie_month)::date
     or v_roove_month <> date_trunc('month', v_roove_month)::date
     or v_gabi_month <> date_trunc('month', v_gabi_month)::date
     or v_horizon < 1
     or nullif(trim(v_cafifa_service), '') is null then
    raise exception 'Parâmetros comerciais inválidos.';
  end if;

  if not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'Organização esperada % não encontrada.', v_org;
  end if;

  insert into public.bulk_data_sanitation_batches(
    organization_id, request_key, reason, status, parameters
  ) values (
    v_org, v_request, v_reason, 'processing',
    jsonb_build_object(
      'amalieEffectiveMonth', v_amalie_month,
      'rooveEffectiveMonth', v_roove_month,
      'gabiEffectiveMonth', v_gabi_month,
      'curavinoStartDate', v_curavino_start,
      'cafifaStartDate', v_cafifa_start,
      'cafifaServiceName', v_cafifa_service,
      'installmentHorizonMonths', v_horizon
    )
  ) returning id into v_batch;

  -- Fail fast when any fixed client or contract is absent or belongs to another organization.
  if (select count(*) from public.clients where organization_id = v_org and id = any(array[
    '61974c0b-e344-4d60-9b12-1a1680c9c270'::uuid,
    'cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611'::uuid,
    '5e1646d2-6163-4164-9772-2acf31731eac'::uuid,
    'c68ebe35-e064-4fa1-9160-98725063c920'::uuid,
    'e7919cd3-c989-49c9-994f-eb31aa9ce294'::uuid,
    '078a840a-5363-4a33-b6fe-646c1a5b851c'::uuid,
    'de129d57-976f-42b6-a0a2-bafe7d16df13'::uuid,
    '744dd494-5eed-4429-b432-9c8f407be37c'::uuid,
    '35b06647-a6e2-4c8d-803a-f394ea890d4f'::uuid,
    '6a25e024-0781-4cf1-a225-cd739bf34ef4'::uuid
  ])) <> 10 then
    raise exception 'Um ou mais clientes esperados não existem na organização alvo.';
  end if;

  if exists (
    select 1 from public.clients where id = any(array[
      '61974c0b-e344-4d60-9b12-1a1680c9c270'::uuid,
      'cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611'::uuid,
      '5e1646d2-6163-4164-9772-2acf31731eac'::uuid,
      'c68ebe35-e064-4fa1-9160-98725063c920'::uuid,
      'e7919cd3-c989-49c9-994f-eb31aa9ce294'::uuid,
      '078a840a-5363-4a33-b6fe-646c1a5b851c'::uuid,
      'de129d57-976f-42b6-a0a2-bafe7d16df13'::uuid,
      '744dd494-5eed-4429-b432-9c8f407be37c'::uuid,
      '35b06647-a6e2-4c8d-803a-f394ea890d4f'::uuid,
      '6a25e024-0781-4cf1-a225-cd739bf34ef4'::uuid
    ]) and organization_id <> v_org
  ) then
    raise exception 'Foi detectado cliente de outra organização.';
  end if;

  if (select count(*) from public.contracts where organization_id = v_org and id = any(array[
    '1d50e5d9-847e-4c96-9075-6a295b34b19f'::uuid,
    '31978937-d01e-4aa6-925a-04e1901aafe7'::uuid,
    '3b56bcde-99b5-4244-9a5d-e0535339a59f'::uuid,
    '71dd1456-0dd9-4b69-b77c-030b6269b24c'::uuid,
    '7585f922-a937-4d2e-8a85-9846f3a93334'::uuid
  ])) <> 5 then
    raise exception 'Um ou mais contratos esperados não existem na organização alvo.';
  end if;

  if not exists (select 1 from public.contracts where id = '1d50e5d9-847e-4c96-9075-6a295b34b19f' and organization_id = v_org and monthly_value = 1500 and billing_day = 7)
     or not exists (select 1 from public.contracts where id = '31978937-d01e-4aa6-925a-04e1901aafe7' and organization_id = v_org and monthly_value = 4000)
     or not exists (select 1 from public.contracts where id = '3b56bcde-99b5-4244-9a5d-e0535339a59f' and organization_id = v_org and monthly_value = 2300 and billing_day = 10)
     or not exists (select 1 from public.contracts where id = '71dd1456-0dd9-4b69-b77c-030b6269b24c' and organization_id = v_org and monthly_value = 3500)
     or not exists (select 1 from public.contracts where id = '7585f922-a937-4d2e-8a85-9846f3a93334' and organization_id = v_org and monthly_value = 1000 and billing_day = 15) then
    raise exception 'Valores históricos esperados não correspondem ao banco; saneamento abortado.';
  end if;

  -- Preserve immutable financial evidence before any mutation.
  insert into public.bulk_data_sanitation_items(
    organization_id, batch_id, table_name, record_id, operation, before_data
  )
  select v_org, v_batch, 'invoice_installments', i.id, 'preserve', to_jsonb(i)
  from public.invoice_installments i
  where i.organization_id = v_org
    and (i.status = 'paid' or i.paid_at is not null or coalesce(i.received_amount, 0) > 0)
    and i.contract_id = any(array[
      '1d50e5d9-847e-4c96-9075-6a295b34b19f'::uuid,
      '31978937-d01e-4aa6-925a-04e1901aafe7'::uuid,
      '3b56bcde-99b5-4244-9a5d-e0535339a59f'::uuid,
      '71dd1456-0dd9-4b69-b77c-030b6269b24c'::uuid,
      '7585f922-a937-4d2e-8a85-9846f3a93334'::uuid
    ]);
  get diagnostics v_paid_preserved = row_count;

  -- Consolidate Origami, Amalie and Roove. Every public organization-scoped client link is moved.
  for v_primary, v_secondary in
    select * from (values
      ('61974c0b-e344-4d60-9b12-1a1680c9c270'::uuid, 'cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611'::uuid),
      ('5e1646d2-6163-4164-9772-2acf31731eac'::uuid, 'c68ebe35-e064-4fa1-9160-98725063c920'::uuid),
      ('e7919cd3-c989-49c9-994f-eb31aa9ce294'::uuid, '078a840a-5363-4a33-b6fe-646c1a5b851c'::uuid)
    ) pairs(primary_id, secondary_id)
  loop
    insert into public.bulk_data_sanitation_items(
      organization_id, batch_id, table_name, record_id, operation, before_data
    ) select v_org, v_batch, 'clients', id, 'update', to_jsonb(c)
      from public.clients c where c.organization_id = v_org and c.id = v_primary;
    insert into public.bulk_data_sanitation_items(
      organization_id, batch_id, table_name, record_id, operation, before_data
    ) select v_org, v_batch, 'clients', id, 'archive', to_jsonb(c)
      from public.clients c where c.organization_id = v_org and c.id = v_secondary;

    for v_table in
      select c.table_name
      from information_schema.columns c
      join information_schema.columns idc
        on idc.table_schema = c.table_schema and idc.table_name = c.table_name and idc.column_name = 'id'
      join information_schema.columns oc
        on oc.table_schema = c.table_schema and oc.table_name = c.table_name and oc.column_name = 'organization_id'
      where c.table_schema = 'public' and c.column_name = 'client_id'
        and c.table_name not in ('clients', 'data_merge_batches', 'data_merge_items',
          'bulk_data_sanitation_batches', 'bulk_data_sanitation_items')
      order by c.table_name
    loop
      execute format(
        'insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data)
         select $1,$2,%L,id,''move'',to_jsonb(t) from public.%I t where organization_id=$1 and client_id=$3',
        v_table, v_table
      ) using v_org, v_batch, v_secondary;

      execute format(
        'update public.%I set client_id=$1 where organization_id=$2 and client_id=$3', v_table
      ) using v_primary, v_org, v_secondary;
      get diagnostics v_count = row_count;
      if v_table = 'contracts' then v_moved_contracts := v_moved_contracts + v_count; end if;
      if v_table = 'invoice_installments' then v_moved_installments := v_moved_installments + v_count; end if;
    end loop;

    update public.clients
    set phone = case
      when nullif(trim(phone), '') is not null then phone
      when v_primary = 'e7919cd3-c989-49c9-994f-eb31aa9ce294' then
        coalesce((select nullif(trim(phone), '') from public.clients where id = v_secondary), '5511993161161')
      else (select nullif(trim(phone), '') from public.clients where id = v_secondary)
    end,
    updated_at = now()
    where id = v_primary and organization_id = v_org;

    update public.clients
    set status = 'archived', deleted_at = coalesce(deleted_at, now()), updated_at = now()
    where id = v_secondary and organization_id = v_org;
    get diagnostics v_count = row_count;
    v_archived := v_archived + v_count;
  end loop;

  -- Preserve confirmed Amalie identity fields.
  insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data)
  select v_org,v_batch,'clients',id,'update',to_jsonb(c) from public.clients c
  where id='5e1646d2-6163-4164-9772-2acf31731eac' and organization_id=v_org;
  update public.clients set
    document_number='42.153.154/0001-63', contact_name='Carolina Forgioni',
    email='carolina.forgioni@amalie.com.br', status='active', updated_at=now()
  where id='5e1646d2-6163-4164-9772-2acf31731eac' and organization_id=v_org;

  -- Use Gabriela only as representative/contact when GIMPORTS fields are empty.
  insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data)
  select v_org,v_batch,'clients',id,'update',to_jsonb(c) from public.clients c
  where id='de129d57-976f-42b6-a0a2-bafe7d16df13' and organization_id=v_org;
  update public.clients target set
    contact_name=coalesce(nullif(trim(target.contact_name),''), nullif(trim(source.contact_name),''), source.company_name),
    email=coalesce(nullif(trim(target.email),''),nullif(trim(source.email),'')),
    phone=coalesce(nullif(trim(target.phone),''),nullif(trim(source.phone),'')), status='active',updated_at=now()
  from public.clients source
  where target.id='de129d57-976f-42b6-a0a2-bafe7d16df13' and target.organization_id=v_org
    and source.id='744dd494-5eed-4429-b432-9c8f407be37c' and source.organization_id=v_org;

  -- Prospective contract changes; paid/setup/prior installments cannot match this predicate.
  for v_contract, v_effective_month, v_monthly_value, v_billing_day in
    select * from (values
      ('31978937-d01e-4aa6-925a-04e1901aafe7'::uuid, v_amalie_month, 4000::numeric, 20),
      ('3b56bcde-99b5-4244-9a5d-e0535339a59f'::uuid, v_roove_month, 3200::numeric, 20),
      ('71dd1456-0dd9-4b69-b77c-030b6269b24c'::uuid, v_gabi_month, 5000::numeric, 10)
    ) changes(contract_id, effective_month, monthly_value, billing_day)
  loop
    insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data)
    select v_org,v_batch,'contracts',id,'update',to_jsonb(c) from public.contracts c
    where id=v_contract and organization_id=v_org;

    insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data)
    select v_org,v_batch,'invoice_installments',id,'update',to_jsonb(i)
    from public.invoice_installments i
    where i.organization_id=v_org and i.contract_id=v_contract
      and date_trunc('month',i.reference_month)::date >= v_effective_month
      and i.status in ('draft','pending','overdue') and i.paid_at is null and coalesce(i.received_amount,0)=0
      and coalesce(i.installment_type,'monthly') <> 'setup'
      and coalesce(i.idempotency_key,'') not like '%:setup';

    update public.contracts set monthly_value=v_monthly_value,billing_day=v_billing_day,updated_at=now()
    where id=v_contract and organization_id=v_org;
    get diagnostics v_count = row_count;
    v_changed_contracts := v_changed_contracts + v_count;

    update public.invoice_installments i set
      amount=v_monthly_value,
      due_date=make_date(extract(year from i.reference_month)::int,extract(month from i.reference_month)::int,
        least(v_billing_day,extract(day from(date_trunc('month',i.reference_month)+interval '1 month - 1 day'))::int)),
      updated_at=now()
    where i.organization_id=v_org and i.contract_id=v_contract
      and date_trunc('month',i.reference_month)::date >= v_effective_month
      and i.status in ('draft','pending','overdue') and i.paid_at is null and coalesce(i.received_amount,0)=0
      and coalesce(i.installment_type,'monthly') <> 'setup'
      and coalesce(i.idempotency_key,'') not like '%:setup';
    get diagnostics v_count = row_count;
    v_changed_installments := v_changed_installments + v_count;
  end loop;

  -- End the historical Curavino contract without touching its installments.
  insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data)
  select v_org,v_batch,'contracts',id,'update',to_jsonb(c) from public.contracts c
  where id='7585f922-a937-4d2e-8a85-9846f3a93334' and organization_id=v_org;
  update public.contracts set status='terminated',end_date=date '2026-07-26',termination_date=date '2026-07-26',
    termination_reason=v_reason,updated_at=now()
  where id='7585f922-a937-4d2e-8a85-9846f3a93334' and organization_id=v_org;
  v_changed_contracts := v_changed_contracts + 1;

  -- Deterministic IDs make both prospective creations idempotent.
  for v_primary, v_new_contract, v_new_service, v_start_date, v_monthly_value, v_billing_day, v_service_name in
    select * from (values
      ('35b06647-a6e2-4c8d-803a-f394ea890d4f'::uuid, md5(v_request||':curavino:contract')::uuid,
       md5(v_request||':curavino:service')::uuid, v_curavino_start,1500::numeric,7,'Serviço mensal Mugô'),
      ('6a25e024-0781-4cf1-a225-cd739bf34ef4'::uuid, md5(v_request||':cafifa:contract')::uuid,
       md5(v_request||':cafifa:service')::uuid, v_cafifa_start,5500::numeric,15,v_cafifa_service)
    ) creations(client_id,contract_id,service_id,start_date,monthly_value,billing_day,service_name)
  loop
    if exists(select 1 from public.contracts where id=v_new_contract and organization_id<>v_org) then
      raise exception 'ID determinístico de contrato ocupado por outra organização.';
    end if;
    if exists(select 1 from public.contracts where organization_id=v_org and client_id=v_primary and status='active'
      and start_date=v_start_date and monthly_value=v_monthly_value and billing_day=v_billing_day and id<>v_new_contract) then
      raise exception 'Contrato prospectivo equivalente já existe para cliente %.',v_primary;
    end if;

    insert into public.contracts(id,organization_id,client_id,status,start_date,billing_day,setup_value,monthly_value,
      auto_renew,notes,created_at,updated_at)
    values(v_new_contract,v_org,v_primary,'active',v_start_date,v_billing_day,0,v_monthly_value,true,v_reason,now(),now())
    on conflict(id) do nothing;
    get diagnostics v_count = row_count;
    v_created_contracts := v_created_contracts + v_count;

    insert into public.contract_services(id,organization_id,contract_id,service_name,billing_type,quantity,unit_price,
      monthly_value,one_time_value,created_at,updated_at)
    values(v_new_service,v_org,v_new_contract,v_service_name,'monthly',1,v_monthly_value,
      v_monthly_value,0,now(),now()) on conflict(id) do nothing;

    insert into public.invoice_installments(organization_id,client_id,contract_id,reference_month,installment_number,
      due_date,amount,received_amount,status,provider,idempotency_key,installment_type,description,source)
    select v_org,v_primary,v_new_contract,competence,n+1,
      make_date(extract(year from competence)::int,extract(month from competence)::int,
        least(v_billing_day,extract(day from(competence+interval '1 month - 1 day'))::int)),
      v_monthly_value,0,'pending','manual',v_org||':'||v_new_contract||':monthly:'||competence,
      'monthly','Mensalidade '||to_char(competence,'MM/YYYY'),'bulk-sanitation'
    from (
      select n,(date_trunc('month',v_start_date)+(n||' months')::interval)::date competence
      from generate_series(0,v_horizon-1) n
    ) schedule
    where make_date(extract(year from competence)::int,extract(month from competence)::int,
      least(v_billing_day,extract(day from(competence+interval '1 month - 1 day'))::int)) >= v_start_date
    on conflict(organization_id,contract_id,installment_type,reference_month) do nothing;
    get diagnostics v_count = row_count;
    v_created_installments := v_created_installments + v_count;

    update public.clients set status='active',updated_at=now() where id=v_primary and organization_id=v_org;
  end loop;

  insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data)
  select v_org,v_batch,'clients',id,'update',to_jsonb(c) from public.clients c
  where id='6a25e024-0781-4cf1-a225-cd739bf34ef4' and organization_id=v_org;
  update public.clients set contact_name=coalesce(nullif(trim(contact_name),''),'Guga'),status='active',
    notes=concat_ws(E'\n',nullif(trim(notes),''),'Referência comercial: Guga. Operação CAFIFA / Santo Circuito.'),updated_at=now()
  where id='6a25e024-0781-4cf1-a225-cd739bf34ef4' and organization_id=v_org;

  -- Capture complete after snapshots for every updated/moved/archived row.
  for v_table in select distinct table_name from public.bulk_data_sanitation_items where batch_id=v_batch and operation<>'create'
  loop
    if to_regclass('public.'||v_table) is not null then
      execute format(
        'update public.bulk_data_sanitation_items a set after_data=to_jsonb(t)
         from public.%I t where a.batch_id=$1 and a.table_name=%L and a.record_id=t.id',v_table,v_table
      ) using v_batch;
    end if;
  end loop;
  insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data,after_data)
  select v_org,v_batch,'contracts',c.id,'create',null,to_jsonb(c) from public.contracts c
  where c.id=any(array[md5(v_request||':curavino:contract')::uuid,md5(v_request||':cafifa:contract')::uuid]);
  insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data,after_data)
  select v_org,v_batch,'contract_services',s.id,'create',null,to_jsonb(s) from public.contract_services s
  where s.contract_id=any(array[md5(v_request||':curavino:contract')::uuid,md5(v_request||':cafifa:contract')::uuid]);
  insert into public.bulk_data_sanitation_items(organization_id,batch_id,table_name,record_id,operation,before_data,after_data)
  select v_org,v_batch,'invoice_installments',i.id,'create',null,to_jsonb(i) from public.invoice_installments i
  where i.contract_id=any(array[md5(v_request||':curavino:contract')::uuid,md5(v_request||':cafifa:contract')::uuid]);

  -- Immutable paid/setup snapshots must still match every financial evidence field.
  if exists (
    select 1 from public.bulk_data_sanitation_items a
    join public.invoice_installments i on i.id=a.record_id and i.organization_id=a.organization_id
    where a.batch_id=v_batch and a.operation='preserve' and (
      i.status is distinct from a.before_data->>'status'
      or i.amount is distinct from (a.before_data->>'amount')::numeric
      or i.received_amount is distinct from (a.before_data->>'received_amount')::numeric
      or i.paid_at is distinct from (a.before_data->>'paid_at')::timestamptz
      or i.payment_method is distinct from a.before_data->>'payment_method'
      or i.idempotency_key is distinct from a.before_data->>'idempotency_key'
    )
  ) then raise exception 'Uma parcela paga ou evidência de pagamento foi alterada.'; end if;

  if exists(select 1 from public.invoice_installments where organization_id=v_org
    group by idempotency_key having idempotency_key is not null and count(*)>1) then
    raise exception 'Foram detectadas idempotency_key duplicadas.';
  end if;

  if exists(select 1 from public.invoice_installments where organization_id=v_org
    group by contract_id,installment_type,reference_month having count(*)>1) then
    raise exception 'Foram detectadas competências duplicadas por contrato.';
  end if;

  for v_secondary in select unnest(array[
    'cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611'::uuid,
    'c68ebe35-e064-4fa1-9160-98725063c920'::uuid,
    '078a840a-5363-4a33-b6fe-646c1a5b851c'::uuid])
  loop
    if not exists(select 1 from public.clients where id=v_secondary and organization_id=v_org and status='archived' and deleted_at is not null) then
      raise exception 'Cliente secundário % não foi arquivado.',v_secondary;
    end if;
    for v_table in
      select c.table_name from information_schema.columns c
      join information_schema.columns oc on oc.table_schema=c.table_schema and oc.table_name=c.table_name and oc.column_name='organization_id'
      where c.table_schema='public' and c.column_name='client_id'
        and c.table_name not in('clients','data_merge_batches','data_merge_items','bulk_data_sanitation_batches','bulk_data_sanitation_items')
    loop
      execute format('select count(*) from public.%I where organization_id=$1 and client_id=$2',v_table)
      into v_count using v_org,v_secondary;
      if v_count>0 then raise exception 'Restaram % vínculo(s) em %.client_id para o secundário %.',v_count,v_table,v_secondary; end if;
    end loop;
  end loop;

  if not exists(select 1 from public.contracts where id='1d50e5d9-847e-4c96-9075-6a295b34b19f' and client_id='61974c0b-e344-4d60-9b12-1a1680c9c270' and monthly_value=1500 and billing_day=7)
    or not exists(select 1 from public.contracts where id='31978937-d01e-4aa6-925a-04e1901aafe7' and client_id='5e1646d2-6163-4164-9772-2acf31731eac' and monthly_value=4000 and billing_day=20)
    or not exists(select 1 from public.contracts where id='3b56bcde-99b5-4244-9a5d-e0535339a59f' and client_id='e7919cd3-c989-49c9-994f-eb31aa9ce294' and monthly_value=3200 and billing_day=20)
    or not exists(select 1 from public.contracts where id='71dd1456-0dd9-4b69-b77c-030b6269b24c' and client_id='de129d57-976f-42b6-a0a2-bafe7d16df13' and monthly_value=5000 and billing_day=10)
    or not exists(select 1 from public.contracts where id='7585f922-a937-4d2e-8a85-9846f3a93334' and status='terminated' and end_date=date '2026-07-26') then
    raise exception 'Validação final dos contratos tratados falhou.';
  end if;

  if (select count(*) from public.contracts where organization_id=v_org and id=any(array[
    md5(v_request||':curavino:contract')::uuid,md5(v_request||':cafifa:contract')::uuid
  ]) and status='active')<>2 then raise exception 'Contratos prospectivos não foram criados corretamente.'; end if;

  if (select count(*) from public.invoice_installments where organization_id=v_org
    and contract_id=any(array[md5(v_request||':curavino:contract')::uuid,md5(v_request||':cafifa:contract')::uuid]))<>v_created_installments then
    raise exception 'Contagem de parcelas prospectivas divergiu.';
  end if;

  v_report:=jsonb_build_object(
    'clientsConsolidated',3,'clientsArchived',v_archived,'contractsMoved',v_moved_contracts,
    'contractsChanged',v_changed_contracts,'contractsCreated',v_created_contracts,
    'installmentsMoved',v_moved_installments,'futureInstallmentsChanged',v_changed_installments,
    'installmentsCreated',v_created_installments,'paidInstallmentsPreserved',v_paid_preserved,
    'pendingIssues',jsonb_build_array(),'batchId',v_batch,'requestKey',v_request
  );
  update public.bulk_data_sanitation_batches set status='completed',report=v_report,completed_at=now()
  where id=v_batch;
  raise notice 'BULK_REAL_DATA_SANITATION_REPORT=%',v_report;
end
$bulk$;

select report
from public.bulk_data_sanitation_batches
where organization_id='1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f'
  and request_key='bulk-sanitation-2026-08-v1';

commit;
