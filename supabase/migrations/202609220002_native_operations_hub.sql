-- CRMugo como central operacional nativa. Aditiva; aplicar manualmente.

alter table public.crm_tasks add column if not exists project_id uuid;
alter table public.crm_tasks add column if not exists tags text[] not null default '{}';
alter table public.crm_tasks add column if not exists archived_at timestamptz;
alter table public.crm_tasks drop constraint if exists crm_tasks_task_type_check;
alter table public.crm_tasks add constraint crm_tasks_task_type_check
  check(task_type in('general','commercial','follow_up','meeting','proposal','briefing','delivery','activity')) not valid;
create index if not exists crm_tasks_project_idx on public.crm_tasks(organization_id,project_id,status);
create index if not exists crm_tasks_backlog_idx on public.crm_tasks(organization_id,priority,created_at) where due_date is null and archived_at is null;
create index if not exists crm_tasks_calendar_idx on public.crm_tasks(organization_id,due_date,due_time) where archived_at is null;

create or replace function public.can_operate() returns boolean language sql stable set search_path='' as $$
  select public.current_user_role() in('admin','manager','operations','commercial')
$$;
create or replace function public.can_access_finance() returns boolean language sql stable set search_path='' as $$
  select public.current_user_role() in('admin','manager','finance')
$$;
create or replace function public.current_team_member_id() returns uuid language sql stable security definer set search_path='' as $$
  select id from public.team_members where organization_id=public.current_organization_id() and auth_profile_id=auth.uid() and active=true limit 1
$$;

drop policy if exists crm_tasks_read on public.crm_tasks;
drop policy if exists crm_tasks_write on public.crm_tasks;
drop policy if exists crm_tasks_insert on public.crm_tasks;
drop policy if exists crm_tasks_update on public.crm_tasks;
drop policy if exists crm_tasks_delete on public.crm_tasks;
create policy crm_tasks_read on public.crm_tasks for select to authenticated
  using(organization_id=public.current_organization_id() and public.can_operate());
create policy crm_tasks_insert on public.crm_tasks for insert to authenticated
  with check(organization_id=public.current_organization_id() and public.can_operate());
create policy crm_tasks_update on public.crm_tasks for update to authenticated
  using(organization_id=public.current_organization_id() and public.can_operate())
  with check(organization_id=public.current_organization_id() and public.can_operate());
create policy crm_tasks_delete on public.crm_tasks for delete to authenticated
  using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'));

create table if not exists public.client_operational_access(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(client_id,team_member_id)
);
alter table public.client_operational_access enable row level security;
alter table public.client_operational_access force row level security;
grant select,insert,update,delete on public.client_operational_access to authenticated;
create policy client_operational_access_read on public.client_operational_access for select to authenticated
  using(organization_id=public.current_organization_id() and (team_member_id=public.current_team_member_id() or public.current_user_role() in('admin','manager')));
