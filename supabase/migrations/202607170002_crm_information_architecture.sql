-- PREPARAR apenas: não aplicar automaticamente.
-- Responsabilidades específicas e tarefas operacionais relacionadas às entidades do CRM.
alter table public.clients add column if not exists primary_responsible_id uuid references public.team_members(id) on delete set null;
alter table public.contracts add column if not exists delivery_responsible_id uuid references public.team_members(id) on delete set null;
alter table public.contracts add column if not exists financial_responsible_id uuid references public.team_members(id) on delete set null;

create table if not exists public.crm_tasks(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 240),
 status text not null default 'pending' check(status in('pending','in_progress','completed','cancelled')),
 priority text not null default 'medium' check(priority in('low','medium','high','critical')),
 due_date date,
 assigned_to uuid references public.team_members(id) on delete set null,
 client_id uuid references public.clients(id) on delete cascade,
 proposal_id uuid references public.proposals(id) on delete cascade,
 contract_id uuid references public.contracts(id) on delete cascade,
 installment_id uuid references public.invoice_installments(id) on delete cascade,
 notes text,
 created_by uuid references public.profiles(id) on delete set null,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(num_nonnulls(client_id,proposal_id,contract_id,installment_id)<=1)
);
create index if not exists crm_tasks_org_due_idx on public.crm_tasks(organization_id,status,due_date);
create index if not exists crm_tasks_assigned_idx on public.crm_tasks(organization_id,assigned_to,status);
alter table public.crm_tasks enable row level security;
drop policy if exists crm_tasks_read on public.crm_tasks;
drop policy if exists crm_tasks_write on public.crm_tasks;
create policy crm_tasks_read on public.crm_tasks for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
create policy crm_tasks_write on public.crm_tasks for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write());
drop trigger if exists set_updated_at on public.crm_tasks;
create trigger set_updated_at before update on public.crm_tasks for each row execute function public.set_updated_at();
