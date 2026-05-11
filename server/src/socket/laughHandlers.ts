import type { Server, Socket } from 'socket.io';
import type { MatchEngine } from '../game/MatchEngine.js';

export function registerLaughHandlers(_io: Server, socket: Socket, engine: MatchEngine): void {

  // Emitted by the local Python vision server → React client → here
  socket.on('laugh_detected', (payload: {
    roomCode: string;
    userId: string;
    confidence: number;
  }) => {
    engine.processLaugh(payload.roomCode, payload.userId, payload.confidence);
  });
}
