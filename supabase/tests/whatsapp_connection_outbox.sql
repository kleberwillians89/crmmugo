-- Execute only in an isolated CRM staging transaction after both CRM migrations.
begin;

do $$
declare
  org_id uuid;
  connection_id uuid := gen_random_uuid();
  first_event public.whatsapp_connection_outbox%rowtype;
begin
  select id into org_id from public.organizations limit 1;
  if org_id is null then
    raise exception 'fixture requires one existing organization';
  end if;

  insert into public.whatsapp_connections(
    id, organization_id, workspace_id, provider, status
  ) values(
    connection_id, org_id, 'sprint-1-2-fixture', 'meta_cloud_api', 'draft'
  );

  select * into first_event
  from public.whatsapp_connection_outbox
  where aggregate_id = connection_id and event_type = 'connection.created';
  if not found then raise exception 'transactional outbox event missing'; end if;
  if public.whatsapp_jsonb_has_secret_key(first_event.payload) then
    raise exception 'outbox payload contains secret field';
  end if;

  update public.whatsapp_connections
  set status = 'disabled'
  where id = connection_id;
  if not exists(
    select 1 from public.whatsapp_connection_outbox
    where aggregate_id = connection_id
      and event_type = 'connection.disabled'
      and source_version = first_event.source_version + 1
  ) then raise exception 'disabled/version event missing'; end if;

  update public.whatsapp_connections set updated_at = now() where id = connection_id;
  if (select count(*) from public.whatsapp_connection_outbox where aggregate_id = connection_id) <> 2 then
    raise exception 'audit-only update emitted event';
  end if;

  begin
    insert into public.whatsapp_connection_outbox(
      event_id,event_type,aggregate_id,organization_id,payload,source_version,occurred_at
    ) values(
      first_event.event_id,'connection.updated',connection_id,org_id,'{}',99,now()
    );
    raise exception 'duplicate event_id accepted';
  exception when unique_violation then null;
  end;

  if has_table_privilege('authenticated','public.whatsapp_connection_outbox','select') then
    raise exception 'frontend role can read technical outbox';
  end if;
end
$$;

rollback;
