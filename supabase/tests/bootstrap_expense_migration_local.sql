-- Bootstrap mínimo e descartável para validar a migration de despesas em PostgreSQL vazio.
create schema auth;
create role authenticated nologin;
create table auth.users(id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable set search_path='' as $$select null::uuid$$;

create table public.organizations(id uuid primary key default gen_random_uuid(),name text not null);
create table public.profiles(id uuid primary key references auth.users(id),organization_id uuid not null references public.organizations(id),role text not null,active boolean not null default true);
create table public.audit_log(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),actor_id uuid references auth.users(id),action text not null,entity_type text not null,record_id uuid,before_data jsonb,after_data jsonb,source text,created_at timestamptz default now());

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path='' as $$begin new.updated_at=now();return new;end$$;
create or replace function public.current_organization_id() returns uuid language sql stable security definer set search_path='' as $$select organization_id from public.profiles where id=auth.uid() and active=true$$;
create or replace function public.current_user_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and active=true$$;
create or replace function public.is_active_user() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and active=true)$$;
create or replace function public.can_write() returns boolean language sql stable set search_path='' as $$select public.current_user_role() in('admin','manager')$$;
create or replace function public.capture_audit_log() returns trigger language plpgsql security definer set search_path='' as $$
declare old_row jsonb;new_row jsonb;org uuid;rid uuid;
begin
 old_row:=case when tg_op in('UPDATE','DELETE') then to_jsonb(old) end;
 new_row:=case when tg_op in('INSERT','UPDATE') then to_jsonb(new) end;
 org:=coalesce((new_row->>'organization_id')::uuid,(old_row->>'organization_id')::uuid);
 rid:=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
 insert into public.audit_log(organization_id,actor_id,action,entity_type,record_id,before_data,after_data,source)
 values(org,auth.uid(),lower(tg_op),tg_table_name,rid,old_row,new_row,'database');
 return case when tg_op='DELETE' then old else new end;
end$$;