create policy client_operational_access_manage on public.client_operational_access for all to authenticated
  using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'))
  with check(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'));
drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated using(
  organization_id=public.current_organization_id() and public.is_active_user() and (
    public.current_user_role() in('admin','manager','finance','commercial')
    or primary_responsible_id=public.current_team_member_id()
    or exists(select 1 from public.client_operational_access a where a.client_id=clients.id and a.organization_id=clients.organization_id and a.team_member_id=public.current_team_member_id())
  )
);

create table if not exists public.operational_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_type text not null,
  title text not null,
  description text,
  actor_id uuid references public.profiles(id) on delete set null,
  team_member_id uuid references public.team_members(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  opportunity_id uuid references public.commercial_opportunities(id) on delete set null,
  task_id uuid references public.crm_tasks(id) on delete set null,
  project_id uuid,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  source text not null default 'crm' check(source in('crm','whatsapp','automation','system')),
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(organization_id,idempotency_key)
);
create index if not exists operational_events_timeline_idx on public.operational_events(organization_id,occurred_at desc);
create index if not exists operational_events_retrospective_idx on public.operational_events(organization_id,team_member_id,event_type,occurred_at desc);
alter table public.operational_events enable row level security;
alter table public.operational_events force row level security;
create policy operational_events_read on public.operational_events for select to authenticated
  using(organization_id=public.current_organization_id() and public.can_operate());
create policy operational_events_insert on public.operational_events for insert to authenticated
  with check(organization_id=public.current_organization_id() and public.can_operate() and (actor_id is null or actor_id=auth.uid()));
grant select,insert on public.operational_events to authenticated;
grant select,insert,update,delete on public.operational_events to service_role;

create or replace function public.capture_task_operational_event() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; heading text; details text;
begin
  if tg_op='INSERT' then kind:='task_created';heading:='Tarefa criada';details:=new.title;
  elsif old.status is distinct from new.status and new.status='completed' then kind:='task_completed';heading:='Tarefa concluída';details:=new.title;
  elsif old.status is distinct from new.status and new.status='in_progress' then kind:='activity_started';heading:='Atividade iniciada';details:=new.title;
  elsif old.due_date is distinct from new.due_date then kind:='task_rescheduled';heading:='Tarefa reagendada';details:=new.title;
  elsif old.notes is distinct from new.notes then kind:='observation_added';heading:='Observação adicionada';details:=new.title;
  elsif old.assigned_to is distinct from new.assigned_to then kind:='task_assigned';heading:='Responsável alterado';details:=new.title;
  elsif old.status is distinct from new.status then kind:='status_changed';heading:='Status alterado';details:=new.title;
  else return new; end if;
  insert into public.operational_events(organization_id,event_type,title,description,actor_id,team_member_id,client_id,opportunity_id,task_id,project_id,source,metadata)
  values(new.organization_id,kind,heading,details,auth.uid(),new.assigned_to,new.client_id,new.opportunity_id,new.id,new.project_id,case when new.source='whatsapp' then 'whatsapp' when new.source='automation' then 'automation' else 'crm' end,
    jsonb_build_object('old_status',case when tg_op='UPDATE' then old.status else null end,'new_status',new.status,'due_date',new.due_date));
  return new;
end$$;
drop trigger if exists capture_task_operational_event on public.crm_tasks;
create trigger capture_task_operational_event after insert or update on public.crm_tasks for each row execute function public.capture_task_operational_event();

create table if not exists public.financial_command_confirmations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  command_event_id uuid not null references public.task_command_events(id) on delete restrict,
  team_member_id uuid not null references public.team_members(id) on delete restrict,
  amount numeric(14,2) not null check(amount>0),
  description text not null,
  category_name text,
  expense_id uuid references public.expenses(id) on delete set null,
  status text not null default 'pending' check(status in('pending','confirmed','cancelled','expired')),
  expires_at timestamptz not null default now()+interval '30 minutes',
  confirmed_at timestamptz,
  resolution_command_event_id uuid references public.task_command_events(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(command_event_id)
);
alter table public.financial_command_confirmations add column if not exists resolution_command_event_id uuid references public.task_command_events(id) on delete set null;
create unique index if not exists financial_command_resolution_uidx on public.financial_command_confirmations(resolution_command_event_id) where resolution_command_event_id is not null;
create unique index if not exists financial_command_one_pending_idx on public.financial_command_confirmations(organization_id,team_member_id) where status='pending';
alter table public.financial_command_confirmations enable row level security;
alter table public.financial_command_confirmations force row level security;
create policy financial_command_confirmations_read on public.financial_command_confirmations for select to authenticated
  using(organization_id=public.current_organization_id() and public.can_access_finance());
revoke all on public.financial_command_confirmations from public,anon,authenticated;
grant select,insert,update,delete on public.financial_command_confirmations to service_role;

create or replace function public.protect_native_operations_tenant() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='client_operational_access' and (
    not exists(select 1 from public.clients where id=new.client_id and organization_id=new.organization_id)
    or not exists(select 1 from public.team_members where id=new.team_member_id and organization_id=new.organization_id)
  ) then raise exception 'Operational access tenant mismatch' using errcode='23514';
  elsif tg_table_name='operational_events' and (
    (new.team_member_id is not null and not exists(select 1 from public.team_members where id=new.team_member_id and organization_id=new.organization_id))
    or (new.client_id is not null and not exists(select 1 from public.clients where id=new.client_id and organization_id=new.organization_id))
    or (new.task_id is not null and not exists(select 1 from public.crm_tasks where id=new.task_id and organization_id=new.organization_id))
    or (new.opportunity_id is not null and not exists(select 1 from public.commercial_opportunities where id=new.opportunity_id and organization_id=new.organization_id))
    or (new.conversation_id is not null and not exists(select 1 from public.whatsapp_conversations where id=new.conversation_id and organization_id=new.organization_id))
  ) then raise exception 'Operational event tenant mismatch' using errcode='23514';
  elsif tg_table_name='financial_command_confirmations' and (
    not exists(select 1 from public.task_command_events where id=new.command_event_id and organization_id=new.organization_id)
    or not exists(select 1 from public.team_members where id=new.team_member_id and organization_id=new.organization_id)
    or (new.expense_id is not null and not exists(select 1 from public.expenses where id=new.expense_id and organization_id=new.organization_id))
  ) then raise exception 'Financial confirmation tenant mismatch' using errcode='23514'; end if;
  return new;
end$$;
do $$ declare t text; begin foreach t in array array['client_operational_access','operational_events','financial_command_confirmations'] loop
  execute format('drop trigger if exists protect_native_operations_tenant on public.%I',t);
  execute format('create trigger protect_native_operations_tenant before insert or update on public.%I for each row execute function public.protect_native_operations_tenant()',t);
end loop; end$$;

-- Financeiro nunca é liberado apenas por esconder componentes no frontend.
do $$ declare t text; begin
  foreach t in array array['expense_categories','cost_centers','financial_accounts','expenses','expense_installments'] loop
    execute format('drop policy if exists %I_read on public.%I',t,t);
    execute format('drop policy if exists %I_insert on public.%I',t,t);
    execute format('drop policy if exists %I_update on public.%I',t,t);
    execute format('create policy %I_read on public.%I for select to authenticated using(organization_id=public.current_organization_id() and public.can_access_finance())',t,t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check(organization_id=public.current_organization_id() and public.can_access_finance())',t,t);
    execute format('create policy %I_update on public.%I for update to authenticated using(organization_id=public.current_organization_id() and public.can_access_finance()) with check(organization_id=public.current_organization_id() and public.can_access_finance())',t,t);
  end loop;
end$$;
drop policy if exists invoice_installments_read on public.invoice_installments;
drop policy if exists invoice_installments_write on public.invoice_installments;
create policy invoice_installments_read on public.invoice_installments for select to authenticated
  using(organization_id=public.current_organization_id() and public.can_access_finance());
create policy invoice_installments_write on public.invoice_installments for all to authenticated
  using(organization_id=public.current_organization_id() and public.can_access_finance())
  with check(organization_id=public.current_organization_id() and public.can_access_finance());

-- Integrações externas continuam disponíveis, mas nenhuma projeção é criada sem opt-in explícito.
create or replace function public.enqueue_task_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare task_origin text:=coalesce(new.metadata->>'origin',new.source,'crm');state_hash text;target text;
begin
  state_hash:=md5(jsonb_build_object('title',new.title,'status',new.status,'priority',new.priority,'due_date',new.due_date,'due_time',new.due_time,'assigned_to',new.assigned_to,'client_id',new.client_id,'notes',new.notes)::text);
  for target in select provider from public.task_integration_settings where organization_id=new.organization_id and enabled=true loop
    if target<>task_origin then insert into public.task_sync_outbox(organization_id,task_id,provider,origin,payload,idempotency_key)
      values(new.organization_id,new.id,target,task_origin,jsonb_build_object('state_hash',state_hash),new.id::text||':'||target||':'||state_hash)
      on conflict(organization_id,provider,idempotency_key) do nothing; end if;
  end loop;
  return new;
end$$;

comment on table public.operational_events is 'Linha do tempo canônica para atividades, decisões e retrospectivas operacionais.';
comment on table public.financial_command_confirmations is 'Confirmações explícitas e idempotentes antes de efetivar comandos financeiros internos.';
