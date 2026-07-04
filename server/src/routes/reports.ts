import { Router, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../lib/auth.js';

/**
 * Player-safety reports for players and bits.
 *
 * The reporter's identity always comes from the verified JWT, target
 * existence is checked, reasons are validated per target type, and a
 * partial unique index blocks duplicate open reports. Review tooling
 * (moderation dashboard) comes in a later rollout.
 */

const PLAYER_REASONS = ['harassment', 'inappropriate_behavior', 'hate_speech', 'cheating', 'spam', 'other'] as const;
const BIT_REASONS = ['nudity', 'violence', 'hate_speech', 'copyrighted_material', 'spam', 'illegal_content', 'other'] as const;

const REASONS: Record<string, readonly string[]> = {
  player: PLAYER_REASONS,
  bit: BIT_REASONS,
};

const MAX_DESCRIPTION = 2000;

async function createReport(
  res: Response,
  reporterId: string,
  targetType: string,
  targetId: string,
  reason: unknown,
  description: unknown
) {
  const validReasons = REASONS[targetType];
  if (!validReasons) return res.status(400).json({ error: 'target_type must be "player" or "bit"' });
  if (typeof reason !== 'string' || !validReasons.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${validReasons.join(', ')}` });
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > MAX_DESCRIPTION)) {
    return res.status(400).json({ error: `description must be a string of at most ${MAX_DESCRIPTION} characters` });
  }
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) {
    return res.status(400).json({ error: 'Invalid target id' });
  }
  if (targetType === 'player' && targetId === reporterId) {
    return res.status(400).json({ error: 'You cannot report yourself' });
  }

  // The target must actually exist.
  const table = targetType === 'player' ? 'profiles' : 'bits';
  const { data: target } = await supabase!.from(table).select('id').eq('id', targetId).maybeSingle();
  if (!target) return res.status(404).json({ error: `${targetType} not found` });

  const { data, error } = await supabase!
    .from('reports')
    .insert({
      reporter_id: reporterId,
      target_type: targetType,
      target_id: targetId,
      reason,
      description: description || null,
    })
    .select('id, status, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You already have an open report for this target' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ report: data });
}

const router = Router();
router.use(requireAuth);

// POST /api/reports — generic report endpoint
router.post('/reports', (req, res) => {
  const { targetType, targetId, reason, description } = req.body as {
    targetType?: string; targetId?: string; reason?: unknown; description?: unknown;
  };
  if (!targetType || !targetId) {
    return res.status(400).json({ error: 'targetType and targetId required' });
  }
  return createReport(res, req.authUserId!, targetType, targetId, reason, description);
});

// POST /api/bits/:id/report
router.post('/bits/:id/report', (req, res) => {
  const { reason, description } = req.body as { reason?: unknown; description?: unknown };
  return createReport(res, req.authUserId!, 'bit', req.params.id, reason, description);
});

// POST /api/players/:id/report
router.post('/players/:id/report', (req, res) => {
  const { reason, description } = req.body as { reason?: unknown; description?: unknown };
  return createReport(res, req.authUserId!, 'player', req.params.id, reason, description);
});

export default router;
