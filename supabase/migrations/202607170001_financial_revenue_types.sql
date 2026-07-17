-- PREPARAR apenas: não aplicar automaticamente.
-- Amplia a classificação estruturada necessária ao formulário financeiro sem alterar registros existentes.
alter table public.invoice_installments drop constraint if exists invoice_installments_type_check;
alter table public.invoice_installments add constraint invoice_installments_type_check check(installment_type in('setup','monthly','project','other'));
