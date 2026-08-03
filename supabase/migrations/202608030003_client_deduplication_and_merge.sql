-- Consolidação segura de clientes. Migration aditiva; não consolida dados automaticamente.
create table if not exists public.data_merge_batches(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 request_key uuid not null, merge_type text not null default 'client' check(merge_type='client'),
 primary_client_id uuid not null references public.clients(id) on delete restrict,
 secondary_client_ids uuid[] not null check(cardinality(secondary_client_ids)>0), reason text not null check(length(trim(reason))>=10),
 approved_preview jsonb not null, status text not null default 'processing' check(status in('processing','completed','failed')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz,
 unique(organization_id,request_key)
);
create table if not exists public.data_merge_items(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 batch_id uuid not null references public.data_merge_batches(id) on delete restrict,
 table_name text not null, record_id uuid, action text not null check(action in('move','archive','update','preserve')),
 before_data jsonb not null, after_data jsonb, created_at timestamptz not null default now()
);
create table if not exists public.duplicate_review_status(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 entity_type text not null check(entity_type in('client','contract','installment')), entity_ids uuid[] not null,
 classification text not null check(classification in('probable_duplicate','legitimate_coincidence','needs_review','merged')),
 notes text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,entity_type,entity_ids)
);
create index if not exists merge_batches_org_created_idx on public.data_merge_batches(organization_id,created_at desc);
create index if not exists merge_items_batch_idx on public.data_merge_items(batch_id,table_name);
create index if not exists duplicate_review_org_type_idx on public.duplicate_review_status(organization_id,entity_type,classification);

alter table public.data_merge_batches enable row level security;
alter table public.data_merge_items enable row level security;
alter table public.duplicate_review_status enable row level security;
create policy merge_batches_read on public.data_merge_batches for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
create policy merge_items_read on public.data_merge_items for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
create policy duplicate_review_read on public.duplicate_review_status for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
create policy duplicate_review_insert on public.duplicate_review_status for insert to authenticated with check(organization_id=public.current_organization_id() and public.can_write());
create policy duplicate_review_update on public.duplicate_review_status for update to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write());
create trigger set_updated_at before update on public.duplicate_review_status for each row execute function public.set_updated_at();
create trigger audit_changes after insert or update or delete on public.duplicate_review_status for each row execute function public.capture_audit_log();

create or replace function public.preview_client_merge(primary_id uuid,secondary_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();primary_row public.clients%rowtype;invalid_count integer;counts jsonb:='{}';target_table text;row_count bigint;active_contracts bigint;suspicious_installments bigint;
begin
 if auth.uid() is null or not public.can_write() then raise exception 'Você não tem permissão para revisar consolidações.';end if;
 if primary_id=any(secondary_ids) or cardinality(secondary_ids)=0 then raise exception 'Seleção de clientes inválida.';end if;
 select * into primary_row from public.clients where id=primary_id and organization_id=org;
 if not found then raise exception 'Cliente principal não encontrado nesta organização.';end if;
 select count(*) into invalid_count from unnest(secondary_ids) as secondary(client_id) left join public.clients c on c.id=secondary.client_id and c.organization_id=org where c.id is null;
 if invalid_count>0 then raise exception 'Há clientes secundários de outra organização ou inexistentes.';end if;
 foreach target_table in array array['contracts','proposals','invoice_installments','documents','commercial_events','whatsapp_conversation_links','whatsapp_collection_alerts','crm_tasks','pulse_alerts','pulse_tasks'] loop
  if to_regclass('public.'||target_table) is not null and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=target_table and c.column_name='client_id') then
   execute format('select count(*) from public.%I where organization_id=$1 and client_id=any($2)',target_table) into row_count using org,secondary_ids;
   counts:=counts||jsonb_build_object(target_table,row_count);
  end if;
 end loop;
 select count(*) into active_contracts from public.contracts where organization_id=org and client_id=any(array_append(secondary_ids,primary_id)) and status='active' and deleted_at is null;
 select count(*) into suspicious_installments from(select reference_month,due_date,amount,count(*) from public.invoice_installments where organization_id=org and client_id=any(array_append(secondary_ids,primary_id)) group by 1,2,3 having count(*)>1)x;
 return jsonb_build_object('organization_id',org,'primary_client',to_jsonb(primary_row),'secondary_clients',(select jsonb_agg(to_jsonb(c) order by c.created_at) from public.clients c where c.organization_id=org and c.id=any(secondary_ids)),'counts',counts,'conflicts',jsonb_build_object('multiple_active_contracts',active_contracts>1,'active_contract_count',active_contracts,'suspicious_installment_groups',suspicious_installments),'generated_at',now());
