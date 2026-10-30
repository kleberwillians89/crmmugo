-- O Asaas exige CPF/CNPJ do cliente. Preenche clients.document_number, quando estiver vazio, com o
-- CPF/CNPJ lido dos contratos e propostas já importados no CRM (document_analyses confirmadas).
-- Só preenche quando os documentos do cliente apontam para UM único número válido; nunca sobrescreve.

begin;

with documentos as (
  select c.id as client_id,
    regexp_replace(coalesce(a.extracted_data->'extractedData'->'client'->'document_number'->>'value', ''), '\D', '', 'g') as numero
  from public.clients c
  join public.documents d on d.organization_id = c.organization_id
    and (d.client_id = c.id
      or d.contract_id in (select k.id from public.contracts k where k.client_id = c.id)
      or d.proposal_id in (select p.id from public.proposals p where p.client_id = c.id))
  join public.document_analyses a on a.confirmed_document_id = d.id
  where c.deleted_at is null
    and nullif(regexp_replace(coalesce(c.document_number, ''), '\D', '', 'g'), '') is null
),
unicos as (
  select client_id, min(numero) as numero
  from documentos
  where length(numero) in (11, 14) and numero !~ '^(\d)\1+$'
  group by client_id
  having count(distinct numero) = 1
)
update public.clients c
set document_number = case when length(u.numero) = 14
    then regexp_replace(u.numero, '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5')
    else regexp_replace(u.numero, '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4') end
from unicos u
where c.id = u.client_id;

commit;

-- Para conferir depois (somente leitura): clientes ativos e o documento que ficou.
-- select trade_name, company_name, document_number from public.clients where status = 'active' order by 1;
