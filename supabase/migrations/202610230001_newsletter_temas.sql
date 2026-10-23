-- Newsletter com temas escolhidos pelo time (negócios + cultura/lifestyle da Mugô).
-- Aplicar pelo SQL Editor; depois: supabase migration repair --status applied 202610230001

alter table public.newsletter_sources drop constraint if exists newsletter_sources_category_check;
alter table public.newsletter_sources add constraint newsletter_sources_category_check
  check (category in ('marketing','ads','seo','social','ecommerce','investimentos','criadores','ia','negocios',
                      'cultura','musica','shows','exposicoes','teatro','gastronomia','lifestyle'));

-- Temas padrão da edição automática (vazio = todos). O time pode trocar a cada semana na tela.
alter table public.newsletter_settings add column if not exists themes text[] not null default '{}';
-- Temas usados em cada edição (para saber o que foi escolhido naquela semana).
alter table public.newsletter_editions add column if not exists themes text[] not null default '{}';

-- Fontes de cultura, agenda e gastronomia de São Paulo. Se alguma falhar, aparece com erro na aba Fontes.
insert into public.newsletter_sources(organization_id,name,url,category,language)
select o.id, s.name, s.url, s.category, s.language
from public.organizations o
cross join (values
  ('Veja São Paulo','https://vejasp.abril.com.br/feed/','lifestyle','pt'),
  ('Folha Ilustrada','https://feeds.folha.uol.com.br/ilustrada/rss091.xml','cultura','pt'),
  ('Folha Comida','https://feeds.folha.uol.com.br/comida/rss091.xml','gastronomia','pt'),
  ('Rolling Stone Brasil','https://rollingstone.com.br/feed/','musica','pt'),
  ('Tenho Mais Discos Que Amigos','https://www.tenhomaisdiscosqueamigos.com/feed/','musica','pt'),
  ('arte!brasileiros','https://artebrasileiros.com.br/feed/','exposicoes','pt'),
  ('Arteref','https://arteref.com/feed/','exposicoes','pt'),
  ('Revista Bravo','https://bravonline.com.br/feed/','cultura','pt')
) as s(name,url,category,language)
where o.active is not false
on conflict (organization_id,url) do nothing;
