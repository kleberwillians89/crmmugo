-- Sprint 1.3: incremental hardening for an already-applied outbox migration.

create or replace function public.whatsapp_jsonb_has_secret_key(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
begin
  if value is null then return false; end if;
  if jsonb_typeof(value) = 'object' then
    for item in select key, value as child from jsonb_each(value)
    loop
      if lower(item.key) in (
        'token','access_token','app_secret','verify_token','credential_value',
        'authorization','password','service_role','service_role_key','hmac_secret',
        'mugozap_internal_hmac_secret'
      ) then return true; end if;
      if jsonb_typeof(item.child) in ('object','array')
        and public.whatsapp_jsonb_has_secret_key(item.child)
      then return true; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for item in select child from jsonb_array_elements(value) as child
    loop
      if jsonb_typeof(item.child) in ('object','array')
        and public.whatsapp_jsonb_has_secret_key(item.child)
      then return true; end if;
    end loop;
  end if;
  return false;
end
$$;

revoke all on function public.whatsapp_jsonb_has_secret_key(jsonb)
  from public, anon, authenticated;
grant execute on function public.whatsapp_jsonb_has_secret_key(jsonb)
  to service_role;

comment on function public.whatsapp_jsonb_has_secret_key(jsonb) is
  'Rejects secret-shaped keys recursively; never validates or stores credential values.';
