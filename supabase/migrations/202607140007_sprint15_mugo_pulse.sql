-- Sprint 15. PREPARAR apenas: não aplicar automaticamente.
create table if not exists public.pulse_alerts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),fingerprint text not null,rule text not null,
 title text not null,description text not null,category text not null check(category in('Financeiro','Comercial','Operação','Clientes','Equipe','Serviços','Contratos','Intelligence','Sistema')),
 priority text not null check(priority in('critical','high','medium','low','informational')),origin text not null default 'Mugô Pulse',status text not null default 'open' check(status in('open','snoozed','resolved','ignored')),
 score integer not null default 0,client_id uuid references public.clients(id),contract_id uuid references public.contracts(id),proposal_id uuid references public.proposals(id),assigned_to uuid references public.team_members(id),
 link text,evidence jsonb not null default '[]',note text,detected_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),occurrences integer not null default 1,
 snoozed_until timestamptz,resolved_at timestamptz,resolved_by uuid references public.profiles(id),resolution_note text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,fingerprint)
);
create table if not exists public.pulse_alert_events(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),alert_id uuid not null references public.pulse_alerts(id) on delete cascade,event_type text not null,note text,actor_id uuid references public.profiles(id),metadata jsonb not null default '{}',created_at timestamptz not null default now());
create table if not exists public.pulse_tasks(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),alert_id uuid not null references public.pulse_alerts(id),title text not null,status text not null default 'open',assigned_to uuid references public.team_members(id),created_by uuid references public.profiles(id),created_at timestamptz not null default now(),completed_at timestamptz);
create index if not exists pulse_alerts_active_idx on public.pulse_alerts(organization_id,status,priority,last_seen_at desc);
create index if not exists pulse_alert_events_alert_idx on public.pulse_alert_events(alert_id,created_at desc);
alter table public.pulse_alerts enable row level security;alter table public.pulse_alert_events enable row level security;alter table public.pulse_tasks enable row level security;
drop policy if exists pulse_alerts_read on public.pulse_alerts;create policy pulse_alerts_read on public.pulse_alerts for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists pulse_events_read on public.pulse_alert_events;create policy pulse_events_read on public.pulse_alert_events for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists pulse_tasks_read on public.pulse_tasks;create policy pulse_tasks_read on public.pulse_tasks for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());

create or replace function public.sync_pulse_alerts(detected_alerts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();item jsonb;alert_id uuid;previous_status text;created_count int:=0;updated_count int:=0;reopened_count int:=0;
begin if not public.is_active_user() then raise exception 'Usuário inativo.';end if;
 for item in select * from jsonb_array_elements(coalesce(detected_alerts,'[]')) loop
  alert_id:=null;previous_status:=null;
  select id,status into alert_id,previous_status from public.pulse_alerts where organization_id=org and fingerprint=item->>'fingerprint' for update;
  if alert_id is null then
   insert into public.pulse_alerts(organization_id,fingerprint,rule,title,description,category,priority,origin,score,client_id,contract_id,proposal_id,assigned_to,link,evidence)
   values(org,item->>'fingerprint',item->>'rule',item->>'title',item->>'description',item->>'category',item->>'priority',coalesce(item->>'origin','Mugô Pulse'),coalesce((item->>'score')::int,0),nullif(item->>'clientId','')::uuid,nullif(item->>'contractId','')::uuid,nullif(item->>'proposalId','')::uuid,nullif(item->>'responsibleId','')::uuid,item->>'link',coalesce(item->'evidence','[]')) returning id into alert_id;
   insert into public.pulse_alert_events(organization_id,alert_id,event_type,actor_id) values(org,alert_id,'generated',auth.uid());created_count:=created_count+1;
  else
   update public.pulse_alerts set title=item->>'title',description=item->>'description',category=item->>'category',priority=item->>'priority',score=coalesce((item->>'score')::int,score),evidence=coalesce(item->'evidence',evidence),last_seen_at=now(),occurrences=occurrences+1,updated_at=now(),status=case when status='resolved' then 'open' when status='snoozed' and snoozed_until<=now() then 'open' else status end,resolved_at=case when status='resolved' then null else resolved_at end,resolved_by=case when status='resolved' then null else resolved_by end where id=alert_id;
   if previous_status='resolved' then insert into public.pulse_alert_events(organization_id,alert_id,event_type,actor_id,metadata) values(org,alert_id,'reopened',auth.uid(),jsonb_build_object('reason','rule_detected_again'));reopened_count:=reopened_count+1;end if;updated_count:=updated_count+1;
  end if;
 end loop;
 return jsonb_build_object('created',created_count,'updated',updated_count,'reopened',reopened_count);
end$$;

create or replace function public.act_on_pulse_alert(target_id uuid,action_name text,action_note text default null,assignee_id uuid default null,snooze_until timestamptz default null) returns public.pulse_alerts language plpgsql security definer set search_path='' as $$
declare row_data public.pulse_alerts%rowtype;role_name text:=public.current_user_role();
begin select * into row_data from public.pulse_alerts where id=target_id and organization_id=public.current_organization_id() for update;if row_data.id is null then raise exception 'Alerta não encontrado.';end if;
 if action_name in('resolve','ignore','snooze','assign','create_task','note','reopen') and role_name not in('admin','manager','finance','commercial','operations') then raise exception 'Você não tem permissão para alterar alertas.';end if;
 if action_name='resolve' then update public.pulse_alerts set status='resolved',resolved_at=now(),resolved_by=auth.uid(),resolution_note=action_note,updated_at=now() where id=target_id;
 elsif action_name='ignore' then update public.pulse_alerts set status='ignored',resolved_at=now(),resolved_by=auth.uid(),resolution_note=action_note,updated_at=now() where id=target_id;
 elsif action_name='snooze' then if snooze_until is null or snooze_until<=now() then raise exception 'Informe uma data futura.';end if;update public.pulse_alerts set status='snoozed',snoozed_until=snooze_until,updated_at=now() where id=target_id;
 elsif action_name='assign' then update public.pulse_alerts set assigned_to=assignee_id,updated_at=now() where id=target_id;
 elsif action_name='note' then update public.pulse_alerts set note=action_note,updated_at=now() where id=target_id;
 elsif action_name='reopen' then update public.pulse_alerts set status='open',resolved_at=null,resolved_by=null,resolution_note=null,snoozed_until=null,updated_at=now() where id=target_id;
 elsif action_name='create_task' then insert into public.pulse_tasks(organization_id,alert_id,title,assigned_to,created_by) values(row_data.organization_id,row_data.id,coalesce(nullif(action_note,''),row_data.title),coalesce(assignee_id,row_data.assigned_to),auth.uid());
 else raise exception 'Ação inválida.';end if;
 insert into public.pulse_alert_events(organization_id,alert_id,event_type,note,actor_id,metadata) values(row_data.organization_id,row_data.id,action_name,action_note,auth.uid(),jsonb_build_object('assigneeId',assignee_id,'snoozedUntil',snooze_until));select * into row_data from public.pulse_alerts where id=target_id;return row_data;
end$$;
grant execute on function public.sync_pulse_alerts(jsonb) to authenticated;grant execute on function public.act_on_pulse_alert(uuid,text,text,uuid,timestamptz) to authenticated;
