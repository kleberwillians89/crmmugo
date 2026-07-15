-- Sprint 15. PREPARAR apenas: não aplicar automaticamente.
-- Esta migration ainda não foi aplicada e por isso consolida a revisão de segurança e ciclo de vida no arquivo original.
create table if not exists public.pulse_alerts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),fingerprint text not null,rule text not null,
 title text not null,description text not null,category text not null check(category in('Financeiro','Comercial','Operação','Clientes','Equipe','Serviços','Contratos','Intelligence','Sistema')),
 priority text not null check(priority in('critical','high','medium','low','informational')),origin text not null default 'Mugô Pulse',alert_type text not null default 'automatic' check(alert_type in('automatic','manual')),
 status text not null default 'open' check(status in('open','snoozed','resolved','ignored')),score integer not null default 0 check(score between 0 and 100),
 client_id uuid references public.clients(id),contract_id uuid references public.contracts(id),proposal_id uuid references public.proposals(id),assigned_to uuid references public.team_members(id),
 link text,evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array'),note text,detected_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),occurrences integer not null default 1,
 last_detection_run_id uuid,condition_cleared_at timestamptz,auto_resolved_at timestamptz,recurrence_count integer not null default 0,
 snoozed_until timestamptz,resolved_at timestamptz,resolved_by uuid references public.profiles(id),resolution_note text,
 resolution_source text check(resolution_source is null or resolution_source in('manual','condition_cleared','ignored')),archived_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,fingerprint)
);
create table if not exists public.pulse_alert_events(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),alert_id uuid not null references public.pulse_alerts(id) on delete restrict,
 event_type text not null,note text,actor_id uuid references public.profiles(id),metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create table if not exists public.pulse_tasks(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),alert_id uuid not null references public.pulse_alerts(id) on delete restrict,
 title text not null,status text not null default 'open' check(status in('open','completed','cancelled')),assigned_to uuid references public.team_members(id),created_by uuid references public.profiles(id),
 idempotency_key text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,unique(organization_id,idempotency_key)
);
create table if not exists public.pulse_detection_runs(
 id uuid primary key,organization_id uuid not null references public.organizations(id),execution_scope text not null check(execution_scope in('full')),
 origin text not null check(origin='Mugô Pulse'),executed_by uuid references public.profiles(id),started_at timestamptz not null default now(),completed_at timestamptz,result jsonb
);

create index if not exists pulse_alerts_active_idx on public.pulse_alerts(organization_id,status,priority,last_seen_at desc) where archived_at is null;
create index if not exists pulse_alerts_fingerprint_active_idx on public.pulse_alerts(organization_id,fingerprint) where archived_at is null;
create index if not exists pulse_alerts_detection_run_idx on public.pulse_alerts(organization_id,last_detection_run_id);
create index if not exists pulse_alerts_open_category_idx on public.pulse_alerts(organization_id,category,priority) where status='open' and archived_at is null;
create index if not exists pulse_alerts_snoozed_idx on public.pulse_alerts(organization_id,snoozed_until) where status='snoozed';
create index if not exists pulse_alerts_assigned_idx on public.pulse_alerts(organization_id,assigned_to) where assigned_to is not null and archived_at is null;
create index if not exists pulse_alert_events_alert_idx on public.pulse_alert_events(alert_id,created_at desc);
create index if not exists pulse_tasks_alert_idx on public.pulse_tasks(organization_id,alert_id,status);
create index if not exists pulse_detection_runs_org_idx on public.pulse_detection_runs(organization_id,started_at desc);

alter table public.pulse_alerts enable row level security;
alter table public.pulse_alert_events enable row level security;
alter table public.pulse_tasks enable row level security;
alter table public.pulse_detection_runs enable row level security;
drop policy if exists pulse_alerts_read on public.pulse_alerts;
drop policy if exists pulse_alerts_write on public.pulse_alerts;
create policy pulse_alerts_read on public.pulse_alerts for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists pulse_events_read on public.pulse_alert_events;
drop policy if exists pulse_events_write on public.pulse_alert_events;
create policy pulse_events_read on public.pulse_alert_events for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists pulse_tasks_read on public.pulse_tasks;
drop policy if exists pulse_tasks_write on public.pulse_tasks;
create policy pulse_tasks_read on public.pulse_tasks for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists pulse_runs_read on public.pulse_detection_runs;
drop policy if exists pulse_runs_write on public.pulse_detection_runs;
create policy pulse_runs_read on public.pulse_detection_runs for select to authenticated using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'));
revoke insert,update,delete,truncate on public.pulse_alerts,public.pulse_alert_events,public.pulse_tasks,public.pulse_detection_runs from anon,authenticated;

