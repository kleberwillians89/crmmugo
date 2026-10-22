-- Additive only. Does not enable cron, deploy workers or register/approve Meta templates.
begin;

alter table public.crm_tasks add column if not exists reminder_enabled boolean not null default true;
alter table public.crm_tasks add column if not exists reminder_minutes_before integer not null default 60 check (reminder_minutes_before = 60);

create table public.task_reminder_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  task_id uuid not null references public.crm_tasks(id),
  team_member_id uuid not null references public.team_members(id),
  channel text not null default 'whatsapp' check(channel='whatsapp'),
  due_at timestamptz not null,
  scheduled_for timestamptz not null,
  reminder_minutes integer not null default 60 check(reminder_minutes=60),
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled','blocked')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  idempotency_key text not null unique,
  claim_token uuid,
  processing_started_at timestamptz,
  dispatch_started_at timestamptz,
  provider_message_id text,
  sent_at timestamptz,
  failed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_reminder_due_idx on public.task_reminder_outbox(next_attempt_at,scheduled_for) where status in ('pending','failed');
create index task_reminder_task_idx on public.task_reminder_outbox(organization_id,task_id);
alter table public.task_reminder_outbox enable row level security;
create policy task_reminder_read on public.task_reminder_outbox for select to authenticated
  using (organization_id=public.current_organization_id() and public.is_active_user());
revoke all on public.task_reminder_outbox from anon, authenticated;
grant select on public.task_reminder_outbox to authenticated;
grant all on public.task_reminder_outbox to service_role;

create function public.protect_task_reminder_tenant() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.crm_tasks where id=new.task_id and organization_id=new.organization_id)
    or not exists(select 1 from public.team_members where id=new.team_member_id and organization_id=new.organization_id) then
    raise exception 'Task reminder tenant mismatch' using errcode='23514';
  end if;
  return new;
end $$;
create trigger protect_task_reminder_tenant before insert or update on public.task_reminder_outbox
for each row execute function public.protect_task_reminder_tenant();

