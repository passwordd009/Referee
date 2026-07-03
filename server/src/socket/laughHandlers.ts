import type { Server, Socket } from 'socket.io';
import type { MatchEngine } from '../game/MatchEngine.js';

/**
 * Laugh events flow: the browser runs face-api.js locally on the player's
 * webcam feed, and emits `laugh_detected` when the smile score crosses the
 * threshold. The MatchEngine validates it (cooldown, active-player immunity)
 * and deducts a life if it counts.
 */
export function registerLaughHandlers(_io: Server, socket: Socket, engine: MatchEngine): void {
  socket.on('laugh_detected', (payload: {
    roomCode: string;
    userId: string;
    confidence: number;
  }) => {
    engine.processLaugh(payload.roomCode, payload.userId, payload.confidence);
  });
}
