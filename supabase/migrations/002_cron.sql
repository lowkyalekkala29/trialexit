-- Runs the reminder function every 15 minutes.
-- Replace <PROJECT_REF> and <CRON_SECRET> (any long random string; set the same
-- value as the CRON_SECRET function secret) before running.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'trialexit-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
