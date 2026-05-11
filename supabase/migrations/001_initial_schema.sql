-- ============================================================
-- Referee — Supabase migration
-- Paste into Supabase SQL editor and run.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Profiles ─────────────────────────────────────────────────
-- One row per auth.users entry, created automatically on sign-up.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique,
  avatar_url    text,
  total_wins    int  not null default 0,
  total_matches int  not null default 0,
  created_at    timestamptz not null default now()
);

-- Auto-create profile after sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Bits ─────────────────────────────────────────────────────
-- Comedy bits a player can upload and play during their turn.
create table if not exists public.bits (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.profiles(id) on delete cascade,
  title       text,
  media_type  text not null check (media_type in ('video', 'audio', 'image', 'text')),
  media_url   text not null,
  play_count  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists bits_creator_idx on public.bits(creator_id);

-- ── Matches ──────────────────────────────────────────────────
create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  room_code    text not null,
  room_type    text not null check (room_type in ('private', 'public', 'ranked')),
  lives_count  int  not null,
  total_laughs int  not null default 0,
  winner_id    uuid references public.profiles(id) on delete set null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists matches_winner_idx on public.matches(winner_id);

-- ── Match players ─────────────────────────────────────────────
-- Per-player stats for each match.
create table if not exists public.match_players (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches(id) on delete cascade,
  player_id       uuid not null references public.profiles(id) on delete cascade,
  laughs_caused   int  not null default 0,
  laughs_received int  not null default 0,
  placement       int,          -- 1 = winner, 2 = second-out, etc.
  is_eliminated   boolean not null default false,
  unique (match_id, player_id)
);

create index if not exists mp_match_idx  on public.match_players(match_id);
create index if not exists mp_player_idx on public.match_players(player_id);

-- ── Update profile stats when a match row is finished ────────
create or replace function public.finalize_match_stats()
returns trigger language plpgsql security definer as $$
begin
  -- increment total_matches for every participant
  update public.profiles p
  set total_matches = total_matches + 1
  from public.match_players mp
  where mp.match_id = new.id
    and mp.player_id = p.id;

  -- increment total_wins for the winner
  if new.winner_id is not null then
    update public.profiles
    set total_wins = total_wins + 1
    where id = new.winner_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_match_finished on public.matches;
create trigger on_match_finished
  after update of finished_at on public.matches
  for each row
  when (old.finished_at is null and new.finished_at is not null)
  execute procedure public.finalize_match_stats();

-- ── Row-level security ────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.bits         enable row level security;
alter table public.matches      enable row level security;
alter table public.match_players enable row level security;

-- profiles: public read, owner write
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- bits: public read, owner insert/update/delete
create policy "bits_select" on public.bits for select using (true);
create policy "bits_insert" on public.bits for insert with check (auth.uid() = creator_id);
create policy "bits_update" on public.bits for update using (auth.uid() = creator_id);
create policy "bits_delete" on public.bits for delete using (auth.uid() = creator_id);

-- matches: public read; server-side writes use service-role key (bypasses RLS)
create policy "matches_select" on public.matches for select using (true);

-- match_players: public read
create policy "mp_select" on public.match_players for select using (true);

-- ── Storage bucket ────────────────────────────────────────────
-- Run this only once; ignore error if bucket already exists.
insert into storage.buckets (id, name, public)
values ('bits', 'bits', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to their own folder
create policy "bits_upload" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'bits' and (storage.foldername(name))[1] = auth.uid()::text);

-- Allow anyone to read
create policy "bits_read" on storage.objects for select
  using (bucket_id = 'bits');

-- Allow owners to delete
create policy "bits_owner_delete" on storage.objects for delete
  to authenticated
  using (bucket_id = 'bits' and (storage.foldername(name))[1] = auth.uid()::text);