end$$;

create or replace function public.execute_client_merge(request_key uuid,primary_id uuid,secondary_ids uuid[],selected_fields jsonb,reason text,confirmation_name text,approved_preview jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();primary_row public.clients%rowtype;preview jsonb;batch uuid;target_table text;record jsonb;existing uuid;allowed_fields text[]:=array['company_name','trade_name','contact_name','document_number','email','phone','website','instagram','segment','lead_source','status','notes','billing_contact_name','billing_contact_email','billing_contact_phone','billing_contact_role'];field text;
begin
 if auth.uid() is null or not public.can_write() then raise exception 'Você não tem permissão para consolidar clientes.';end if;
 select id into existing from public.data_merge_batches where organization_id=org and data_merge_batches.request_key=execute_client_merge.request_key and status='completed';if existing is not null then return existing;end if;
 select * into primary_row from public.clients where id=primary_id and organization_id=org for update;
 if not found or lower(trim(primary_row.company_name))<>lower(trim(confirmation_name)) then raise exception 'Confirmação do cliente principal inválida.';end if;
 if length(trim(reason))<10 then raise exception 'Informe um motivo detalhado.';end if;
 perform 1 from public.clients where organization_id=org and id=any(secondary_ids) for update;
 preview:=public.preview_client_merge(primary_id,secondary_ids);
 if approved_preview->'counts' is distinct from preview->'counts' or approved_preview->'conflicts' is distinct from preview->'conflicts' then raise exception 'O preview mudou. Revise novamente antes de consolidar.';end if;
 insert into public.data_merge_batches(organization_id,request_key,primary_client_id,secondary_client_ids,reason,approved_preview,created_by) values(org,request_key,primary_id,secondary_ids,trim(reason),preview,auth.uid()) returning id into batch;
 insert into public.data_merge_items(organization_id,batch_id,table_name,record_id,action,before_data) select org,batch,'clients',c.id,'archive',to_jsonb(c) from public.clients c where c.organization_id=org and c.id=any(secondary_ids);
 foreach target_table in array array['contracts','proposals','invoice_installments','documents','commercial_events','whatsapp_conversation_links','whatsapp_collection_alerts','crm_tasks','pulse_alerts','pulse_tasks'] loop
  if to_regclass('public.'||target_table) is not null and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=target_table and c.column_name='client_id') then
   for record in execute format('select to_jsonb(x) from public.%I x where organization_id=$1 and client_id=any($2)',target_table) using org,secondary_ids loop
    insert into public.data_merge_items(organization_id,batch_id,table_name,record_id,action,before_data) values(org,batch,target_table,(record->>'id')::uuid,'move',record);
   end loop;
   execute format('update public.%I set client_id=$1 where organization_id=$2 and client_id=any($3)',target_table) using primary_id,org,secondary_ids;
  end if;
 end loop;
 foreach field in array allowed_fields loop if selected_fields ? field then execute format('update public.clients set %I=$1,updated_at=now(),updated_by=auth.uid() where id=$2 and organization_id=$3',field) using selected_fields->>field,primary_id,org;end if;end loop;
 if selected_fields ? 'primary_responsible_id' then update public.clients set primary_responsible_id=nullif(selected_fields->>'primary_responsible_id','')::uuid,updated_at=now(),updated_by=auth.uid() where id=primary_id and organization_id=org;end if;
 update public.clients set status='archived',deleted_at=coalesce(deleted_at,now()),updated_at=now(),updated_by=auth.uid() where organization_id=org and id=any(secondary_ids);
 update public.data_merge_items set after_data=jsonb_build_object('client_id',primary_id) where batch_id=batch and action='move';
 update public.data_merge_items set after_data=(select to_jsonb(c) from public.clients c where c.id=data_merge_items.record_id) where batch_id=batch and table_name='clients';
 update public.data_merge_batches set status='completed',completed_at=now() where id=batch;
 return batch;
exception when others then raise;end$$;
revoke all on function public.preview_client_merge(uuid,uuid[]) from public;
revoke all on function public.execute_client_merge(uuid,uuid,uuid[],jsonb,text,text,jsonb) from public;
grant execute on function public.preview_client_merge(uuid,uuid[]) to authenticated;
grant execute on function public.execute_client_merge(uuid,uuid,uuid[],jsonb,text,text,jsonb) to authenticated;
