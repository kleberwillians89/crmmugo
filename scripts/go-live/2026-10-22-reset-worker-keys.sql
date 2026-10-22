-- Realinha as chaves dos robôs (cron → Edge Function). Rode TUDO de uma vez no SQL Editor.
-- 1) gera chaves novas no Vault; 2) recria os 8 crons lendo do Vault; 3) devolve UMA linha com o comando
--    `npx supabase secrets set ...` para rodar no terminal. NÃO cole esse resultado em chat nenhum.
-- Entre rodar este SQL e o comando no terminal os robôs ficam ~1 min recusando (401) — nada se perde,
-- as filas são processadas assim que as chaves batem.

create temp table if not exists _worker_keys(env_name text primary key, value text) on commit preserve rows;
truncate _worker_keys;

do $reset$
declare
  k record; v text; existing uuid; job record;
begin
  if (select count(*) from vault.decrypted_secrets where name in ('project_url','service_role_key') and length(decrypted_secret)>0)<>2 then
    raise exception 'Faltam project_url/service_role_key no Vault; nada foi alterado';
  end if;

  for k in select * from (values
    ('task_command_worker_key','TASK_COMMAND_WORKER_KEY'),
    ('commercial_ai_worker_key','COMMERCIAL_AI_WORKER_KEY'),
    ('collection_worker_key','COLLECTION_WORKER_KEY'),
    ('email_worker_key','EMAIL_WORKER_KEY'),
    ('prospecting_worker_key','PROSPECTING_WORKER_KEY'),
    ('task_reminder_worker_key','TASK_REMINDER_WORKER_KEY'),
    ('team_notification_worker_key','TEAM_NOTIFICATION_WORKER_KEY')
  ) as t(vault_name, env_name) loop
    v := encode(extensions.gen_random_bytes(32),'hex');
    select id into existing from vault.secrets where name=k.vault_name limit 1;
    if existing is null then perform vault.create_secret(v, k.vault_name, 'chave do cron '||k.env_name);
    else perform vault.update_secret(existing, v); end if;
    insert into _worker_keys values (k.env_name, v);
  end loop;

  for job in select jobid from cron.job where jobname in (
    'task-command-worker-every-minute','commercial-ai-worker-every-minute','crmugo-commercial-ai-worker',
    'crmugo-collection-notification-worker','crmugo-email-campaigns-worker','crmugo-newsletter-worker',
    'crmugo-prospecting-worker','crmugo-task-reminder-worker','crmugo-team-notification-worker') loop
    perform cron.unschedule(job.jobid);
  end loop;

  for k in select * from (values
    ('task-command-worker-every-minute','* * * * *','task-command-worker','X-Task-Command-Worker-Key','task_command_worker_key','{"source":"cron"}'),
    ('commercial-ai-worker-every-minute','* * * * *','commercial-ai-worker','X-Commercial-AI-Worker-Key','commercial_ai_worker_key','{"source":"cron"}'),
    ('crmugo-collection-notification-worker','* * * * *','collection-notification-worker','X-Collection-Worker-Key','collection_worker_key','{"source":"cron"}'),
    ('crmugo-email-campaigns-worker','* * * * *','email-campaigns','X-Email-Worker-Key','email_worker_key','{"source":"cron"}'),
    ('crmugo-newsletter-worker','*/15 * * * *','newsletter','X-Email-Worker-Key','email_worker_key','{"source":"cron"}'),
    ('crmugo-prospecting-worker','*/5 * * * *','prospecting','X-Prospecting-Worker-Key','prospecting_worker_key','{"action":"cron"}'),
    ('crmugo-task-reminder-worker','*/5 * * * *','task-reminder-worker','X-Task-Reminder-Worker-Key','task_reminder_worker_key','{"source":"cron"}'),
    ('crmugo-team-notification-worker','* * * * *','team-notification-worker','X-Team-Notification-Worker-Key','team_notification_worker_key','{"source":"cron"}')
  ) as t(job_name, schedule, fn, header, vault_name, body) loop
    perform cron.schedule(k.job_name, k.schedule, format($cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='project_url' limit 1) || '/functions/v1/%s',
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1),
          %L,(select decrypted_secret from vault.decrypted_secrets where name=%L limit 1)),
        body := %L::jsonb,
        timeout_milliseconds := 150000
      );
    $cmd$, k.fn, k.header, k.vault_name, k.body));
  end loop;
end
$reset$;

select 'npx supabase secrets set ' || string_agg(env_name || '=' || value, ' ' order by env_name) as rode_no_terminal
from _worker_keys;