create or replace function public.sync_pulse_alerts(detected_alerts jsonb,execution_id uuid,execution_scope text default 'full') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 org uuid:=public.current_organization_id();run_org uuid;role_name text:=public.current_user_role();item jsonb;alert_id uuid;previous_status text;cleared_at timestamptz;
 client_value uuid;contract_value uuid;proposal_value uuid;assignee_value uuid;requested_assignee uuid;evidence_value jsonb;result_value jsonb;
 created_count int:=0;updated_count int:=0;reopened_count int:=0;cleared_count int:=0;snooze_reopened_count int:=0;
begin
 if org is null or not public.is_active_user() then raise exception 'Usuário inativo.';end if;
 if role_name not in('admin','manager') then raise exception 'Você não tem permissão para sincronizar alertas.';end if;
 if execution_id is null then raise exception 'execution_id é obrigatório.';end if;
 if execution_scope<>'full' then raise exception 'Escopo de sincronização inválido. Esta versão aceita apenas full.';end if;
 if detected_alerts is null or jsonb_typeof(detected_alerts)<>'array' then raise exception 'detected_alerts deve ser um array.';end if;
 if jsonb_array_length(detected_alerts)>500 then raise exception 'Uma execução aceita no máximo 500 alertas.';end if;
 if pg_column_size(detected_alerts)>2097152 then raise exception 'Payload de alertas excede 2 MB.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(execution_id::text,0));
 select organization_id,result into run_org,result_value from public.pulse_detection_runs where id=execution_id;
 if found then
  if run_org<>org then raise exception 'execution_id já pertence a outra organização.';end if;
  if result_value is not null then return result_value;end if;
 else insert into public.pulse_detection_runs(id,organization_id,execution_scope,origin,executed_by) values(execution_id,org,execution_scope,'Mugô Pulse',auth.uid());end if;

 for item in select value from jsonb_array_elements(detected_alerts) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Cada alerta deve ser um objeto.';end if;
  if nullif(trim(item->>'fingerprint'),'') is null or length(item->>'fingerprint')>200 then raise exception 'fingerprint obrigatório com até 200 caracteres.';end if;
  if nullif(trim(item->>'rule'),'') is null or length(item->>'rule')>100 then raise exception 'rule obrigatória com até 100 caracteres.';end if;
  if nullif(trim(item->>'title'),'') is null or length(item->>'title')>200 then raise exception 'title obrigatório com até 200 caracteres.';end if;
  if nullif(trim(item->>'description'),'') is null or length(item->>'description')>2000 then raise exception 'description obrigatória com até 2.000 caracteres.';end if;
  if item->>'category' not in('Financeiro','Comercial','Operação','Clientes','Equipe','Serviços','Contratos','Intelligence','Sistema') then raise exception 'category inválida.';end if;
  if item->>'priority' not in('critical','high','medium','low','informational') then raise exception 'priority inválida.';end if;
  if coalesce(item->>'origin','Mugô Pulse')<>'Mugô Pulse' then raise exception 'origin inválida.';end if;
  if coalesce(item->>'link','dashboard') not in('dashboard','finance','contracts','proposals','clients','team','intelligence','performance','alerts') then raise exception 'link interno inválido.';end if;
  if coalesce(item->>'score','0')!~'^\d{1,3}$' or (item->>'score')::int not between 0 and 100 then raise exception 'score deve estar entre 0 e 100.';end if;
  evidence_value:=coalesce(item->'evidence','[]'::jsonb);
  if jsonb_typeof(evidence_value)<>'array' or pg_column_size(evidence_value)>32768 then raise exception 'evidence deve ser um array de até 32 KB.';end if;
  begin client_value:=nullif(item->>'clientId','')::uuid;exception when invalid_text_representation then raise exception 'clientId inválido.';end;
  begin contract_value:=nullif(item->>'contractId','')::uuid;exception when invalid_text_representation then raise exception 'contractId inválido.';end;
  begin proposal_value:=nullif(item->>'proposalId','')::uuid;exception when invalid_text_representation then raise exception 'proposalId inválido.';end;
  begin requested_assignee:=nullif(coalesce(item->>'assignedTeamMemberId',item->>'responsibleId'),'')::uuid;exception when invalid_text_representation then requested_assignee:=null;evidence_value:=evidence_value||jsonb_build_array(jsonb_build_object('type','invalid_assignee','reason','invalid_uuid'));end;
  if client_value is not null and not exists(select 1 from public.clients where id=client_value and organization_id=org) then raise exception 'clientId não pertence à organização.';end if;
  if contract_value is not null and not exists(select 1 from public.contracts where id=contract_value and organization_id=org) then raise exception 'contractId não pertence à organização.';end if;
  if proposal_value is not null and not exists(select 1 from public.proposals where id=proposal_value and organization_id=org) then raise exception 'proposalId não pertence à organização.';end if;
  select id into assignee_value from public.team_members where id=requested_assignee and organization_id=org and active;
  if requested_assignee is not null and assignee_value is null then evidence_value:=evidence_value||jsonb_build_array(jsonb_build_object('type','invalid_assignee','requestedId',requested_assignee,'reason','not_active_team_member_in_organization'));end if;
  alert_id:=null;previous_status:=null;cleared_at:=null;
  select id,status,condition_cleared_at into alert_id,previous_status,cleared_at from public.pulse_alerts where organization_id=org and fingerprint=item->>'fingerprint' for update;
  if alert_id is null then
   insert into public.pulse_alerts(organization_id,fingerprint,rule,title,description,category,priority,origin,score,client_id,contract_id,proposal_id,assigned_to,link,evidence,last_detection_run_id)
   values(org,item->>'fingerprint',item->>'rule',item->>'title',item->>'description',item->>'category',item->>'priority','Mugô Pulse',coalesce((item->>'score')::int,0),client_value,contract_value,proposal_value,assignee_value,coalesce(item->>'link','dashboard'),evidence_value,execution_id) returning id into alert_id;
   insert into public.pulse_alert_events(organization_id,alert_id,event_type,actor_id,metadata) values(org,alert_id,'generated',auth.uid(),jsonb_build_object('executionId',execution_id));created_count:=created_count+1;
  else
   update public.pulse_alerts set title=item->>'title',description=item->>'description',category=item->>'category',priority=item->>'priority',score=coalesce((item->>'score')::int,0),
    client_id=client_value,contract_id=contract_value,proposal_id=proposal_value,assigned_to=assignee_value,link=coalesce(item->>'link','dashboard'),evidence=evidence_value,
    last_seen_at=now(),last_detection_run_id=execution_id,occurrences=occurrences+1,updated_at=now(),
    status=case when archived_at is not null or status='ignored' then status when condition_cleared_at is not null then 'open' when status='snoozed' and snoozed_until<=now() then 'open' else status end,
    recurrence_count=case when archived_at is null and status<>'ignored' and condition_cleared_at is not null then recurrence_count+1 else recurrence_count end,
    condition_cleared_at=case when archived_at is null and status<>'ignored' and condition_cleared_at is not null then null else condition_cleared_at end,
    auto_resolved_at=case when archived_at is null and status<>'ignored' and condition_cleared_at is not null then null else auto_resolved_at end,
    resolved_at=case when archived_at is null and status<>'ignored' and condition_cleared_at is not null then null else resolved_at end,
    resolved_by=case when archived_at is null and status<>'ignored' and condition_cleared_at is not null then null else resolved_by end,
    resolution_note=case when archived_at is null and status<>'ignored' and condition_cleared_at is not null then null else resolution_note end,
    resolution_source=case when archived_at is null and status<>'ignored' and condition_cleared_at is not null then null else resolution_source end,
    snoozed_until=case when archived_at is null and status<>'ignored' and (condition_cleared_at is not null or status='snoozed' and snoozed_until<=now()) then null else snoozed_until end
   where id=alert_id;
   if cleared_at is not null and previous_status<>'ignored' then insert into public.pulse_alert_events(organization_id,alert_id,event_type,actor_id,metadata) values(org,alert_id,'recurred',auth.uid(),jsonb_build_object('executionId',execution_id));reopened_count:=reopened_count+1;
   elsif previous_status='snoozed' and exists(select 1 from public.pulse_alerts where id=alert_id and status='open') then insert into public.pulse_alert_events(organization_id,alert_id,event_type,actor_id,metadata) values(org,alert_id,'snooze_expired',auth.uid(),jsonb_build_object('executionId',execution_id));snooze_reopened_count:=snooze_reopened_count+1;end if;
   updated_count:=updated_count+1;
  end if;
 end loop;

 for alert_id,previous_status in
  select id,status from public.pulse_alerts where organization_id=org and origin='Mugô Pulse' and alert_type='automatic' and archived_at is null and status<>'ignored' and last_detection_run_id is distinct from execution_id and condition_cleared_at is null for update
 loop
  update public.pulse_alerts set condition_cleared_at=now(),auto_resolved_at=now(),status=case when status in('open','snoozed') then 'resolved' else status end,
   resolved_at=coalesce(resolved_at,now()),resolution_source=case when status in('open','snoozed') then 'condition_cleared' else resolution_source end,snoozed_until=null,updated_at=now() where id=alert_id;
  insert into public.pulse_alert_events(organization_id,alert_id,event_type,actor_id,metadata) values(org,alert_id,'condition_cleared',auth.uid(),jsonb_build_object('executionId',execution_id,'previousStatus',previous_status));cleared_count:=cleared_count+1;
 end loop;
 result_value:=jsonb_build_object('executionId',execution_id,'scope',execution_scope,'created',created_count,'updated',updated_count,'reopened',reopened_count,'conditionCleared',cleared_count,'snoozeReopened',snooze_reopened_count);
 update public.pulse_detection_runs set completed_at=now(),result=result_value where id=execution_id and organization_id=org;
 return result_value;
