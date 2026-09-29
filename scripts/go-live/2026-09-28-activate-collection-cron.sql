-- Reativa o cron de cobrança automática (crmugo-collection-notification-worker), hoje inexistente na
-- instância (confirmado por auditoria read-only: zero linhas em cron.job com nome %collection%,
-- apesar de a migration 202609250008 já ter criado esse job com sucesso na época — provavelmente
-- removido depois, deliberadamente, como precaução até este go-live). NÃO EXECUTADO AUTOMATICAMENTE.
--
-- Pré-requisitos já confirmados nesta tarefa (não repetir sem necessidade):
--   - collection-notification-worker deployado (v4) com idempotência, checagem de template aprovado,
--     nunca marca "sent" sem provider_message_id real, e agora registra rastro (NO_PHONE) quando o
--     cliente não tem telefone válido.
--   - organization_settings.collection_dispatch_enabled=true, collection_dispatch_time='08:15:00' já
--     configurados para a organização 1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f.
--   - Secrets no Vault (nomes conferidos, sem expor valor): project_url, service_role_key,
--     collection_worker_key — todos existentes e com os nomes exatos que este cron espera.
--
-- ANTES de rodar o Passo 2, repetir a auditoria de elegíveis-agora (Passo 1) e só prosseguir se o
-- resultado continuar 0 linhas inesperadas (era 0 em 2026-09-28) — instrução explícita do go-live.

-- Passo 1 — auditoria read-only: quem seria elegível para cobrança HOJE, se o cron rodasse agora
-- (mesma janela de data que o worker usa: due_date <= hoje em America/Sao_Paulo).
SELECT ii.id, cl.trade_name, cl.company_name, ii.due_date, ii.amount, ii.currency, ii.status
FROM invoice_installments ii
JOIN clients cl ON cl.id = ii.client_id
WHERE ii.organization_id='1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f'
  AND ii.status IN ('pending','overdue')
  AND ii.received_amount=0
  AND ii.paid_at IS NULL
  AND ii.due_date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date;
-- Era 0 linhas em 2026-09-28. Só prossiga para o Passo 2 se continuar 0 (ou só linhas já esperadas
-- e revisadas manualmente).

-- Passo 2 — (re)criar o cron de forma idempotente (mesmo padrão já usado pela migration 202609250008:
-- desagenda se já existir com qualquer um dos nomes legados, agenda de novo, e VERIFICA que ficou
-- exatamente 1 job ativo com o schedule certo antes de considerar concluído).
do $scheduler$
declare existing_job record; active_jobs integer;
begin
  for existing_job in select jobid from cron.job
    where jobname in('collection-notification-worker-every-minute','crmugo-collection-notification-worker')
  loop perform cron.unschedule(existing_job.jobid); end loop;

  perform cron.schedule('crmugo-collection-notification-worker','* * * * *',$command$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url' limit 1) || '/functions/v1/collection-notification-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1),
        'X-Collection-Worker-Key',(select decrypted_secret from vault.decrypted_secrets where name='collection_worker_key' limit 1)
      ),
      body := jsonb_build_object('source','cron')
    );
  $command$);

  select count(*) into active_jobs from cron.job
  where jobname in('collection-notification-worker-every-minute','crmugo-collection-notification-worker');
  if active_jobs<>1 or not exists(select 1 from cron.job where jobname='crmugo-collection-notification-worker' and schedule='* * * * *' and active) then
    raise exception 'Expected exactly one active collection notification cron';
  end if;
end
$scheduler$;

-- Passo 3 — confirmar depois de rodar:
SELECT jobname, schedule, active FROM cron.job WHERE jobname ILIKE '%collection%';
