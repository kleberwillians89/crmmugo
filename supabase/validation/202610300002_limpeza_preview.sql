-- PRÉVIA (somente leitura) da limpeza de 30/10/2026. Não altera nada.
-- Rode no SQL Editor do Supabase antes da migration 202610300002_limpeza_carteira.sql.
-- "acao" mostra o que a migration fará com cada cadastro.

with org as (select id from public.organizations where slug = 'mugo' limit 1),
alvos(ord, alvo, padroes) as (values
  (1, 'Origami 2500 · dia 5', array['%origami%']),
  (2, 'Ruah (Gabi) 7000 · dia 5', array['%ruah%', '%gimports%', '%gabi%']),
  (3, 'Roove 3200 · dia 30', array['%roove%']),
  (4, 'Rodrigo Mancusi 600 · dia 10', array['%mancusi%']),
  (5, 'CAFIFA / Santo Circuito 2500 · dia 10', array['%cafifa%', '%santo circuito%']),
  (6, 'Curavino 1300 · dia 5', array['%curavino%']),
  (7, 'Latinas 600 · dia 20', array['%latina%'])
),
cadastros as (
  select c.id, c.company_name, c.trade_name, c.status, c.created_at,
    (select count(*) from public.contracts k where k.client_id = c.id and k.status = 'active' and k.deleted_at is null) as contratos_ativos,
    (select string_agg(coalesce(k.monthly_value::text, '—'), ', ') from public.contracts k where k.client_id = c.id and k.status = 'active' and k.deleted_at is null) as mensalidades_atuais,
    (select a.alvo from alvos a where exists (select 1 from unnest(a.padroes) p where c.company_name ilike p or coalesce(c.trade_name, '') ilike p) order by a.ord limit 1) as alvo
  from public.clients c, org
  where c.organization_id = org.id and c.deleted_at is null
),
ranqueados as (
  select *, row_number() over (partition by alvo order by (contratos_ativos > 0) desc, (status = 'active') desc, created_at) as posicao,
    count(*) filter (where contratos_ativos > 0) over (partition by alvo) as cadastros_com_contrato
  from cadastros
)
select coalesce(alvo, '—') as alvo, company_name, trade_name, status, contratos_ativos, mensalidades_atuais,
  case
    when alvo is not null and cadastros_com_contrato > 1 then 'BLOQUEIA: mais de um cadastro com contrato ativo — unifique antes'
    when alvo is not null and posicao > 1 and status = 'active' then 'cadastro repetido: vira INATIVO'
    when alvo is not null and posicao > 1 then 'cadastro repetido: sem alteração'
    when alvo is not null and contratos_ativos > 1 then 'ATENÇÃO: vários contratos ativos (usa o de mensalidade mais recente)'
    when alvo is not null then 'mantém ativo e atualiza'
    when status = 'active' then 'vira INATIVO (contratos encerrados, parcelas futuras sem pagamento canceladas)'
    else 'sem alteração'
  end as acao
from ranqueados
where alvo is not null or status = 'active'
order by alvo nulls last, company_name;
