import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../lib/auth.js';
import { getProfile } from '../lib/progression.js';

const router = Router();
router.use(requireAuth);

// GET /api/me/profile — own profile + lifetime match stats
router.get('/profile', async (req, res) => {
  const userId = req.authUserId!;

  const profile = await getProfile(userId).catch(() => null);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  // Lifetime stats from recorded matches.
  const { data: rows, error } = await supabase!
    .from('match_players')
    .select('laughs_caused, laughs_received, is_eliminated, matches!inner(winner_id, finished_at)')
    .eq('player_id', userId)
    .order('finished_at', { ascending: false, referencedTable: 'matches' })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  type Row = {
    laughs_caused: number;
    laughs_received: number;
    is_eliminated: boolean;
    matches: { winner_id: string | null; finished_at: string | null };
  };
  const played = (rows as unknown as Row[]) ?? [];
  const finished = played.filter(r => r.matches.finished_at);
  const wins = finished.filter(r => r.matches.winner_id === userId).length;
  const laughsReceived = finished.reduce((s, r) => s + r.laughs_received, 0);
  const laughsCaused = finished.reduce((s, r) => s + r.laughs_caused, 0);

  res.json({
    profile,
    stats: {
      matchesPlayed: finished.length,
      wins,
      winRate: finished.length ? wins / finished.length : 0,
      laughsCaused,
      laughsReceived,
      /** Average times caught laughing per match — lower is better. */
      laughRate: finished.length ? laughsReceived / finished.length : 0,
      recent: finished.slice(0, 10).map(r => ({
        won: r.matches.winner_id === userId,
        laughsCaused: r.laughs_caused,
        laughsReceived: r.laughs_received,
        finishedAt: r.matches.finished_at,
      })),
    },
  });
});

// PATCH /api/me/profile — update own profile (whitelisted fields only)
router.patch('/profile', async (req, res) => {
  const userId = req.authUserId!;
  const { username, avatarUrl } = req.body as { username?: string; avatarUrl?: string };

  const updates: Record<string, string> = {};
  if (username !== undefined) {
    const trimmed = String(username).trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      return res.status(400).json({ error: 'Username must be 2-20 characters' });
    }
    updates.username = trimmed;
  }
  if (avatarUrl !== undefined) {
    if (typeof avatarUrl !== 'string' || avatarUrl.length > 500) {
      return res.status(400).json({ error: 'Invalid avatar URL' });
    }
    updates.avatar_url = avatarUrl;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase!
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    return res.status(500).json({ error: error.message });
  }
  res.json({ profile: data });
});

export default router;
