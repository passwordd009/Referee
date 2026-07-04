-- ============================================================
-- Laugh Table — Progression & security foundation
-- Paste into the Supabase SQL editor and run.
--
-- Adds (no gameplay integration yet):
--   * XP / level / tickets / crowns on profiles
--   * date_of_birth for age verification
--   * bit moderation + visibility fields
--   * reports table (players and bits)
--   * atomic helper functions for XP and currency changes
-- ============================================================

-- ── Profile progression ──────────────────────────────────────
alter table public.profiles add column if not exists level   int not null default 1;
alter table public.profiles add column if not exists xp      int not null default 0;
alter table public.profiles add column if not exists tickets int not null default 0;
alter table public.profiles add column if not exists crowns  int not null default 0;

alter table public.profiles add constraint profiles_xp_nonneg      check (xp >= 0)      not valid;
alter table public.profiles add constraint profiles_tickets_nonneg check (tickets >= 0) not valid;
alter table public.profiles add constraint profiles_crowns_nonneg  check (crowns >= 0)  not valid;
alter table public.profiles validate constraint profiles_xp_nonneg;
alter table public.profiles validate constraint profiles_tickets_nonneg;
alter table public.profiles validate constraint profiles_crowns_nonneg;

-- ── Age verification ─────────────────────────────────────────
alter table public.profiles add column if not exists date_of_birth date;

-- Copy date_of_birth from signup metadata into the profile row.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, avatar_url, date_of_birth)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    nullif(new.raw_user_meta_data->>'date_of_birth', '')::date
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── Level curve ───────────────────────────────────────────────
-- level = floor(sqrt(xp / 100)) + 1
--   level 1: 0 xp   level 2: 100   level 3: 400   level 4: 900 …
-- Quadratic curves keep early levels fast and later levels meaningful.
create or replace function public.level_for_xp(xp_amount int)
returns int language sql immutable as $$
  select floor(sqrt(greatest(xp_amount, 0) / 100.0))::int + 1;
$$;

-- ── Atomic progression helpers ────────────────────────────────
-- All balance changes go through these so they are atomic and can
-- never produce a negative balance, no matter how many server
-- instances call them concurrently.

create or replace function public.add_xp(p_user_id uuid, p_amount int)
returns public.profiles language plpgsql security definer as $$
declare
  updated public.profiles;
begin
  if p_amount < 0 then
    raise exception 'XP can only increase (got %)', p_amount;
  end if;

  update public.profiles
  set xp    = xp + p_amount,
      level = public.level_for_xp(xp + p_amount)
  where id = p_user_id
  returning * into updated;

  if not found then
    raise exception 'profile % not found', p_user_id;
  end if;
  return updated;
end;
$$;

-- Positive delta adds, negative delta spends. Spending more than the
-- balance raises 'insufficient_tickets' and changes nothing.
create or replace function public.adjust_tickets(p_user_id uuid, p_delta int)
returns public.profiles language plpgsql security definer as $$
declare
  updated public.profiles;
begin
  update public.profiles
  set tickets = tickets + p_delta
  where id = p_user_id
    and tickets + p_delta >= 0
  returning * into updated;

  if not found then
    if exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'insufficient_tickets';
    end if;
    raise exception 'profile % not found', p_user_id;
  end if;
  return updated;
end;
$$;

create or replace function public.adjust_crowns(p_user_id uuid, p_delta int)
returns public.profiles language plpgsql security definer as $$
declare
  updated public.profiles;
begin
  update public.profiles
  set crowns = crowns + p_delta
  where id = p_user_id
    and crowns + p_delta >= 0
  returning * into updated;

  if not found then
    if exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'insufficient_crowns';
    end if;
    raise exception 'profile % not found', p_user_id;
  end if;
  return updated;
end;
$$;

-- Only the service role (game server) may award or spend.
revoke execute on function public.add_xp(uuid, int)          from public, anon, authenticated;
revoke execute on function public.adjust_tickets(uuid, int)  from public, anon, authenticated;
revoke execute on function public.adjust_crowns(uuid, int)   from public, anon, authenticated;

-- ── Bit moderation & visibility ───────────────────────────────
-- moderation_status defaults to 'approved' while bits are only ever
-- seen by their owner; when public sharing ships, flip the default to
-- 'pending' and route new bits through the moderation queue.
alter table public.bits add column if not exists moderation_status text not null default 'approved'
  check (moderation_status in ('pending', 'approved', 'rejected', 'removed'));
alter table public.bits add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'public'));

create index if not exists bits_moderation_idx on public.bits(moderation_status)
  where moderation_status in ('pending', 'rejected');

-- ── Reports ───────────────────────────────────────────────────
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  target_type  text not null check (target_type in ('player', 'bit')),
  target_id    uuid not null,
  reason       text not null,
  description  text,
  status       text not null default 'pending'
    check (status in ('pending', 'reviewed', 'dismissed', 'action_taken')),
  created_at   timestamptz not null default now(),

  constraint reports_reason_valid check (
    (target_type = 'player' and reason in
      ('harassment', 'inappropriate_behavior', 'hate_speech', 'cheating', 'spam', 'other'))
    or
    (target_type = 'bit' and reason in
      ('nudity', 'violence', 'hate_speech', 'copyrighted_material', 'spam', 'illegal_content', 'other'))
  )
);

create index if not exists reports_status_idx on public.reports(status) where status = 'pending';
create index if not exists reports_target_idx on public.reports(target_type, target_id);
create index if not exists reports_reporter_idx on public.reports(reporter_id);

-- One open report per reporter per target — blocks report spam.
create unique index if not exists reports_unique_open
  on public.reports(reporter_id, target_type, target_id)
  where status = 'pending';

alter table public.reports enable row level security;

-- Reports go through the game server (service role). Reporters may
-- read their own; nobody else reads reports until a moderation
-- dashboard with proper roles exists.
create policy "reports_select_own" on public.reports
  for select using (auth.uid() = reporter_id);
