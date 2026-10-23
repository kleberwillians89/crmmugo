-- Guarda quando a edição foi gerada pela IA (o updated_at muda também ao editar/aprovar).
-- Aplicar pelo SQL Editor; depois: npx supabase migration repair --status applied 202610230004
alter table public.newsletter_editions add column if not exists generated_at timestamptz;
update public.newsletter_editions set generated_at = coalesce(generated_at, updated_at, created_at) where generated_at is null and items <> '[]'::jsonb;
