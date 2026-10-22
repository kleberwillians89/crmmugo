-- Crons do CRM enxuto (2026-10-22). NÃO É EXECUTADO AUTOMATICAMENTE — rode no SQL Editor do Supabase
-- depois de: aplicar a migration 202610220001, publicar as funções e cadastrar os secrets (ver docs/GO_LIVE_2026-10-22.md).
--
-- Pré-requisito no Vault (Database → Vault), além dos que já existem (project_url, service_role_key):
--   commercial_ai_worker_key  = mesmo valor do secret COMMERCIAL_AI_WORKER_KEY das Edge Functions
--   prospecting_worker_key    = mesmo valor do secret PROSPECTING_WORKER_KEY
--   email_worker_key          = mesmo valor do secret EMAIL_WORKER_KEY

-- Passo 1 — conferir se já existe cron do atendimento comercial com outro nome (não duplicar):
SELECT jobid, jobname, schedule, active FROM cron.job WHERE command ILIKE '%commercial-ai-worker%';
-- Se aparecer um job ativo, pule o bloco "commercial-ai-worker" do Passo 2.

-- Passo 2 — criar/recriar de forma idempotente.
do $scheduler$
declare job record;
begin
  for job in select jobid from cron.job where jobname in('crmugo-commercial-ai-worker','crmugo-prospecting-worker','crmugo-email-campaigns-worker') loop
    perform cron.unschedule(job.jobid);
  end loop;

  -- Atendimento: respostas atrasadas (agrupamento de mensagens) + retomada de leads parados. A cada minuto.
  perform cron.schedule('crmugo-commercial-ai-worker','* * * * *',$command$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url' limit 1) || '/functions/v1/commercial-ai-worker',
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1),
        'X-Commercial-AI-Worker-Key',(select decrypted_secret from vault.decrypted_secrets where name='commercial_ai_worker_key' limit 1)),
      body := jsonb_build_object('source','cron'),
      timeout_milliseconds := 120000
    );
  $command$);

  -- Prospecção: pesquisa da fila, leitura de respostas e envio espaçado de e-mails. A cada 5 minutos.
  perform cron.schedule('crmugo-prospecting-worker','*/5 * * * *',$command$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url' limit 1) || '/functions/v1/prospecting',
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1),
        'X-Prospecting-Worker-Key',(select decrypted_secret from vault.decrypted_secrets where name='prospecting_worker_key' limit 1)),
      body := jsonb_build_object('action','cron'),
      timeout_milliseconds := 150000
    );
  $command$);

  -- E-mail marketing: campanhas agendadas e lotes em envio. A cada minuto.
  perform cron.schedule('crmugo-email-campaigns-worker','* * * * *',$command$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url' limit 1) || '/functions/v1/email-campaigns',
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1),
        'X-Email-Worker-Key',(select decrypted_secret from vault.decrypted_secrets where name='email_worker_key' limit 1)),
      body := jsonb_build_object('source','cron'),
      timeout_milliseconds := 120000
    );
  $command$);
end
$scheduler$;

-- Passo 3 — conferir:
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'crmugo-%' ORDER BY jobname;
-- Para desligar um deles: select cron.unschedule('crmugo-prospecting-worker');
