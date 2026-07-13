import type { Server, Socket } from 'socket.io';
import { roomManager } from '../game/RoomManager.js';
import type { MatchEngine } from '../game/MatchEngine.js';

export function registerMatchHandlers(io: Server, socket: Socket, engine: MatchEngine): void {
  engine.init(io);

  socket.on('get_match_state', (payload: { roomCode: string }, cb: (res: object) => void) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    // Include the caller's private role — the game page may mount after
    // role_revealed_to_player was emitted.
    const me = Array.from(room.players.values()).find(p => p.socketId === socket.id);
    cb({
      ok: true,
      room: roomManager.serialize(room),
      myRole: me?.role ?? null,
      discussionsRemaining: me?.discussionsRemaining ?? 0,
    });
  });

  socket.on('start_match', (payload: { roomCode: string; userId: string }, cb: (res: object) => void) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.createdBy !== payload.userId) return cb({ ok: false, error: 'Only the host can start' });
    const active = Array.from(room.players.values()).filter(p => !p.isSpectator);
    if (active.length < 2) return cb({ ok: false, error: 'Need at least 2 players' });

    const notReady = active.filter(p => !p.isReady);
    if (notReady.length > 0) return cb({ ok: false, error: 'Not all players are ready' });

    engine.startMatch(payload.roomCode);
    cb({ ok: true });
  });

  socket.on('rematch', (payload: { roomCode: string; userId: string }, cb?: (res: object) => void) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    if (room.createdBy !== payload.userId) return cb?.({ ok: false, error: 'Only the host can rematch' });
    engine.rematch(payload.roomCode);
    cb?.({ ok: true });
  });

  // ── Rounds ──────────────────────────────────────────────

  // Jester picks the next round type
  socket.on('select_round', (payload: { roomCode: string; userId: string; type: string }) => {
    engine.selectRound(payload.roomCode, payload.userId, payload.type);
  });

  // Guess-the-item: private guess submission
  socket.on('submit_item_guess', (payload: { roomCode: string; userId: string; guess: string }) => {
    if (typeof payload.guess !== 'string') return;
    engine.submitItemGuess(payload.roomCode, payload.userId, payload.guess);
  });

  // Detective: accusation-round guess
  socket.on('detective_guess', (payload: { roomCode: string; userId: string; targetId: string }) => {
    engine.detectiveGuess(payload.roomCode, payload.userId, payload.targetId);
  });

  // Detective: activate a discussion (max 3 per match)
  socket.on('activate_discussion', (payload: { roomCode: string; userId: string }) => {
    engine.activateDiscussion(payload.roomCode, payload.userId);
  });

  // Soundboard: Saboteur any time (cooldown), everyone in Sudden Death
  socket.on('play_soundboard', (payload: { roomCode: string; userId: string; soundId: string }) => {
    engine.playSound(payload.roomCode, payload.userId, payload.soundId);
  });

  // Performer plays a bit (free-for-all during Sudden Death)
  socket.on('play_bit', (payload: {
    roomCode: string;
    userId: string;
    mediaType: string;
    mediaUrl?: string;
    textContent?: string;
    title?: string;
  }) => {
    engine.playBit(payload.roomCode, payload.userId, {
      mediaType:   payload.mediaType,
      mediaUrl:    payload.mediaUrl,
      textContent: payload.textContent,
      title:       payload.title,
    });
  });

  // Performer ends their round early
  socket.on('skip_turn', (payload: { roomCode: string; userId: string }) => {
    engine.endRoundEarly(payload.roomCode, payload.userId);
  });

  // Voluntary forfeit mid-match
  socket.on('leave_match', (payload: { roomCode: string; userId: string }) => {
    engine.leaveMatch(payload.roomCode, payload.userId);
  });
}
