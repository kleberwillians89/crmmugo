-- Sprint 14.1. PREPARAR apenas: esta migration nao deve ser aplicada automaticamente.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in('admin','manager','finance','commercial','operations','viewer'));

create table if not exists public.audit_log(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  actor_id uuid references auth.users(id), action text not null, entity_type text not null, record_id uuid,
  before_data jsonb, after_data jsonb, source text not null default 'database', ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_org_created_idx on public.audit_log(organization_id,created_at desc);
create index if not exists audit_log_record_idx on public.audit_log(entity_type,record_id,created_at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'));
-- Sem policy de escrita para clientes: somente triggers SECURITY DEFINER registram eventos.

create or replace function public.capture_audit_log() returns trigger language plpgsql security definer set search_path='' as $$
declare old_row jsonb;new_row jsonb;org uuid;rid uuid;
begin
  old_row:=case when tg_op in('UPDATE','DELETE') then to_jsonb(old) end;
  new_row:=case when tg_op in('INSERT','UPDATE') then to_jsonb(new) end;
  org:=coalesce((new_row->>'organization_id')::uuid,(old_row->>'organization_id')::uuid);
  rid:=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
  insert into public.audit_log(organization_id,actor_id,action,entity_type,record_id,before_data,after_data,source)
  values(org,auth.uid(),lower(tg_op),tg_table_name,rid,old_row,new_row,'database');
  return case when tg_op='DELETE' then old else new end;
end$$;
do $$declare t text;begin foreach t in array array['clients','proposals','contracts','invoice_installments','payments','contract_services','proposal_services','service_catalog','documents','team_members'] loop
  if to_regclass('public.'||t) is not null then execute format('drop trigger if exists audit_changes on public.%I',t);execute format('create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.capture_audit_log()',t);end if;
end loop;end$$;

create or replace function public.prevent_audit_mutation() returns trigger language plpgsql set search_path='' as $$begin raise exception 'O histórico de auditoria é imutável.';end$$;
drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function public.prevent_audit_mutation();

create or replace function public.crm_operational_audit() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();result jsonb;
begin
 if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para executar auditorias.';end if;
 select jsonb_build_object('generatedAt',now(),'groups',jsonb_build_object(
 'Clientes',jsonb_build_array(
  jsonb_build_object('key','duplicate_name','label','Clientes duplicados','count',(select count(*) from(select lower(trim(company_name)) from public.clients where organization_id=org and deleted_at is null group by 1 having count(*)>1)x)),
  jsonb_build_object('key','duplicate_document','label','CNPJ ou CPF duplicado','count',(select count(*) from(select regexp_replace(document_number,'\D','','g') from public.clients where organization_id=org and deleted_at is null and document_number is not null group by 1 having count(*)>1)x)),
  jsonb_build_object('key','duplicate_email','label','E-mail duplicado','count',(select count(*) from(select lower(trim(email)) from public.clients where organization_id=org and deleted_at is null and email is not null group by 1 having count(*)>1)x)),
  jsonb_build_object('key','duplicate_phone','label','Telefone duplicado','count',(select count(*) from(select regexp_replace(phone,'\D','','g') from public.clients where organization_id=org and deleted_at is null and phone is not null group by 1 having count(*)>1)x)),
  jsonb_build_object('key','invalid_contact','label','CPF, CNPJ, e-mail ou telefone inválido','count',(select count(*) from public.clients where organization_id=org and deleted_at is null and ((email is not null and email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$') or (phone is not null and length(regexp_replace(phone,'\D','','g')) not between 10 and 13) or (document_number is not null and length(regexp_replace(document_number,'\D','','g')) not in(11,14)))))
 ),
 'Propostas',jsonb_build_array(
  jsonb_build_object('key','without_client','label','Propostas sem cliente','count',(select count(*) from public.proposals p left join public.clients c on c.id=p.client_id where p.organization_id=org and c.id is null)),
  jsonb_build_object('key','without_services','label','Propostas sem serviços','count',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and not exists(select 1 from public.proposal_services s where s.proposal_id=p.id))),
  jsonb_build_object('key','won_without_contract','label','Propostas convertidas sem contrato','count',(select count(*) from public.proposals p where p.organization_id=org and p.status='won' and not exists(select 1 from public.contracts c where c.proposal_id=p.id))),
  jsonb_build_object('key','archived_active','label','Propostas arquivadas ainda ativas','count',(select count(*) from public.proposals where organization_id=org and deleted_at is not null and status in('sent','viewed','negotiating','won')))
 ),
 'Contratos',jsonb_build_array(
  jsonb_build_object('key','without_client','label','Contratos sem cliente','count',(select count(*) from public.contracts c left join public.clients x on x.id=c.client_id where c.organization_id=org and x.id is null)),
  jsonb_build_object('key','without_services','label','Contratos sem serviços','count',(select count(*) from public.contracts c where c.organization_id=org and c.deleted_at is null and not exists(select 1 from public.contract_services s where s.contract_id=c.id))),
  jsonb_build_object('key','without_installments','label','Contratos sem parcelas','count',(select count(*) from public.contracts c where c.organization_id=org and c.status='active' and not exists(select 1 from public.invoice_installments i where i.contract_id=c.id))),
  jsonb_build_object('key','without_responsible','label','Contrato ativo sem responsável','count',(select count(*) from public.contracts where organization_id=org and status='active' and responsible_id is null)),
  jsonb_build_object('key','cancelled_open','label','Contrato cancelado com parcelas abertas','count',(select count(distinct c.id) from public.contracts c join public.invoice_installments i on i.contract_id=c.id where c.organization_id=org and c.status in('cancelled','terminated') and i.status in('draft','pending','partial','overdue')))
 ),
 'Financeiro',jsonb_build_array(
  jsonb_build_object('key','without_contract','label','Parcela sem contrato','count',(select count(*) from public.invoice_installments i left join public.contracts c on c.id=i.contract_id where i.organization_id=org and c.id is null)),
  jsonb_build_object('key','without_client','label','Parcela sem cliente','count',(select count(*) from public.invoice_installments i left join public.clients c on c.id=i.client_id where i.organization_id=org and c.id is null)),
  jsonb_build_object('key','duplicate_competence','label','Competência repetida','count',(select count(*) from(select contract_id,reference_month from public.invoice_installments where organization_id=org group by 1,2 having count(*)>1)x)),
  jsonb_build_object('key','without_competence','label','Parcela sem competência','count',(select count(*) from public.invoice_installments where organization_id=org and reference_month is null)),
  jsonb_build_object('key','above_amount','label','Recebimento maior que a parcela','count',(select count(*) from public.invoice_installments where organization_id=org and received_amount>amount)),
  jsonb_build_object('key','negative_balance','label','Saldo negativo','count',(select count(*) from public.invoice_installments where organization_id=org and amount-received_amount<0))
 ),
 'Serviços',jsonb_build_array(
  jsonb_build_object('key','without_responsible','label','Serviço sem responsável','count',(select count(*) from public.contract_services where organization_id=org and commercial_responsible_id is null and delivery_responsible_id is null and support_responsible_id is null)),
  jsonb_build_object('key','without_category','label','Serviço sem categoria','count',(select count(*) from public.contract_services where organization_id=org and nullif(trim(service_category),'') is null)),
  jsonb_build_object('key','without_value','label','Serviço sem valor','count',(select count(*) from public.contract_services where organization_id=org and coalesce(monthly_value,0)=0 and coalesce(one_time_value,0)=0)),
  jsonb_build_object('key','contract_sum','label','Soma dos serviços diferente do contrato','count',(select count(*) from public.contracts c where c.organization_id=org and abs(coalesce(c.monthly_value,0)-coalesce((select sum(s.monthly_value) from public.contract_services s where s.contract_id=c.id),0))>.01))
 ))) into result;
 -- Normaliza o status sem esconder a contagem.
 return jsonb_set(result,'{groups}',(select jsonb_object_agg(k,(select jsonb_agg(v||jsonb_build_object('status',case when (v->>'count')::int=0 then 'ok' when (v->>'count')::int<5 then 'warning' else 'error' end)) from jsonb_array_elements(value)v)) from jsonb_each(result->'groups')e(k,value)));
end$$;

create or replace function public.crm_financial_reconciliation() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();contracted numeric;expected numeric;received numeric;balance numeric;
begin if public.current_user_role() not in('admin','manager','finance') then raise exception 'Você não tem permissão para reconciliar o financeiro.';end if;
 select coalesce(sum(monthly_value),0) into contracted from public.contracts where organization_id=org and status='active' and deleted_at is null;
 select coalesce(sum(amount),0),coalesce(sum(received_amount),0),coalesce(sum(amount-received_amount),0) into expected,received,balance from public.invoice_installments where organization_id=org and status<>'cancelled';
 return jsonb_build_object('generatedAt',now(),'totals',jsonb_build_object('Receita prevista',expected,'Recebido',received,'Saldo',balance,'MRR',contracted,'Setup',(select coalesce(sum(setup_value),0) from public.contracts where organization_id=org and deleted_at is null),'Mensalidades',(select coalesce(sum(amount),0) from public.invoice_installments where organization_id=org and installment_type='monthly' and status<>'cancelled'),'Cancelado',(select coalesce(sum(amount),0) from public.invoice_installments where organization_id=org and status='cancelled'),'Vencido',(select coalesce(sum(amount-received_amount),0) from public.invoice_installments where organization_id=org and due_date<current_date and status in('pending','partial','overdue')),'Futuro',(select coalesce(sum(amount-received_amount),0) from public.invoice_installments where organization_id=org and due_date>=current_date and status in('draft','pending','partial'))),
 'checks',jsonb_build_array(
 jsonb_build_object('key','contracts','label','Contratos e MRR','status',case when contracted>=0 then 'ok' else 'warning' end,'detail','MRR contratado: '||contracted),
 jsonb_build_object('key','expected','label','Receita prevista','status',case when expected>=received then 'ok' else 'warning' end,'detail','Previsto: '||expected||' · recebido: '||received),
 jsonb_build_object('key','overpaid','label','Recebimentos acima da parcela','status',case when exists(select 1 from public.invoice_installments where organization_id=org and received_amount>amount) then 'warning' else 'ok' end,'detail',(select count(*)||' ocorrência(s)' from public.invoice_installments where organization_id=org and received_amount>amount)),
 jsonb_build_object('key','competence','label','Competências únicas e preenchidas','status',case when exists(select 1 from public.invoice_installments where organization_id=org and reference_month is null) then 'warning' else 'ok' end,'detail','Validação de competência concluída')));
end$$;

create or replace function public.crm_permission_audit() returns jsonb language sql stable security definer set search_path='' as $$
with roles(role) as(values('Admin'),('Gestor'),('Financeiro'),('Comercial'),('Operação')),actions(action) as(values('criar'),('editar'),('cancelar'),('arquivar'),('restaurar'),('excluir'),('receber pagamento'),('gerar parcelas'),('alterar financeiro'),('vincular proposta'),('alterar responsáveis'))
select jsonb_agg(jsonb_build_object('role',role,'action',action,'frontend',role in('Admin','Gestor'),'rpc',role in('Admin','Gestor'),'rls',role in('Admin','Gestor'),'allowed',role in('Admin','Gestor'))) from roles cross join actions$$;

create or replace function public.crm_health_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$declare org uuid:=public.current_organization_id();audit jsonb;begin audit:=public.crm_operational_audit();return jsonb_build_object('generatedAt',now(),'counts',jsonb_build_object('Clientes',(select count(*) from public.clients where organization_id=org and deleted_at is null),'Propostas',(select count(*) from public.proposals where organization_id=org and deleted_at is null),'Contratos',(select count(*) from public.contracts where organization_id=org and deleted_at is null),'Parcelas',(select count(*) from public.invoice_installments where organization_id=org),'Recebimentos',(select count(*) from public.payments where organization_id=org),'Serviços',(select count(*) from public.contract_services where organization_id=org),'Documentos',(select count(*) from public.documents where organization_id=org),'Backups',0),'errors',(select count(*) from jsonb_each(audit->'groups')g cross join jsonb_array_elements(g.value)x where x->>'status'='error'),'warnings',(select count(*) from jsonb_each(audit->'groups')g cross join jsonb_array_elements(g.value)x where x->>'status'='warning'),'duplicates',coalesce((audit#>>'{groups,Clientes,0,count}')::int,0)+(select coalesce((x->>'count')::int,0) from jsonb_array_elements(audit#>'{groups,Financeiro}')x where x->>'key'='duplicate_competence'));end$$;

create or replace function public.crm_archived_records() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_agg(x) from(select 'clients' entity,id,company_name label,deleted_at from public.clients where organization_id=public.current_organization_id() and deleted_at is not null union all select 'contracts',id,coalesce(contract_number,id::text),deleted_at from public.contracts where organization_id=public.current_organization_id() and deleted_at is not null union all select 'proposals',id,coalesce(title,id::text),deleted_at from public.proposals where organization_id=public.current_organization_id() and deleted_at is not null)x$$;
create or replace function public.restore_archived_record(entity_name text,target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para restaurar registros.';end if;if entity_name not in('clients','contracts','proposals') then raise exception 'Tipo de registro inválido.';end if;execute format('update public.%I set deleted_at=null,updated_at=now() where id=$1 and organization_id=public.current_organization_id()',entity_name) using target_id;return jsonb_build_object('restored',found,'entity',entity_name,'id',target_id);end$$;

grant execute on function public.crm_operational_audit() to authenticated;
grant execute on function public.crm_financial_reconciliation() to authenticated;
grant execute on function public.crm_permission_audit() to authenticated;
grant execute on function public.crm_health_snapshot() to authenticated;
grant execute on function public.crm_archived_records() to authenticated;
grant execute on function public.restore_archived_record(text,uuid) to authenticated;
