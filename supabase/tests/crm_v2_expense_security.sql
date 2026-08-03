-- Teste estrutural somente leitura para execução via psql/Supabase SQL Editor após a migration.
-- Não usa service role, não cria registros e falha se as garantias de RLS forem removidas.
do $$
declare table_name text; read_count integer; insert_count integer; update_count integer; delete_count integer;
begin
 foreach table_name in array array['expense_categories','cost_centers','financial_accounts','expenses','expense_installments'] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=table_name and c.relrowsecurity) then raise exception 'RLS ausente em %',table_name; end if;
  select count(*) filter(where cmd='SELECT'),count(*) filter(where cmd='INSERT'),count(*) filter(where cmd='UPDATE'),count(*) filter(where cmd in('DELETE','ALL'))
  into read_count,insert_count,update_count,delete_count from pg_policies where schemaname='public' and tablename=table_name;
  if read_count<>1 or insert_count<>1 or update_count<>1 or delete_count<>0 then raise exception 'Policies inesperadas em %: select %, insert %, update %, delete/all %',table_name,read_count,insert_count,update_count,delete_count; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and (coalesce(qual,'')||coalesce(with_check,'')) not like '%current_organization_id%') then raise exception 'Policy sem isolamento em %',table_name; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and cmd in('INSERT','UPDATE') and coalesce(with_check,'') not like '%can_write%') then raise exception 'Escrita sem can_write em %',table_name; end if;
 end loop;
 if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.generate_expense_installments(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC pode executar generate_expense_installments'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='generate_expense_installments' and p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%') then raise exception 'Função geradora sem SECURITY DEFINER/search_path fixo'; end if;
end$$;

select 'crm_v2_expense_security_ok' result;
