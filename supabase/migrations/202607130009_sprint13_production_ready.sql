-- Sprint 13: equipe operacional independente de contas de autenticação.
create table if not exists public.team_members(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),auth_profile_id uuid unique references public.profiles(id) on delete set null,
  name text not null,job_title text,phone text,email text,color text not null default '#D7A84B',photo_url text,active boolean not null default true,created_at timestamptz default now(),updated_at timestamptz default now(),unique(organization_id,name)
);
insert into public.team_members(id,organization_id,auth_profile_id,name,email,active)
select id,organization_id,id,name,email,active from public.profiles on conflict(id) do update set auth_profile_id=excluded.auth_profile_id,name=excluded.name,email=coalesce(public.team_members.email,excluded.email);
insert into public.team_members(organization_id,name,job_title,color)
select o.id,v.name,v.job_title,v.color from public.organizations o cross join(values('Julia','Comercial e relacionamento','#C084FC'),('Danilo','Operações','#60A5FA'),('Kleber','Direção comercial','#D7A84B'))v(name,job_title,color) where o.slug='mugo' on conflict(organization_id,name) do nothing;
alter table public.team_members enable row level security;
drop policy if exists team_members_read on public.team_members;create policy team_members_read on public.team_members for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists team_members_admin on public.team_members;create policy team_members_admin on public.team_members for all to authenticated using(organization_id=public.current_organization_id() and public.is_admin()) with check(organization_id=public.current_organization_id() and public.is_admin());
drop trigger if exists set_updated_at on public.team_members;create trigger set_updated_at before update on public.team_members for each row execute function public.set_updated_at();

alter table public.proposals drop constraint if exists proposals_responsible_id_fkey;
alter table public.contracts drop constraint if exists contracts_responsible_id_fkey;
alter table public.proposal_services drop constraint if exists proposal_services_commercial_responsible_id_fkey;
alter table public.proposal_services drop constraint if exists proposal_services_delivery_responsible_id_fkey;
alter table public.proposal_services drop constraint if exists proposal_services_support_responsible_id_fkey;
alter table public.contract_services drop constraint if exists contract_services_commercial_responsible_id_fkey;
alter table public.contract_services drop constraint if exists contract_services_delivery_responsible_id_fkey;
alter table public.contract_services drop constraint if exists contract_services_support_responsible_id_fkey;
alter table public.proposals add constraint proposals_responsible_id_fkey foreign key(responsible_id) references public.team_members(id);
alter table public.contracts add constraint contracts_responsible_id_fkey foreign key(responsible_id) references public.team_members(id);
alter table public.proposal_services add constraint proposal_services_commercial_responsible_id_fkey foreign key(commercial_responsible_id) references public.team_members(id),add constraint proposal_services_delivery_responsible_id_fkey foreign key(delivery_responsible_id) references public.team_members(id),add constraint proposal_services_support_responsible_id_fkey foreign key(support_responsible_id) references public.team_members(id);
alter table public.contract_services add constraint contract_services_commercial_responsible_id_fkey foreign key(commercial_responsible_id) references public.team_members(id),add constraint contract_services_delivery_responsible_id_fkey foreign key(delivery_responsible_id) references public.team_members(id),add constraint contract_services_support_responsible_id_fkey foreign key(support_responsible_id) references public.team_members(id);
create index if not exists team_members_org_active_idx on public.team_members(organization_id,active,name);
