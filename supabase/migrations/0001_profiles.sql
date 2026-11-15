-- TruePrice: user profiles with plan tier and scan counter.
-- Run once in Supabase → SQL Editor (or `supabase db push` if you use the CLI).

-- Plan tiers. GUEST = free (anonymous or signed up, 3 scans), PRO = paid, JUDGE = hackathon judges (unlimited).
do $$ begin
  create type public.user_tier as enum ('GUEST', 'PRO', 'JUDGE');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  tier        public.user_tier not null default 'GUEST',
  scan_count  integer not null default 0 check (scan_count >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Users may read their own profile; nobody may write it from the browser.
-- Writes happen only through the trigger below and the server (service role).
alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- Create a profile for every new auth user (including anonymous ones).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the email in sync (e.g. when it is confirmed or changed).
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Atomically use one scan. Returns the updated row, or no row if a GUEST is already at the limit.
-- Doing check + increment in one UPDATE means parallel requests can't overshoot the limit.
create or replace function public.consume_scan(p_user_id uuid, p_free_limit integer)
returns table (tier public.user_tier, scan_count integer)
language sql
security definer
set search_path = ''
as $$
  update public.profiles as p
     set scan_count = p.scan_count + 1,
         updated_at = now()
   where p.id = p_user_id
     and (p.tier <> 'GUEST' or p.scan_count < p_free_limit)
  returning p.tier, p.scan_count;
$$;

revoke execute on function public.consume_scan(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_scan(uuid, integer) to service_role;

-- Backfill profiles for users that existed before this migration.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
