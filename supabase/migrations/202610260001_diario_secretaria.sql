-- Diário da Secretária na tela Hoje: o que ela enviou e recebeu no WhatsApp nas últimas 24h.
-- Só leitura, só da organização de quem está logado. Aplicar pelo SQL Editor;
-- depois: npx supabase migration repair --status applied 202610260001

create or replace function public.secretary_feed(p_limit integer default 12)
returns table(at timestamptz, source text, kind text, member_name text, title text, detail text)
language sql stable security definer set search_path = '' as $$
  with org as (select public.current_organization_id() as id)
  select * from (
    select coalesce(o.processed_at, o.created_at) as at, 'notification'::text as source,
           coalesce(nullif(o.payload->>'kind', ''), o.notification_type) as kind,
           m.name as member_name,
           left(coalesce(o.payload->>'title', o.payload->>'lead_name', ''), 140) as title,
           null::text as detail
    from public.team_notification_outbox o
    join public.team_members m on m.id = o.team_member_id
    where o.organization_id = (select id from org)
      and o.status = 'completed' and o.last_error is null
      and coalesce(o.processed_at, o.created_at) > now() - interval '24 hours'
    union all
    select coalesce(e.processed_at, e.created_at), 'command', 'command', m.name,
           left(e.raw_text, 140), left(e.result->>'reply', 200)
    from public.task_command_events e
    join public.team_members m on m.id = e.team_member_id
    where e.organization_id = (select id from org)
      and e.status = 'completed'
      and coalesce(e.processed_at, e.created_at) > now() - interval '24 hours'
  ) feed
  where (select id from org) is not null
  order by at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 50)
$$;
revoke all on function public.secretary_feed(integer) from public, anon;
grant execute on function public.secretary_feed(integer) to authenticated;
