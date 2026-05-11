import { Router } from 'express';
import { roomManager } from '../game/RoomManager.js';
import { createLiveKitToken } from '../lib/livekit.js';

const router = Router();

// GET /api/rooms/:code — fetch room state (for reconnects / deep links)
router.get('/:code', (req, res) => {
  const room = roomManager.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ room: roomManager.serialize(room) });
});

// POST /api/rooms/:code/livekit-token — get a LiveKit JWT for this room
router.post('/:code/livekit-token', async (req, res) => {
  const { userId, username } = req.body as { userId?: string; username?: string };
  if (!userId || !username) return res.status(400).json({ error: 'userId and username required' });

  const roomCode = req.params.code.toUpperCase();
  const room = roomManager.get(roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  try {
    const token = await createLiveKitToken(roomCode, `${username}__${userId}`);
    res.json({ token });
  } catch (err) {
    console.error('[livekit] token error:', err);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

export default router;
