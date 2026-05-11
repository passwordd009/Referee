import type { Server, Socket } from 'socket.io';
import { roomManager } from '../game/RoomManager.js';
import type { MatchEngine } from '../game/MatchEngine.js';

export function registerMatchHandlers(io: Server, socket: Socket, engine: MatchEngine): void {
  engine.init(io);

  // Host starts the match — requires all players ready
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

  // Active player plays a bit — broadcast to room
  socket.on('play_bit', (payload: { roomCode: string; userId: string; bitId: string; mediaUrl: string; mediaType: string }) => {
    const room = roomManager.get(payload.roomCode);
    if (!room || room.status !== 'in_game') return;
    const activeId = room.turnOrder[room.currentTurnIndex];
    if (activeId !== payload.userId) return;

    io.to(payload.roomCode).emit('bit_played', {
      playerId:  payload.userId,
      bitId:     payload.bitId,
      mediaUrl:  payload.mediaUrl,
      mediaType: payload.mediaType,
      startedAt: Date.now(),
    });
  });

  // Active player skips their turn
  socket.on('skip_turn', (payload: { roomCode: string; userId: string }) => {
    const room = roomManager.get(payload.roomCode);
    if (!room || room.status !== 'in_game') return;
    const activeId = room.turnOrder[room.currentTurnIndex];
    if (activeId !== payload.userId) return;

    engine.endTurn(payload.roomCode);
  });
}
