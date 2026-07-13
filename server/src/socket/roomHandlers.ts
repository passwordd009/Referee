import type { Server, Socket } from 'socket.io';
import { roomManager } from '../game/RoomManager.js';
import type { RoomType, CameraLayout } from '../game/RoomManager.js';

function sys(io: Server, roomCode: string, text: string): void {
  io.to(roomCode).emit('system_message', { text, ts: Date.now() });
}

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
      role:           'regular',
      discussionsRemaining: 0,
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

    // Rejoining player (e.g. navigated lobby → game) just refreshes their socket.
    const existing = room.players.get(payload.userId);
    if (existing) {
      existing.socketId = socket.id;
      socket.join(payload.roomCode);
      return cb({ ok: true, room: roomManager.serialize(room) });
    }

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
      role:           'regular',
      discussionsRemaining: 0,
    });

    socket.join(payload.roomCode);
    io.to(payload.roomCode).emit('player_joined', { room: roomManager.serialize(room) });
    sys(io, payload.roomCode, `${payload.username} joined the room`);
    cb({ ok: true, room: roomManager.serialize(room) });
  });

  socket.on('update_room_settings', (payload: {
    roomCode: string;
    userId: string;
    livesCount?: number;
    showCameras?: boolean;
    cameraLayout?: CameraLayout;
  }, cb: (res: object) => void) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.createdBy !== payload.userId) return cb({ ok: false, error: 'Only the host can change settings' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'Game already started' });

    if (payload.livesCount) {
      room.livesCount = Math.min(Math.max(payload.livesCount, 1), 4);
      for (const p of room.players.values()) p.livesRemaining = room.livesCount;
    }
    if (typeof payload.showCameras === 'boolean') room.showCameras = payload.showCameras;
    if (payload.cameraLayout === 'grid' || payload.cameraLayout === 'spotlight') {
      room.cameraLayout = payload.cameraLayout;
    }

    io.to(payload.roomCode).emit('room_updated', { room: roomManager.serialize(room) });
    cb({ ok: true });
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
    const leaving = room.players.get(payload.userId);
    room.players.delete(payload.userId);
    room.turnOrder = room.turnOrder.filter(id => id !== payload.userId);
    roomManager.removeSocketMapping(socket.id);
    socket.leave(payload.roomCode);

    if (room.players.size === 0) {
      roomManager.delete(payload.roomCode);
    } else {
      io.to(payload.roomCode).emit('player_left', {
        userId: payload.userId,
        room: roomManager.serialize(room),
      });
      if (leaving) sys(io, payload.roomCode, `${leaving.username} left the room`);
    }
  });

  socket.on('disconnect', () => {
    const result = roomManager.removeBySocket(socket.id);
    if (!result) return;
    const { roomCode, userId, room } = result;
    if (room.players.size === 0) {
      roomManager.delete(roomCode);
    } else {
      io.to(roomCode).emit('player_left', { userId, room: roomManager.serialize(room) });
    }
  });
}
