import { supabase } from './supabase.js';
import { addXP, addTickets } from './progression.js';
import type { Room, Player } from '../game/RoomManager.js';

/**
 * Persist a finished match and hand out rewards.
 *
 * Only human players are recorded — the bot's fake id ('__bot__') is
 * not a profile and used to poison the whole insert, which is why no
 * stats ever saved. A bot victory is stored as "no winner".
 */

/** XP / tickets granted when a match finishes. */
export const REWARDS = {
  win:  { xp: 50, tickets: 10 },
  play: { xp: 15, tickets: 3 },
} as const;

export interface MatchReward {
  userId: string;
  xpGained: number;
  ticketsGained: number;
  /** Level and total XP after the award. */
  level: number;
  xp: number;
  leveledUp: boolean;
}

/** Humans only, and a winner id that's guaranteed to be a real profile. */
export function normalizeForPersistence(room: Room, winnerId: string | null): {
  humans: Player[];
  humanWinnerId: string | null;
} {
  const humans = Array.from(room.players.values()).filter(p => !p.isBot);
  const humanWinnerId = humans.some(p => p.userId === winnerId) ? winnerId : null;
  return { humans, humanWinnerId };
}

/**
 * Save the match, update lifetime totals, and award XP + tickets.
 * Returns one reward entry per human player (empty when Supabase is
 * not configured or persistence failed).
 */
export async function saveMatch(room: Room, winnerId: string | null): Promise<MatchReward[]> {
  if (!supabase) return [];

  const { humans, humanWinnerId } = normalizeForPersistence(room, winnerId);
  if (humans.length === 0) return [];

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({
      room_code:    room.roomCode,
      room_type:    room.roomType,
      lives_count:  room.livesCount,
      total_laughs: humans.reduce((s, p) => s + p.laughsReceived, 0),
      winner_id:    humanWinnerId,
      finished_at:  new Date().toISOString(),
    })
    .select('id')
    .single();

  if (matchErr || !match) {
    console.error('[persist] match insert failed:', matchErr);
    return [];
  }

  const rows = humans.map(p => ({
    match_id:        match.id,
    player_id:       p.userId,
    laughs_caused:   p.laughsCaused,
    laughs_received: p.laughsReceived,
    is_eliminated:   p.isEliminated,
    placement:       p.userId === humanWinnerId ? 1 : null,
  }));

  const { error: mpErr } = await supabase.from('match_players').insert(rows);
  if (mpErr) {
    console.error('[persist] match_players insert failed:', mpErr);
    return [];
  }

  // Lifetime totals (total_matches / total_wins) — atomic, in the DB.
  const { error: statsErr } = await supabase.rpc('apply_match_result', { p_match_id: match.id });
  if (statsErr) console.error('[persist] apply_match_result failed:', statsErr);

  // XP + tickets for everyone who played; the winner gets the big cut.
  const rewards: MatchReward[] = [];
  for (const p of humans) {
    const tier = p.userId === humanWinnerId ? REWARDS.win : REWARDS.play;
    try {
      const { leveledUp } = await addXP(p.userId, tier.xp);
      const after = await addTickets(p.userId, tier.tickets);
      rewards.push({
        userId: p.userId,
        xpGained: tier.xp,
        ticketsGained: tier.tickets,
        level: after.level,
        xp: after.xp,
        leveledUp,
      });
    } catch (err) {
      console.error(`[persist] rewards failed for ${p.userId}:`, err);
    }
  }
  return rewards;
}
