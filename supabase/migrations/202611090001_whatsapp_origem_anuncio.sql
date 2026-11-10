-- Origem de cada conversa do WhatsApp, com o ID do anúncio (Click-to-WhatsApp) e o clique (ctwa_clid).
--
-- 1) Número de uma MARCA cliente (Ruah, Roove...): a conexão pode pertencer a um cliente. O número da
--    própria Mugô fica com client_id nulo. É isso que o MUGOVERSO usa para mostrar a caixa de entrada
--    da marca (as conversas dos clientes DELA), separada das conversas da Mugô com a marca.
-- 2) whatsapp_contact_touches: um registro por mensagem que chega COM origem (referral de anúncio ou
--    código de entrada de link/QR). O contato continua guardando só a primeira origem (como antes);
--    aqui ficam todos os toques, com os identificadores estáveis que antes eram descartados.

alter table public.whatsapp_connections
  add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists whatsapp_connections_client_idx
  on public.whatsapp_connections(organization_id, client_id) where client_id is not null;

create or replace function public.protect_whatsapp_connection_client()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  if new.client_id is null then return new; end if;
  select organization_id into v_org from public.clients where id = new.client_id;
  if v_org is distinct from new.organization_id then
    raise exception 'WhatsApp connection client mismatch' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists protect_whatsapp_connection_client on public.whatsapp_connections;
create trigger protect_whatsapp_connection_client before insert or update of client_id, organization_id
  on public.whatsapp_connections for each row execute function public.protect_whatsapp_connection_client();

create table if not exists public.whatsapp_contact_touches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  provider_message_id text not null,
  source text not null,
  referral_source_type text,
  ad_id text,
  ctwa_clid text,
  source_url text,
  headline text,
  body text,
  media_type text,
  entry_code text,
  utm jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint whatsapp_contact_touches_ad_id_digits check (ad_id is null or ad_id ~ '^[0-9]{1,30}$'),
  constraint whatsapp_contact_touches_entry_code check (entry_code is null or entry_code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  constraint whatsapp_contact_touches_utm_object check (jsonb_typeof(utm) = 'object'),
  unique (connection_id, provider_message_id)
);
create index if not exists whatsapp_contact_touches_contact_idx
  on public.whatsapp_contact_touches(organization_id, contact_id, occurred_at desc);
create index if not exists whatsapp_contact_touches_connection_idx
  on public.whatsapp_contact_touches(connection_id, occurred_at desc);
create index if not exists whatsapp_contacts_connection_first_seen_idx
  on public.whatsapp_contacts(connection_id, first_seen_at desc);

-- O contato precisa ser da mesma organização e conexão do toque.
create or replace function public.protect_whatsapp_touch_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid; v_connection uuid;
begin
  select organization_id, connection_id into v_org, v_connection from public.whatsapp_contacts where id = new.contact_id;
  if v_org is distinct from new.organization_id or v_connection is distinct from new.connection_id then
    raise exception 'WhatsApp tenant mismatch' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists protect_whatsapp_touch_tenant on public.whatsapp_contact_touches;
create trigger protect_whatsapp_touch_tenant before insert or update on public.whatsapp_contact_touches
  for each row execute function public.protect_whatsapp_touch_tenant();

alter table public.whatsapp_contact_touches enable row level security;
alter table public.whatsapp_contact_touches force row level security;
drop policy if exists whatsapp_contact_touches_read on public.whatsapp_contact_touches;
create policy whatsapp_contact_touches_read on public.whatsapp_contact_touches for select to authenticated using (
  organization_id = public.current_organization_id()
  and public.current_user_role() in ('admin', 'manager', 'commercial', 'finance')
);
-- Escrita só pelo webhook (service role). Nenhuma policy de insert/update/delete para usuários.

-- Para ligar o número de uma marca ao cliente dela (rodar uma vez por número, no SQL Editor):
--   update public.whatsapp_connections set client_id = '<id do cliente Ruah no CRM>'
--   where phone_number_id = '<phone_number_id do número da Ruah>';
