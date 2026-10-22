-- Ativação do cron do resumo diário da equipe (team-daily-brief-worker) — NÃO EXECUTADO
-- AUTOMATICAMENTE. Revisar e rodar manualmente (npx supabase db query --linked --file ...).
--
-- Pré-requisitos antes de rodar isto:
--   1. Function team-daily-brief-worker já deployada.
--   2. Secrets configurados na function: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_ACCESS_TOKEN,
--      TEAM_DAILY_BRIEF_WORKER_KEY (novo, escolha um valor forte e configure via
--      `npx supabase secrets set TEAM_DAILY_BRIEF_WORKER_KEY=...`), e opcionalmente TEAM_DAILY_BRIEF_HOUR
--      (default 8, horário local America/Sao_Paulo).
--   3. Template mugo_resumo_diario_equipe com status APPROVED em whatsapp_message_templates (o worker
--      nunca envia texto livre — sem template aprovado ele só loga TEMPLATE_NOT_APPROVED e não marca
--      nada como enviado).
--   4. Substituir <SUPABASE_PROJECT_URL> e <TEAM_DAILY_BRIEF_WORKER_KEY> abaixo pelos valores reais
--      antes de executar (Project Settings > API para a URL; o mesmo valor do passo 2 para a key).
--
-- O agendamento do pg_cron abaixo roda no horário do servidor Postgres (Supabase usa UTC). A regra de
-- negócio real (dia útil + hora configurada, tudo em America/Sao_Paulo) mora DENTRO do worker
-- (shouldRunDailyBrief em supabase/functions/_shared/teamDailyBriefCore.js) — por isso a janela do cron
-- abaixo é intencionalmente generosa (a cada 15 min, das 11h às 14h59 UTC = 8h às 11h59 em
-- America/Sao_Paulo, seg-sex) e nunca precisa ser exata: a idempotência diária por membro
-- (team-daily-brief:{team_member_id}:{YYYY-MM-DD}) garante que ninguém recebe o resumo duas vezes,
-- mesmo com o cron disparando várias vezes na mesma janela.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'team-daily-brief-worker';

select cron.schedule(
  'team-daily-brief-worker',
  '*/15 11-14 * * 1-5',
  $$
  select net.http_post(
    url := '<SUPABASE_PROJECT_URL>/functions/v1/team-daily-brief-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Team-Daily-Brief-Worker-Key', '<TEAM_DAILY_BRIEF_WORKER_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Conferência pós-ativação:
-- select * from cron.job where jobname = 'team-daily-brief-worker';
-- select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'team-daily-brief-worker') order by start_time desc limit 10;
