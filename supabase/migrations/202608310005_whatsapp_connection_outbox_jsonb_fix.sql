-- Corrige ambiguidade PL/pgSQL entre o parâmetro `value`
-- e a coluna `value` retornada por jsonb_each/jsonb_array_elements.
--
-- Mantém a assinatura existente para permitir CREATE OR REPLACE
-- sem quebrar dependências, constraints ou triggers.

create or replace function public.whatsapp_jsonb_has_secret_key(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item record;
begin
  if $1 is null then
    return false;
  end if;

  if jsonb_typeof($1) = 'object' then
    for item in
      select
        entry.key,
        entry.value as child
      from jsonb_each($1) as entry
    loop
      if lower(item.key) in (
        'token',
        'access_token',
        'app_secret',
        'verify_token',
        'credential_value',
        'authorization',
        'password',
        'service_role',
        'service_role_key',
        'hmac_secret',
        'mugozap_internal_hmac_secret'
      ) then
        return true;
      end if;

      if jsonb_typeof(item.child) in ('object', 'array')
        and public.whatsapp_jsonb_has_secret_key(item.child)
      then
        return true;
      end if;
    end loop;

  elsif jsonb_typeof($1) = 'array' then
    for item in
      select element.value as child
      from jsonb_array_elements($1) as element(value)
    loop
      if jsonb_typeof(item.child) in ('object', 'array')
        and public.whatsapp_jsonb_has_secret_key(item.child)
      then
        return true;
      end if;
    end loop;
  end if;

  return false;
end
$function$;

comment on function public.whatsapp_jsonb_has_secret_key(jsonb) is
  'Recursively detects prohibited secret-bearing keys in JSONB payloads without persisting secret values.';
