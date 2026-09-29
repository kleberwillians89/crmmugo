-- Normaliza end_date dos contratos oficiais GIMPORTS e ORIGAMI para cobrir a recorrência já criada
-- (Outubro/2026 a Fevereiro/2027), igual a Latina e Roove. Não cria contrato novo, só corrige a data
-- de um contrato já ativo. NÃO EXECUTADO AUTOMATICAMENTE — revisar e rodar manualmente.
--
-- Achado (auditoria read-only, 2026-09-28):
--   ORIGAMI  contrato 1d50e5d9-847e-4c96-9075-6a295b34b19f end_date=2026-10-30, última parcela pending 2027-02-05
--   GIMPORTS contrato 71dd1456-0dd9-4b69-b77c-030b6269b24c end_date=2026-11-13, última parcela pending 2027-02-10
--
-- Passo 1 — conferir antes de aplicar:
SELECT c.id AS contract_id, cl.trade_name, cl.company_name, c.end_date,
  (SELECT max(due_date) FROM invoice_installments ii WHERE ii.contract_id=c.id AND ii.status='pending') AS last_pending_due
FROM contracts c JOIN clients cl ON cl.id=c.client_id
WHERE c.organization_id='1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f'
  AND c.id IN ('1d50e5d9-847e-4c96-9075-6a295b34b19f','71dd1456-0dd9-4b69-b77c-030b6269b24c');

-- Passo 2 — aplicar (idempotente: rodar de novo não muda nada se já estiver em 2027-02-28):
UPDATE public.contracts
SET end_date='2027-02-28'
WHERE organization_id='1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f'
  AND id IN ('1d50e5d9-847e-4c96-9075-6a295b34b19f','71dd1456-0dd9-4b69-b77c-030b6269b24c')
  AND status='active'
RETURNING id, client_id, end_date;

-- Passo 3 — confirmar: rodar scripts/go-live/2026-10-01-mugo-post-validate.sql (já atualizado nesta
-- tarefa para também exigir minimum_end_date=2027-02-28 em Origami/GIMPORTS, não só Roove) e checar
-- FINAL_GO_LIVE_CHECK = PASS.
