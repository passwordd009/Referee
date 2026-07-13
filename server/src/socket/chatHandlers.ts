import type { Server, Socket } from 'socket.io';
import { roomManager } from '../game/RoomManager.js';

const MAX_LEN = 300;

/**
 * Room chat — lobby and match share the same channel (the socket room).
 * Messages are ephemeral: broadcast, never stored.
 */
export function registerChatHandlers(io: Server, socket: Socket): void {
  socket.on('chat_message', (payload: { roomCode: string; userId: string; text: string }) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return;
    const player = room.players.get(payload.userId);
    if (!player || player.socketId !== socket.id) return;

    const text = String(payload.text ?? '').trim().slice(0, MAX_LEN);
    if (!text) return;

    io.to(payload.roomCode).emit('chat_message', {
      userId:   player.userId,
      username: player.username,
      text,
      ts: Date.now(),
    });
  });
}
