-- Teste local destrutivo somente no banco temporário; nunca executar em produção.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into auth.users(id) values('10000000-0000-0000-0000-000000000001');
insert into public.organizations(id,name) values('20000000-0000-0000-0000-000000000001','Teste');
insert into public.profiles(id,organization_id,role,active) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','admin',true);
insert into public.clients(id,organization_id,company_name,status) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Cliente Principal','active'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Cliente Duplicado','active'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Cliente Rollback','active');
insert into public.contracts(id,organization_id,client_id,status,monthly_value) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','active',100);
insert into public.invoice_installments(id,organization_id,client_id,contract_id,reference_month,installment_number,due_date,amount,received_amount,status,paid_at) values('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','2026-08-01',1,'2026-08-10',100,100,'paid',now());

do $$declare preview jsonb;batch uuid;again uuid;begin
 preview:=public.preview_client_merge('30000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000002']::uuid[]);
 batch:=public.execute_client_merge('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000002']::uuid[],'{}','Consolidação confirmada no teste','Cliente Principal',preview);
 again:=public.execute_client_merge('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000002']::uuid[],'{}','Consolidação confirmada no teste','Cliente Principal',preview);
 if batch<>again then raise exception 'Idempotência falhou';end if;
 if not exists(select 1 from public.contracts where id='40000000-0000-0000-0000-000000000001' and client_id='30000000-0000-0000-0000-000000000001') then raise exception 'Contrato não foi movido';end if;
 if not exists(select 1 from public.invoice_installments where id='50000000-0000-0000-0000-000000000001' and client_id='30000000-0000-0000-0000-000000000001' and status='paid' and received_amount=100) then raise exception 'Parcela paga não foi preservada';end if;
 if not exists(select 1 from public.clients where id='30000000-0000-0000-0000-000000000002' and status='archived' and deleted_at is not null) then raise exception 'Secundário não foi arquivado';end if;
 if not exists(select 1 from public.data_merge_items where batch_id=batch and before_data is not null and after_data is not null) then raise exception 'Snapshot before/after ausente';end if;
 begin
  perform public.execute_client_merge('60000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000003']::uuid[],'{}','Teste de rollback transacional','Nome incorreto',public.preview_client_merge('30000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000003']::uuid[]));
  raise exception 'Falha esperada não ocorreu';
 exception when others then if sqlerrm='Falha esperada não ocorreu' then raise;end if;end;
 if not exists(select 1 from public.clients where id='30000000-0000-0000-0000-000000000003' and status='active' and deleted_at is null) then raise exception 'Rollback não preservou cliente';end if;
end$$;
select 'client_merge_transaction_ok' result;
