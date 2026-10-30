-- Liga a régua de cobrança automática (9h/12h/18h no vencimento, 9h nos dias seguintes).
-- Rode no SQL Editor DEPOIS das migrations 202610300001..05 e do deploy das functions
-- collection-cadence-worker, asaas-billing e asaas-webhook.
-- Usa a mesma chave do robô de cobrança antigo (collection_worker_key), que já está no Vault.

do $cadencia$
declare job record;
begin
  if (select count(*) from vault.decrypted_secrets where name in ('project_url','service_role_key','collection_worker_key') and length(decrypted_secret)>0)<>3 then
    raise exception 'Faltam project_url/service_role_key/collection_worker_key no Vault; nada foi alterado';
  end if;

  -- O disparo único antigo sai do cron (a migration 04 já o desliga nas configurações).
  for job in select jobid from cron.job where jobname in ('crmugo-collection-notification-worker','crmugo-collection-cadence-worker') loop
    perform cron.unschedule(job.jobid);
  end loop;

  perform cron.schedule('crmugo-collection-cadence-worker', '* * * * *', $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url' limit 1) || '/functions/v1/collection-cadence-worker',
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1),
        'X-Collection-Worker-Key',(select decrypted_secret from vault.decrypted_secrets where name='collection_worker_key' limit 1)),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$);
end
$cadencia$;

-- Token do webhook do Asaas: copie o valor gerado abaixo para DOIS lugares
-- 1) terminal:  npx supabase secrets set ASAAS_WEBHOOK_TOKEN=<valor>
-- 2) Asaas > Integrações > Webhooks > "Token de autenticação" (mesmo valor). Não cole em chat.
select encode(extensions.gen_random_bytes(32), 'hex') as asaas_webhook_token;
