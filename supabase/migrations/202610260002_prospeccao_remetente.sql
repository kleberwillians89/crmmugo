-- Prospecção feita pelo Kleber: quem assina e os perfis da Mugô que a IA pode citar nas mensagens.
-- Aplicar pelo SQL Editor; depois: npx supabase migration repair --status applied 202610260002
alter table public.outreach_settings add column if not exists sender_role text;
alter table public.outreach_settings add column if not exists sender_linkedin_url text;
alter table public.outreach_settings add column if not exists mugo_instagram_url text;
alter table public.outreach_settings add column if not exists mugo_linkedin_url text;
alter table public.outreach_settings add column if not exists mugo_site_url text default 'https://mugoagencia.com.br';
alter table public.outreach_settings add column if not exists proof_points text;