end$$;

create or replace function public.act_on_pulse_alert(target_id uuid,action_name text,action_note text default null,assignee_id uuid default null,snooze_until timestamptz default null,idempotency_key text default null) returns public.pulse_alerts language plpgsql security definer set search_path='' as $$
declare row_data public.pulse_alerts%rowtype;role_name text:=public.current_user_role();allowed boolean:=false;task_key text;
begin
 if not public.is_active_user() then raise exception 'Usuário inativo.';end if;
 select * into row_data from public.pulse_alerts where id=target_id and organization_id=public.current_organization_id() and archived_at is null for update;
 if row_data.id is null then raise exception 'Alerta não encontrado.';end if;
 if action_name not in('resolve','ignore','snooze','assign','create_task','note','reopen') then raise exception 'Ação inválida.';end if;
 allowed:=role_name in('admin','manager') or role_name='finance' and row_data.category='Financeiro' or role_name='commercial' and row_data.category in('Comercial','Clientes','Contratos') or role_name='operations' and row_data.category in('Operação','Equipe','Serviços','Sistema');
 if not allowed then raise exception 'Você não tem permissão para alterar este alerta.';end if;
 if action_note is not null and length(action_note)>2000 then raise exception 'A observação deve ter até 2.000 caracteres.';end if;
 if assignee_id is not null and not exists(select 1 from public.team_members where id=assignee_id and organization_id=row_data.organization_id and active) then raise exception 'Responsável inválido para esta organização.';end if;
 if action_name='resolve' then update public.pulse_alerts set status='resolved',resolved_at=now(),resolved_by=auth.uid(),resolution_note=action_note,resolution_source='manual',updated_at=now() where id=target_id;
 elsif action_name='ignore' then update public.pulse_alerts set status='ignored',resolved_at=now(),resolved_by=auth.uid(),resolution_note=action_note,resolution_source='ignored',snoozed_until=null,updated_at=now() where id=target_id;
 elsif action_name='snooze' then
  if snooze_until is null or snooze_until<=now() then raise exception 'Informe uma data futura.';end if;
  if snooze_until>now()+interval '90 days' then raise exception 'O adiamento máximo é de 90 dias.';end if;
  update public.pulse_alerts set status='snoozed',snoozed_until=snooze_until,updated_at=now() where id=target_id;
 elsif action_name='assign' then update public.pulse_alerts set assigned_to=assignee_id,updated_at=now() where id=target_id;
 elsif action_name='note' then update public.pulse_alerts set note=action_note,updated_at=now() where id=target_id;
 elsif action_name='reopen' then update public.pulse_alerts set status='open',resolved_at=null,resolved_by=null,resolution_note=null,resolution_source=null,condition_cleared_at=null,auto_resolved_at=null,snoozed_until=null,updated_at=now() where id=target_id;
 elsif action_name='create_task' then
  task_key:=coalesce(nullif(trim(idempotency_key),''),target_id::text||':'||auth.uid()::text||':'||md5(coalesce(action_note,row_data.title)));
  if length(task_key)>200 then raise exception 'idempotency_key deve ter até 200 caracteres.';end if;
  insert into public.pulse_tasks(organization_id,alert_id,title,assigned_to,created_by,idempotency_key) values(row_data.organization_id,row_data.id,coalesce(nullif(action_note,''),row_data.title),coalesce(assignee_id,row_data.assigned_to),auth.uid(),task_key) on conflict(organization_id,idempotency_key) do nothing;
 end if;
 insert into public.pulse_alert_events(organization_id,alert_id,event_type,note,actor_id,metadata) values(row_data.organization_id,row_data.id,action_name,action_note,auth.uid(),jsonb_build_object('assigneeId',assignee_id,'snoozedUntil',snooze_until,'idempotencyKey',idempotency_key));
 select * into row_data from public.pulse_alerts where id=target_id;return row_data;
end$$;

revoke all on function public.sync_pulse_alerts(jsonb,uuid,text) from public,anon;
revoke all on function public.act_on_pulse_alert(uuid,text,text,uuid,timestamptz,text) from public,anon;
grant execute on function public.sync_pulse_alerts(jsonb,uuid,text) to authenticated;
grant execute on function public.act_on_pulse_alert(uuid,text,text,uuid,timestamptz,text) to authenticated;
