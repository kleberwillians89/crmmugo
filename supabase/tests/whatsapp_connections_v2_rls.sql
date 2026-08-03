-- Run only in an isolated database after applying 202607280001.
-- The transaction is always rolled back and stores no operational identifiers.
begin;

do $$
declare
  org_a uuid := gen_random_uuid();
  org_b uuid := gen_random_uuid();
  user_admin uuid := gen_random_uuid();
  user_viewer uuid := gen_random_uuid();
  connection_a uuid;
begin
  insert into auth.users(id) values(user_admin), (user_viewer);
  insert into public.organizations(id,slug,name)
  values(org_a,'sprint1-a','Sprint 1 A'),(org_b,'sprint1-b','Sprint 1 B');
  insert into public.profiles(id,organization_id,name,role,active)
  values(user_admin,org_a,'Admin fixture','admin',true),
        (user_viewer,org_b,'Viewer fixture','viewer',true);

  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',user_admin::text,true);

  insert into public.whatsapp_connections(organization_id,workspace_id,status,metadata)
  values(org_a,'workspace-fixture-a','draft','{"fixture":true}'::jsonb)
  returning id into connection_a;

  begin
    insert into public.whatsapp_connections(
      organization_id,workspace_id,status,waba_id,phone_number_id
    ) values(org_a,'workspace-fixture-a','active','100001','200001');
    raise exception 'active connection without credential was accepted';
  exception when check_violation then null;
  end;

  insert into public.whatsapp_connections(
    organization_id,workspace_id,status,phone_number_id
  ) values(org_a,'workspace-fixture-a','draft','200002');
  begin
    insert into public.whatsapp_connections(
      organization_id,workspace_id,status,phone_number_id
    ) values(org_a,'workspace-fixture-a','draft','200002');
    raise exception 'duplicate phone_number_id was accepted';
  exception when unique_violation then null;
  end;

  begin
    update public.whatsapp_connections
      set organization_id=org_b
      where id=connection_a;
    raise exception 'organization_id mutation was accepted';
  exception when insufficient_privilege then null;
  end;

  if not exists(
    select 1 from public.whatsapp_connections_public where id=connection_a
  ) then raise exception 'authorized draft creation/read failed'; end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='whatsapp_connections_public'
      and column_name in ('credential_reference','webhook_verify_reference','workspace_id','phone_number_id','waba_id')
  ) then raise exception 'sanitized view exposes protected columns'; end if;

  perform set_config('request.jwt.claim.sub',user_viewer::text,true);
  begin
    insert into public.whatsapp_connections(organization_id,workspace_id,status)
    values(org_b,'workspace-fixture-b','draft');
    raise exception 'viewer creation was accepted';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.whatsapp_connections_public where id=connection_a)
  then raise exception 'cross-tenant read allowed'; end if;

  begin
    update public.whatsapp_connections set status='disabled' where id=connection_a;
    raise exception 'cross-tenant update allowed';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
