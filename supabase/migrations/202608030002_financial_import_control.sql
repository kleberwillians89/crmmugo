-- Fase 3: chave estável para importação financeira controlada.
-- Migration aditiva; não insere, atualiza ou remove registros existentes.
alter table public.expenses add column if not exists import_key text;
alter table public.expenses add constraint expenses_import_key_format_check
 check(import_key is null or import_key ~ '^[a-z0-9][a-z0-9._:-]{2,119}$') not valid;
alter table public.expenses validate constraint expenses_import_key_format_check;
create unique index if not exists expenses_org_import_key_idx
 on public.expenses(organization_id,import_key) where import_key is not null;

comment on column public.expenses.import_key is 'Chave estável por organização para impedir importações repetidas.';
