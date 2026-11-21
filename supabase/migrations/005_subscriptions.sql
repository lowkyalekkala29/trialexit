-- Trials and paid subscriptions live in one table.
alter table public.trials
  add column if not exists kind text not null default 'trial' check (kind in ('trial', 'subscription')),
  add column if not exists cycle text check (cycle in ('weekly', 'monthly', 'quarterly', 'yearly'));
create index if not exists trials_live_subscriptions on public.trials (kind) where deleted_at is null and kind = 'subscription';
