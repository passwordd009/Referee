import type { Server, Socket } from 'socket.io';
import { roomManager } from '../game/RoomManager.js';
import type { RoomType } from '../game/RoomManager.js';

export function registerRoomHandlers(io: Server, socket: Socket): void {

  socket.on('create_room', (payload: {
    userId: string;
    username: string;
    avatarUrl?: string;
    roomType?: RoomType;
    maxPlayers?: number;
    livesCount?: number;
  }, cb: (res: object) => void) => {
    const room = roomManager.create({
      roomType:   payload.roomType   ?? 'private',
      maxPlayers: payload.maxPlayers ?? 6,
      livesCount: Math.min(Math.max(payload.livesCount ?? 3, 1), 4),
      createdBy:  payload.userId,
    });

    roomManager.addPlayer(room.roomCode, {
      userId:         payload.userId,
      username:       payload.username,
      avatarUrl:      payload.avatarUrl,
      socketId:       socket.id,
      livesRemaining: room.livesCount,
      laughsCaused:   0,
      laughsReceived: 0,
      isEliminated:   false,
      isReady:        false,
    });

    socket.join(room.roomCode);
    cb({ ok: true, room: roomManager.serialize(room) });
  });

  socket.on('join_room', (payload: {
    roomCode: string;
    userId: string;
    username: string;
    avatarUrl?: string;
  }, cb: (res: object) => void) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'Game already started' });
    if (room.players.size >= room.maxPlayers) return cb({ ok: false, error: 'Room full' });

    roomManager.addPlayer(payload.roomCode, {
      userId:         payload.userId,
      username:       payload.username,
      avatarUrl:      payload.avatarUrl,
      socketId:       socket.id,
      livesRemaining: room.livesCount,
      laughsCaused:   0,
      laughsReceived: 0,
      isEliminated:   false,
      isReady:        false,
    });

    socket.join(payload.roomCode);
    io.to(payload.roomCode).emit('player_joined', {
      room: roomManager.serialize(room),
    });
    cb({ ok: true, room: roomManager.serialize(room) });
  });

  socket.on('player_ready', (payload: { roomCode: string; userId: string; ready: boolean }) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return;
    const player = room.players.get(payload.userId);
    if (!player) return;

    player.isReady = payload.ready;
    io.to(payload.roomCode).emit('room_updated', { room: roomManager.serialize(room) });
  });

  socket.on('leave_room', (payload: { roomCode: string; userId: string }) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return;
    room.players.delete(payload.userId);
    room.turnOrder = room.turnOrder.filter(id => id !== payload.userId);
    socket.leave(payload.roomCode);
    io.to(payload.roomCode).emit('player_left', {
      userId: payload.userId,
      room: roomManager.serialize(room),
    });
  });

  socket.on('disconnect', () => {
    const result = roomManager.removeBySocket(socket.id);
    if (!result) return;
    const { roomCode, userId, room } = result;
    io.to(roomCode).emit('player_left', {
      userId,
      room: roomManager.serialize(room),
    });
  });
}
