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
      isSpectator:    false,
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
    asSpectator?: boolean;
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

    const counts = { players: 0, spectators: 0 };
    for (const p of room.players.values()) counts[p.isSpectator ? 'spectators' : 'players']++;

    // Spectators may join any time (even mid-match); players only in lobby.
    let spectator = !!payload.asSpectator;
    if (!spectator && room.status !== 'lobby') {
      if (!room.allowSpectators) return cb({ ok: false, error: 'Game already started' });
      spectator = true; // late arrivals watch
    }
    if (spectator && !room.allowSpectators) return cb({ ok: false, error: 'Spectators are not allowed in this room' });
    if (spectator && counts.spectators >= 12) return cb({ ok: false, error: 'Spectator seats full' });
    if (!spectator && counts.players >= room.maxPlayers) {
      return cb({ ok: false, error: 'Room full' });
    }

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
      isSpectator:    spectator,
      role:           'regular',
      discussionsRemaining: 0,
    });

    socket.join(payload.roomCode);
    io.to(payload.roomCode).emit('player_joined', { room: roomManager.serialize(room) });
    sys(io, payload.roomCode, spectator
      ? `${payload.username} is watching 👁`
      : `${payload.username} joined the room`);
    cb({ ok: true, room: roomManager.serialize(room), asSpectator: spectator });
  });

  // Lobby-only: switch between playing and spectating.
  socket.on('set_spectator', (payload: { roomCode: string; userId: string; spectator: boolean }, cb?: (res: object) => void) => {
    const room = roomManager.get(payload.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Match already started' });
    const player = room.players.get(payload.userId);
    if (!player || player.socketId !== socket.id) return cb?.({ ok: false, error: 'Not in room' });
    if (payload.spectator && !room.allowSpectators) return cb?.({ ok: false, error: 'Spectators are not allowed in this room' });
    if (player.isSpectator === payload.spectator) return cb?.({ ok: true });

    if (!payload.spectator) {
      const playerCount = Array.from(room.players.values()).filter(p => !p.isSpectator).length;
      if (playerCount >= room.maxPlayers) return cb?.({ ok: false, error: 'Room full' });
    }

    player.isSpectator = payload.spectator;
    player.isReady = false;
    room.turnOrder = room.turnOrder.filter(id => id !== payload.userId);
    if (!payload.spectator) room.turnOrder.push(payload.userId);

    io.to(payload.roomCode).emit('room_updated', { room: roomManager.serialize(room) });
    sys(io, payload.roomCode, payload.spectator
      ? `${player.username} is now spectating 👁`
      : `${player.username} joined the players`);
    cb?.({ ok: true });
  });

  socket.on('update_room_settings', (payload: {
    roomCode: string;
    userId: string;
    livesCount?: number;
    showCameras?: boolean;
    cameraLayout?: CameraLayout;
    allowSpectators?: boolean;
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
    if (typeof payload.allowSpectators === 'boolean') room.allowSpectators = payload.allowSpectators;
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
