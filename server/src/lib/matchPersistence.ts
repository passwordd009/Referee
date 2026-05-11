import { supabase } from './supabase.js';
import type { Room } from '../game/RoomManager.js';

export async function saveMatch(room: Room, winnerId: string | null): Promise<void> {
  const players = Array.from(room.players.values());

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({
      room_code:    room.roomCode,
      room_type:    room.roomType,
      lives_count:  room.livesCount,
      total_laughs: players.reduce((s, p) => s + p.laughsReceived, 0),
      winner_id:    winnerId ?? null,
      finished_at:  new Date().toISOString(),
    })
    .select('id')
    .single();

  if (matchErr || !match) {
    console.error('[persist] match insert failed:', matchErr);
    return;
  }

  const rows = players.map((p, i) => ({
    match_id:        match.id,
    player_id:       p.userId,
    laughs_caused:   p.laughsCaused,
    laughs_received: p.laughsReceived,
    is_eliminated:   p.isEliminated,
    placement:       p.isEliminated ? null : i + 1,
  }));

  const { error: mpErr } = await supabase.from('match_players').insert(rows);
  if (mpErr) console.error('[persist] match_players insert failed:', mpErr);
}
