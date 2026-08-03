select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into auth.users(id) values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000003');
insert into public.organizations values('20000000-0000-0000-0000-000000000001','Mugô'),('20000000-0000-0000-0000-000000000002','Outra');
insert into public.profiles values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','admin',true),('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','manager',true),('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','viewer',true);
insert into public.clients values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Cliente teste','active',null),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Outra organização','active',null);
insert into public.contracts(id,organization_id,client_id,status,signed,start_date,billing_day,setup_value,monthly_value,auto_renew) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','active',true,current_date-interval '1 year',15,4000,2300,false),('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','active',true,current_date,10,0,1000,false);
insert into public.invoice_installments(id,organization_id,client_id,contract_id,reference_month,installment_number,due_date,amount,received_amount,status,idempotency_key,paid_at,installment_type) values
('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',date_trunc('month',current_date)-interval '1 month',1,current_date-interval '1 month',2300,2300,'paid','paid-history',current_date-interval '1 month','monthly'),
('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',date_trunc('month',current_date),2,current_date+interval '2 days',2300,0,'pending','future-monthly',null,'monthly'),
('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',date_trunc('month',current_date),1,current_date,4000,0,'overdue','contract:setup',null,'setup'),
('50000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',date_trunc('month',current_date)+interval '1 month',3,current_date+interval '1 month',2300,0,'overdue','future-overdue',null,'monthly');

do $$declare first jsonb;again jsonb;before_bad jsonb;created jsonb;ended jsonb;begin
 first:=public.apply_contract_future_change('40000000-0000-0000-0000-000000000001',date_trunc('month',current_date)::date,3200,20,'Mudança prospectiva confirmada','future-1');
 again:=public.apply_contract_future_change('40000000-0000-0000-0000-000000000001',date_trunc('month',current_date)::date,3200,20,'Mudança prospectiva confirmada','future-1');
 if first->>'contractId'<>again->>'contractId' or again->>'idempotentReplay'<>'true' then raise exception 'Idempotência falhou';end if;
 if not exists(select 1 from public.contracts where id='40000000-0000-0000-0000-000000000001' and monthly_value=3200 and billing_day=20 and setup_value=4000) then raise exception 'Contrato incorreto';end if;
 if not exists(select 1 from public.invoice_installments where id='50000000-0000-0000-0000-000000000001' and amount=2300 and received_amount=2300 and status='paid') then raise exception 'Parcela paga alterada';end if;
 if not exists(select 1 from public.invoice_installments where id='50000000-0000-0000-0000-000000000003' and amount=4000 and installment_type='setup') then raise exception 'Setup alterado';end if;
 if not exists(select 1 from public.invoice_installments where id='50000000-0000-0000-0000-000000000002' and amount=3200 and extract(day from due_date)=20) then raise exception 'Futuro não alterado';end if;
 begin perform public.apply_contract_future_change('40000000-0000-0000-0000-000000000001',date_trunc('month',current_date)::date,9999,40,'Deve causar rollback total','bad-request');exception when others then null;end;
 if exists(select 1 from public.contracts where id='40000000-0000-0000-0000-000000000001' and monthly_value=9999) then raise exception 'Rollback falhou';end if;
 begin perform public.apply_contract_future_change('40000000-0000-0000-0000-000000000002',date_trunc('month',current_date)::date,2000,10,'Tentativa organização cruzada','cross-org');raise exception 'Organização cruzada permitida';exception when others then if sqlerrm='Organização cruzada permitida' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
 begin perform public.mark_contract_ended('40000000-0000-0000-0000-000000000001',current_date,'Viewer não pode encerrar','viewer-request');raise exception 'Viewer autorizado';exception when others then if sqlerrm='Viewer autorizado' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 created:=public.create_prospective_contract('30000000-0000-0000-0000-000000000001',current_date+10,1500,7,'Consultoria financeira','Novo contrato prospectivo validado','create-1');
 if (created->>'createdCount')::int<>1 or exists(select 1 from public.invoice_installments where contract_id=(created#>>'{contractAfter,id}')::uuid and due_date<current_date) then raise exception 'Contrato prospectivo inválido';end if;
 if public.create_prospective_contract('30000000-0000-0000-0000-000000000001',current_date+10,1500,7,'Consultoria financeira','Novo contrato prospectivo validado','create-1')->>'idempotentReplay'<>'true' then raise exception 'Idempotência de criação falhou';end if;
 ended:=public.mark_contract_ended('40000000-0000-0000-0000-000000000001',current_date,'Encerramento histórico confirmado','end-1');
 if ended#>>'{contractAfter,status}'<>'terminated' or (ended->>'installmentsChanged')::int<>0 then raise exception 'Encerramento inválido';end if;
 if public.mark_contract_ended('40000000-0000-0000-0000-000000000001',current_date,'Encerramento histórico confirmado','end-1')->>'idempotentReplay'<>'true' then raise exception 'Idempotência de encerramento falhou';end if;
 if (public.validate_real_data_correction('future-1')->>'paidInstallmentsPreserved')::boolean is not true then raise exception 'Validação falhou';end if;
end$$;
select 'real_data_correction_rpcs_ok' result;
