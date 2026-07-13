-- Sprint 10.5: staging privado e rastreabilidade da extração comercial assistida.
create table if not exists public.document_analyses(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  temp_bucket text not null default 'crm-documents-temp',
  temp_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check(file_size between 1 and 20971520),
  content_hash text not null,
  status text not null default 'uploaded' check(status in('uploaded','analyzing','completed','failed','confirmed','cancelled')),
  document_type text check(document_type is null or document_type in('proposal','signed_contract','unsigned_contract','amendment','other')),
  overall_confidence numeric(4,3) check(overall_confidence between 0 and 1),
  field_count integer not null default 0 check(field_count >= 0),
  low_confidence_fields text[] not null default '{}',
  warnings text[] not null default '{}',
  missing_fields text[] not null default '{}',
  conflicts jsonb not null default '[]'::jsonb,
  extracted_data jsonb,
  controlled_error text,
  duration_ms integer check(duration_ms is null or duration_ms >= 0),
  confirmed_document_id uuid references public.documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index if not exists document_analyses_org_status on public.document_analyses(organization_id,status,created_at desc);
create unique index if not exists document_analyses_temp_path on public.document_analyses(temp_bucket,temp_path);
create index if not exists document_analyses_org_hash on public.document_analyses(organization_id,content_hash);
alter table public.document_analyses enable row level security;

create policy document_analyses_read on public.document_analyses for select to authenticated
using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'));
create policy document_analyses_insert on public.document_analyses for insert to authenticated
with check(organization_id=public.current_organization_id() and user_id=auth.uid() and public.current_user_role() in('admin','manager'));
create policy document_analyses_update on public.document_analyses for update to authenticated
using(organization_id=public.current_organization_id() and user_id=auth.uid() and public.current_user_role() in('admin','manager'))
with check(organization_id=public.current_organization_id() and user_id=auth.uid() and public.current_user_role() in('admin','manager'));

drop trigger if exists set_updated_at on public.document_analyses;
create trigger set_updated_at before update on public.document_analyses for each row execute function public.set_updated_at();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-documents-temp','crm-documents-temp',false,20971520,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=excluded.allowed_mime_types;

create policy crm_documents_temp_read on storage.objects for select to authenticated
using(bucket_id='crm-documents-temp' and (storage.foldername(name))[1]=public.current_organization_id()::text and (storage.foldername(name))[2]=auth.uid()::text and public.current_user_role() in('admin','manager'));
create policy crm_documents_temp_write on storage.objects for insert to authenticated
with check(bucket_id='crm-documents-temp' and (storage.foldername(name))[1]=public.current_organization_id()::text and (storage.foldername(name))[2]=auth.uid()::text and public.current_user_role() in('admin','manager'));
create policy crm_documents_temp_update on storage.objects for update to authenticated
using(bucket_id='crm-documents-temp' and (storage.foldername(name))[1]=public.current_organization_id()::text and (storage.foldername(name))[2]=auth.uid()::text and public.current_user_role() in('admin','manager'))
with check(bucket_id='crm-documents-temp' and (storage.foldername(name))[1]=public.current_organization_id()::text and (storage.foldername(name))[2]=auth.uid()::text and public.current_user_role() in('admin','manager'));
create policy crm_documents_temp_delete on storage.objects for delete to authenticated
using(bucket_id='crm-documents-temp' and (storage.foldername(name))[1]=public.current_organization_id()::text and (storage.foldername(name))[2]=auth.uid()::text and public.current_user_role() in('admin','manager'));

-- Pode ser chamada por uma rotina agendada com credenciais administrativas.
create or replace function public.expire_document_analyses() returns setof public.document_analyses
language sql security definer set search_path='' as $$
  update public.document_analyses set status='cancelled',extracted_data=null
  where expires_at<now() and status in('uploaded','analyzing','completed','failed')
  returning *
$$;
revoke all on function public.expire_document_analyses() from public,anon,authenticated;