create function public.sync_task_reminder() returns trigger language plpgsql security definer set search_path='' as $$
declare eligible boolean; due_instant timestamptz; send_at timestamptz; reminder_key text;
begin
  eligible := new.status not in ('completed','cancelled') and new.archived_at is null
    and new.assigned_to is not null and new.due_date is not null and new.due_time is not null and new.reminder_enabled;
  if eligible then
    -- Never project a cross-tenant assignee into the outbox.
    eligible := exists(select 1 from public.team_members where id=new.assigned_to and organization_id=new.organization_id);
  end if;
  if eligible then
    due_instant := (new.due_date + new.due_time) at time zone 'America/Sao_Paulo';
    send_at := due_instant - make_interval(mins=>new.reminder_minutes_before);
    reminder_key := 'task-reminder:'||new.id::text||':'||to_char(due_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||':60m';
  end if;
  update public.task_reminder_outbox set status='cancelled',next_attempt_at=null,updated_at=now(),
    error_code=case when new.status='completed' then 'TASK_COMPLETED' when new.status='cancelled' then 'TASK_CANCELLED'
      when new.archived_at is not null then 'TASK_ARCHIVED' else 'REMINDER_CHANGED' end
  where task_id=new.id and organization_id=new.organization_id and status in ('pending','failed','blocked','processing')
    and (not eligible or due_at is distinct from due_instant or team_member_id is distinct from new.assigned_to);
  if eligible then
    insert into public.task_reminder_outbox(organization_id,task_id,team_member_id,due_at,scheduled_for,next_attempt_at,idempotency_key,status,error_code)
    values(new.organization_id,new.id,new.assigned_to,due_instant,send_at,send_at,reminder_key,
      case when send_at < now()-interval '10 minutes' then 'cancelled' else 'pending' end,
      case when send_at < now()-interval '10 minutes' then 'REMINDER_EXPIRED' else null end)
    on conflict(idempotency_key) do update set team_member_id=excluded.team_member_id,status=excluded.status,
      next_attempt_at=excluded.next_attempt_at,error_code=excluded.error_code,claim_token=null,
      attempts=0,processing_started_at=null,updated_at=now()
    -- A reassignment reuses the unique unsent slot. Never reset a sent/possibly-sent delivery.
    where task_reminder_outbox.status='cancelled' and task_reminder_outbox.dispatch_started_at is null
      and task_reminder_outbox.provider_message_id is null;
  end if;
  return new;
end $$;
create trigger sync_task_reminder after insert or update of due_date,due_time,assigned_to,status,archived_at,reminder_enabled,reminder_minutes_before
  on public.crm_tasks for each row execute function public.sync_task_reminder();
revoke all on function public.sync_task_reminder() from public,anon,authenticated;

create function public.claim_task_reminders(p_reminder_id uuid default null)
returns setof public.task_reminder_outbox language plpgsql security definer set search_path='' as $$
begin
  -- A crashed worker may have sent. Never reclaim an uncertain provider dispatch automatically.
  update public.task_reminder_outbox set status=case when dispatch_started_at is null then 'failed' else 'blocked' end,
    error_code=case when dispatch_started_at is null then 'CLAIM_EXPIRED' else 'PROVIDER_RESULT_UNKNOWN' end,
    next_attempt_at=case when dispatch_started_at is null and attempts<6 then now() else null end,updated_at=now()
  where status='processing' and processing_started_at<now()-interval '10 minutes'
    and (p_reminder_id is null or id=p_reminder_id);
  return query
  with candidates as (
    select id from public.task_reminder_outbox
    where status in ('pending','failed') and scheduled_for<=now() and next_attempt_at<=now()
      and attempts<6 and provider_message_id is null and dispatch_started_at is null
      and (p_reminder_id is null or id=p_reminder_id)
    order by scheduled_for,id for update skip locked limit 50
  ) update public.task_reminder_outbox o set status='processing',attempts=o.attempts+1,
      claim_token=gen_random_uuid(),processing_started_at=now(),updated_at=now()
    from candidates c where o.id=c.id returning o.*;
end $$;

-- Final fence, with the same task -> outbox lock order as the scheduler trigger.
create function public.authorize_task_reminder(p_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.task_reminder_outbox; t public.crm_tasks; m public.team_members; target uuid; reason text; instant timestamptz;
begin
  select task_id into target from public.task_reminder_outbox where id=p_id;
  select * into t from public.crm_tasks where id=target for update;
  select * into r from public.task_reminder_outbox where id=p_id for update;
  if r.id is null or r.status<>'processing' or r.claim_token is distinct from p_claim_token or r.dispatch_started_at is not null then return null; end if;
  instant := (t.due_date+t.due_time) at time zone 'America/Sao_Paulo';
  reason := case
    when t.id is null or t.organization_id<>r.organization_id then 'TASK_NOT_FOUND'
    when t.status='completed' then 'TASK_COMPLETED' when t.status='cancelled' then 'TASK_CANCELLED'
    when t.archived_at is not null then 'TASK_ARCHIVED'
    when not t.reminder_enabled or t.reminder_minutes_before<>r.reminder_minutes or t.assigned_to is distinct from r.team_member_id or instant is distinct from r.due_at then 'REMINDER_CHANGED'
    when r.due_at<=now() or (r.attempts=1 and r.scheduled_for<now()-interval '10 minutes') then 'REMINDER_EXPIRED' end;
  if reason is not null then
    update public.task_reminder_outbox set status='cancelled',error_code=reason,next_attempt_at=null,updated_at=now() where id=r.id;
    return null;
  end if;
  select * into m from public.team_members where id=t.assigned_to and organization_id=t.organization_id and active;
  if m.id is null then
    update public.task_reminder_outbox set status='blocked',error_code='TEAM_MEMBER_INACTIVE',next_attempt_at=null,updated_at=now() where id=r.id;
    return null;
  end if;
  update public.task_reminder_outbox set dispatch_started_at=now(),updated_at=now() where id=r.id;
  return jsonb_build_object('task',to_jsonb(t),'member',to_jsonb(m));
end $$;
revoke all on function public.claim_task_reminders(uuid) from public,anon,authenticated;
revoke all on function public.authorize_task_reminder(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_task_reminders(uuid) to service_role;
grant execute on function public.authorize_task_reminder(uuid,uuid) to service_role;

-- Existing future timed tasks are scheduled when the migration is manually applied.
-- Does not update tasks or fire unrelated task triggers.
insert into public.task_reminder_outbox(organization_id,task_id,team_member_id,due_at,scheduled_for,next_attempt_at,idempotency_key)
select t.organization_id,t.id,t.assigned_to,s.due_at,s.due_at-interval '60 minutes',s.due_at-interval '60 minutes',
 'task-reminder:'||t.id::text||':'||to_char(s.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||':60m'
from public.crm_tasks t join public.team_members m on m.id=t.assigned_to and m.organization_id=t.organization_id
cross join lateral (select (t.due_date+t.due_time) at time zone 'America/Sao_Paulo' as due_at) s
where t.status not in ('completed','cancelled') and t.archived_at is null and t.reminder_enabled and s.due_at>=now()+interval '60 minutes'
on conflict(idempotency_key) do nothing;
commit;
