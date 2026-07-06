-- ============================================================
-- Laugh Table — Fix match stats persistence
-- Paste into the Supabase SQL editor and run.
--
-- The old finalize_match_stats trigger fired on UPDATE of
-- finished_at, but the game server INSERTs matches already
-- finished — so total_wins / total_matches never incremented.
-- It also ran before match_players rows existed.
--
-- Replaced by an explicit function the server calls AFTER
-- inserting the match and its players.
-- ============================================================

drop trigger if exists on_match_finished on public.matches;
drop function if exists public.finalize_match_stats();

-- Increment lifetime totals for everyone who played in a match.
-- Called once per match by the game server after persistence.
create or replace function public.apply_match_result(p_match_id uuid)
returns void language plpgsql security definer as $$
declare
  v_winner uuid;
begin
  select winner_id into v_winner from public.matches where id = p_match_id;

  update public.profiles p
  set total_matches = total_matches + 1
  from public.match_players mp
  where mp.match_id = p_match_id
    and mp.player_id = p.id;

  if v_winner is not null then
    update public.profiles
    set total_wins = total_wins + 1
    where id = v_winner;
  end if;
end;
$$;

-- Only the game server (service role) may apply results.
revoke execute on function public.apply_match_result(uuid) from public, anon, authenticated;
