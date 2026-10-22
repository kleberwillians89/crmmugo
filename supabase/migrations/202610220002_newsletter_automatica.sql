-- Newsletter semanal automática: notícias do setor (RSS) → curadoria por IA → rascunho → aprovação → envio pelo Resend.
-- As notícias também alimentam a prospecção (ganchos atuais por segmento). Idempotente.

create table if not exists public.newsletter_settings(
  organization_id uuid primary key default public.current_organization_id() references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  auto_send boolean not null default false,            -- false = alguém aprova antes de sair
  generate_weekday integer not null default 1 check(generate_weekday between 0 and 6),  -- 1 = segunda
  generate_time time not null default '07:00',
  send_weekday integer not null default 2 check(send_weekday between 0 and 6),          -- 2 = terça
  send_time time not null default '09:00',
  items_count integer not null default 5 check(items_count between 3 and 8),
  focus text,                                          -- público e temas prioritários
  template_html text,                                  -- HTML do Kleber com {{intro}}, {{itens}}, {{nome}}, {{descadastro}}
  item_template_html text,                             -- opcional: HTML de cada notícia com {{titulo}}, {{resumo}}, {{impacto}}, {{link}}, {{fonte}}
  from_name text default 'Mugô',
  from_email text,
  reply_to text,
  audience jsonb not null default '{"tags":[],"sources":[]}'::jsonb,
  linkedin_cover_html text,                            -- capa do carrossel: {{titulo_edicao}}, {{data}}, {{intro}}
  linkedin_slide_html text,                            -- slide por notícia: {{numero}}, {{titulo}}, {{resumo}}, {{impacto}}, {{fonte}}
  linkedin_hashtags text default '#marketingdigital #trafegopago #ecommerce',
  updated_at timestamptz not null default now()
);

create table if not exists public.newsletter_sources(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  name text not null,
  url text not null,
  category text not null default 'marketing' check(category in('marketing','ads','seo','social','ecommerce','investimentos','criadores','ia','negocios')),
  language text not null default 'en' check(language in('pt','en','es')),
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(organization_id,url)
);

create table if not exists public.industry_news(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid references public.newsletter_sources(id) on delete set null,
  url text not null,
  title text not null,
  excerpt text,
  source_name text,
  category text,
  published_at timestamptz,
  summary_pt text,                 -- preenchido quando a IA seleciona a notícia
  impact_pt text,                  -- "o que isso muda para sua marca"
  segments text[] not null default '{}',
  edition_id uuid,
  created_at timestamptz not null default now(),
  unique(organization_id,url)
);
create index if not exists industry_news_recent_idx on public.industry_news(organization_id,published_at desc);

create table if not exists public.newsletter_editions(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft' check(status in('draft','approved','sent','skipped','failed')),
  subject text,
  preheader text,
  intro text,
  items jsonb not null default '[]'::jsonb,
  linkedin_post text,
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  error_message text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,week_start)
);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='industry_news_edition_fk') then
    alter table public.industry_news add constraint industry_news_edition_fk foreign key(edition_id) references public.newsletter_editions(id) on delete set null;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['newsletter_settings','newsletter_sources','industry_news','newsletter_editions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('create policy %I on public.%I for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user())',t||'_read',t);
  end loop;
  foreach t in array array['newsletter_settings','newsletter_sources','newsletter_editions'] loop
    execute format('grant insert,update,delete on public.%I to authenticated',t);
    execute format('drop policy if exists %I on public.%I',t||'_write',t);
    execute format('create policy %I on public.%I for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write())',t||'_write',t);
  end loop;
  foreach t in array array['newsletter_settings','newsletter_editions'] loop
    execute format('drop trigger if exists set_updated_at on public.%I',t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
  end loop;
end $$;

-- Fontes iniciais (podem ser editadas na tela). Só cria se a organização ainda não tem nenhuma.
insert into public.newsletter_sources(organization_id,name,url,category,language)
select o.id, s.name, s.url, s.category, s.language
from public.organizations o
cross join (values
  ('Google Ads & Commerce','https://blog.google/products/ads-commerce/rss/','ads','en'),
  ('Google Search Central','https://developers.google.com/search/blog/feed.xml','seo','en'),
  ('Search Engine Land','https://searchengineland.com/feed','seo','en'),
  ('Social Media Today','https://www.socialmediatoday.com/feeds/news/','social','en'),
  ('Meta Newsroom','https://about.fb.com/news/feed/','social','en'),
  ('Meio & Mensagem','https://www.meioemensagem.com.br/feed','marketing','pt'),
  ('E-commerce Brasil','https://www.ecommercebrasil.com.br/feed','ecommerce','pt'),
  ('InfoMoney','https://www.infomoney.com.br/feed/','investimentos','pt')
) as s(name,url,category,language)
where o.active is not false
  and not exists(select 1 from public.newsletter_sources x where x.organization_id=o.id)
on conflict (organization_id,url) do nothing;

comment on table public.industry_news is 'Notícias do setor coletadas por RSS. Só título, trecho e link da fonte; o texto da newsletter é resumo próprio.';
