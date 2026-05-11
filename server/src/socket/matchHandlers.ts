import type { Server, Socket } from 'socket.io';
import { roomManager } from '../game/RoomManager.js';
import type { MatchEngine } from '../game/MatchEngine.js';

export function registerMatchHandlers(io: Server, socket: Socket, engine: MatchEngine): void {
  engine.init(io);

  socket.on('start_match', (payload: { roomCode: string; userId: string }, cb: (res: object) => void) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.createdBy !== payload.userId) return cb({ ok: false, error: 'Only the host can start' });
    if (room.players.size < 2) return cb({ ok: false, error: 'Need at least 2 players' });

    const notReady = Array.from(room.players.values()).filter(p => !p.isReady);
    if (notReady.length > 0) return cb({ ok: false, error: 'Not all players are ready' });

    engine.startMatch(payload.roomCode);
    cb({ ok: true });
  });

  // Active player plays a bit from their inventory
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

  // Player guesses who played the bit
  socket.on('submit_guess', (payload: {
    roomCode: string;
    guesserId: string;
    targetId: string;
  }) => {
    engine.submitGuess(payload.roomCode, payload.guesserId, payload.targetId);
  });

  // Active player skips their turn
  socket.on('skip_turn', (payload: { roomCode: string; userId: string }) => {
    const room = roomManager.get(payload.roomCode);
    if (!room || room.status !== 'in_game') return;
    engine.endTurn(payload.roomCode);
  });
}
