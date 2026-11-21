-- TrialExit schema. Run once in the Supabase SQL editor (or `supabase db push`).
-- Every table is protected by row-level security: a user can only ever see
-- and change their own rows. The edge functions use the service role.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  region text not null default 'IN' check (region in ('IN', 'US')),
  timezone text not null default 'Asia/Kolkata',
  onboarded boolean not null default false,
  reminder_email boolean not null default true,
  reminder_skip text[] not null default '{}',
  plan text not null default 'launch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trials (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  service_id text not null,
  region text not null,
  service_name text not null check (char_length(service_name) between 1 and 120),
  renews_at timestamptz not null,
  timezone text not null,
  amount integer not null default 0 check (amount >= 0),
  currency text not null check (currency in ('INR', 'USD')),
  trial_length_days integer not null default 7,
  status text not null check (status in ('active', 'awaiting_confirmation', 'confirmed_cancelled', 'charged', 'kept', 'dismissed')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_url_used text,
  card_label text,
  source text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists trials_user on public.trials (user_id);
create index if not exists trials_due on public.trials (renews_at) where deleted_at is null and status in ('active', 'awaiting_confirmation');

create table if not exists public.reminder_log (
  trial_id uuid not null references public.trials (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (trial_id, kind)
);
create index if not exists reminder_log_trial on public.reminder_log (trial_id);

alter table public.profiles enable row level security;
alter table public.trials enable row level security;
alter table public.reminder_log enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own trials" on public.trials for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- reminder_log: no client policy → only the service role (edge functions) can touch it.

-- New sign-up → empty profile row.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
