-- MANUAL ONLY. Apply migration, deploy function and approve template before running this file.
-- Create TASK_REMINDER_WORKER_KEY in Edge secrets and the same value as task_reminder_worker_key
-- in Vault manually. Existing project_url/service_role_key Vault entries are reused, never modified.
begin;
do $scheduler$
declare existing record;
begin
  if (select count(distinct name) from vault.decrypted_secrets where name in ('project_url','service_role_key','task_reminder_worker_key') and length(decrypted_secret)>0)<>3 then
    raise exception 'Required Vault secrets missing; no cron was changed';
  end if;
  for existing in select jobid from cron.job where jobname='crmugo-task-reminder-worker' loop
    perform cron.unschedule(existing.jobid);
  end loop;
  perform cron.schedule('crmugo-task-reminder-worker','*/5 * * * *',$command$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url' limit 1)||'/functions/v1/task-reminder-worker',
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1),
        'X-Task-Reminder-Worker-Key',(select decrypted_secret from vault.decrypted_secrets where name='task_reminder_worker_key' limit 1)),
      body := jsonb_build_object('source','cron')
    );
  $command$);
end $scheduler$;
commit;
select jobname,schedule,active from cron.job where jobname='crmugo-task-reminder-worker';
