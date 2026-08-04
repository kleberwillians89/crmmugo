\ir bootstrap_real_data_correction_local.sql

alter table public.clients
  add column contact_name text,
  add column document_number text,
  add column email text,
  add column phone text,
  add column notes text,
  add column updated_at timestamptz default now();

insert into public.organizations(id,name)
values
('1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','Mugô'),
('20000000-0000-0000-0000-000000000002','Outra organização');

insert into public.clients(id,organization_id,company_name,status,contact_name,email,phone) values
('61974c0b-e344-4d60-9b12-1a1680c9c270','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','ORIGAMI CONSULTORIA DE INVESTIMENTOS LTDA.','active',null,null,null),
('cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','Origami Investimentos','active',null,null,'5511999990001'),
('5e1646d2-6163-4164-9772-2acf31731eac','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','AMALIE CONFECÇÕES LTDA','active',null,null,null),
('c68ebe35-e064-4fa1-9160-98725063c920','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','Amalie','active',null,null,null),
('e7919cd3-c989-49c9-994f-eb31aa9ce294','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','ROOVE COMÉRCIO DE VESTUÁRIO E ACESSÓRIOS LTDA','active',null,null,null),
('078a840a-5363-4a33-b6fe-646c1a5b851c','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','ROOVE / ROOVER','active',null,null,'5511993161161'),
('de129d57-976f-42b6-a0a2-bafe7d16df13','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','GIMPORTS SPLITS','active',null,null,null),
('744dd494-5eed-4429-b432-9c8f407be37c','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','Gabriela Maria Ribeiro Luna','lead','Gabriela Maria Ribeiro Luna','gabi@example.com','5511988880000'),
('35b06647-a6e2-4c8d-803a-f394ea890d4f','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','Curavino','active',null,null,null),
('6a25e024-0781-4cf1-a225-cd739bf34ef4','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','CAFIFA/SANTO CIRCUITO','lead',null,null,null),
('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Cliente externo','active',null,null,null);

insert into public.contracts(id,organization_id,client_id,status,start_date,billing_day,setup_value,monthly_value) values
('1d50e5d9-847e-4c96-9075-6a295b34b19f','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611','active','2026-01-01',7,0,1500),
('31978937-d01e-4aa6-925a-04e1901aafe7','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','c68ebe35-e064-4fa1-9160-98725063c920','active','2026-01-01',10,0,4000),
('3b56bcde-99b5-4244-9a5d-e0535339a59f','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','078a840a-5363-4a33-b6fe-646c1a5b851c','active','2026-01-01',10,0,2300),
('71dd1456-0dd9-4b69-b77c-030b6269b24c','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','de129d57-976f-42b6-a0a2-bafe7d16df13','active','2026-01-01',10,4000,3500),
('7585f922-a937-4d2e-8a85-9846f3a93334','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','35b06647-a6e2-4c8d-803a-f394ea890d4f','active','2026-01-01',15,1000,1000),
('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','active','2026-01-01',10,0,1000);

insert into public.proposals(id,organization_id,client_id) values
('90000000-0000-0000-0000-000000000001','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611');

insert into public.invoice_installments(id,organization_id,client_id,contract_id,reference_month,installment_number,due_date,amount,received_amount,status,idempotency_key,paid_at,installment_type,payment_method) values
('91000000-0000-0000-0000-000000000001','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','c68ebe35-e064-4fa1-9160-98725063c920','31978937-d01e-4aa6-925a-04e1901aafe7','2026-07-01',1,'2026-07-10',4000,4000,'paid','amalie-paid','2026-07-10','monthly','pix'),
('91000000-0000-0000-0000-000000000002','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','c68ebe35-e064-4fa1-9160-98725063c920','31978937-d01e-4aa6-925a-04e1901aafe7','2026-08-01',2,'2026-08-10',4000,0,'pending','amalie-future',null,'monthly',null),
('91000000-0000-0000-0000-000000000003','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','078a840a-5363-4a33-b6fe-646c1a5b851c','3b56bcde-99b5-4244-9a5d-e0535339a59f','2026-07-01',1,'2026-07-10',2300,2300,'paid','roove-paid','2026-07-10','monthly','pix'),
('91000000-0000-0000-0000-000000000004','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','078a840a-5363-4a33-b6fe-646c1a5b851c','3b56bcde-99b5-4244-9a5d-e0535339a59f','2026-08-01',2,'2026-08-10',2300,0,'pending','roove-future',null,'monthly',null),
('91000000-0000-0000-0000-000000000005','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','de129d57-976f-42b6-a0a2-bafe7d16df13','71dd1456-0dd9-4b69-b77c-030b6269b24c','2026-07-01',1,'2026-07-10',4000,4000,'paid','gabi:setup','2026-07-10','setup','pix'),
('91000000-0000-0000-0000-000000000006','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','de129d57-976f-42b6-a0a2-bafe7d16df13','71dd1456-0dd9-4b69-b77c-030b6269b24c','2026-07-01',2,'2026-07-10',3500,3500,'paid','gabi-paid','2026-07-10','monthly','pix'),
('91000000-0000-0000-0000-000000000007','1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f','de129d57-976f-42b6-a0a2-bafe7d16df13','71dd1456-0dd9-4b69-b77c-030b6269b24c','2026-08-01',3,'2026-08-10',3500,0,'pending','gabi-future',null,'monthly',null);
