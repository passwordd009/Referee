import type { Server, Socket } from 'socket.io';
import { roomManager } from '../game/RoomManager.js';

/**
 * Casual matchmaking — a single FIFO queue, no ranking, no skill.
 * 3 players match instantly; 2 players match after a short wait so
 * small test groups aren't stuck forever.
 */

const PREFERRED_SIZE = 3;
const MIN_SIZE = 2;
const TWO_PLAYER_WAIT_MS = 12_000;

interface QueueEntry {
  socketId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
}

const queue: QueueEntry[] = [];
let twoPlayerTimer: ReturnType<typeof setTimeout> | null = null;

function broadcastQueueState(io: Server): void {
  queue.forEach((entry, i) => {
    io.to(entry.socketId).emit('casual_queue_update', {
      position: i + 1,
      size: queue.length,
      needed: Math.max(0, MIN_SIZE - queue.length),
    });
  });
}

function clearTwoPlayerTimer(): void {
  if (twoPlayerTimer) { clearTimeout(twoPlayerTimer); twoPlayerTimer = null; }
}

function tryMatch(io: Server): void {
  if (queue.length >= PREFERRED_SIZE) {
    clearTwoPlayerTimer();
    makeMatch(io, queue.splice(0, PREFERRED_SIZE));
  } else if (queue.length === MIN_SIZE && !twoPlayerTimer) {
    // Two in queue: give a third a moment to show up, then go anyway.
    twoPlayerTimer = setTimeout(() => {
      twoPlayerTimer = null;
      if (queue.length >= MIN_SIZE) makeMatch(io, queue.splice(0, queue.length));
    }, TWO_PLAYER_WAIT_MS);
  } else if (queue.length < MIN_SIZE) {
    clearTwoPlayerTimer();
  }
  broadcastQueueState(io);
}

function makeMatch(io: Server, entries: QueueEntry[]): void {
  const room = roomManager.create({
    roomType:   'public',
    maxPlayers: Math.max(entries.length, 6),
    livesCount: 3,
    createdBy:  entries[0].userId, // first in queue hosts
  });
  // If nobody actually joins the lobby, clean the empty room up.
  roomManager.scheduleDelete(room.roomCode, 60_000);

  for (const entry of entries) {
    io.to(entry.socketId).emit('casual_match_found', {
      roomCode: room.roomCode,
      hostUserId: room.createdBy,
      players: entries.map(e => e.username),
    });
  }
}

function removeFromQueue(io: Server, predicate: (e: QueueEntry) => boolean): void {
  const before = queue.length;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (predicate(queue[i])) queue.splice(i, 1);
  }
  if (queue.length !== before) tryMatch(io);
}

export function registerQueueHandlers(io: Server, socket: Socket): void {
  socket.on('join_casual_queue', (payload: {
    userId: string;
    username: string;
    avatarUrl?: string;
  }, cb?: (res: object) => void) => {
    // One queue slot per user; a rejoin refreshes the socket.
    const existing = queue.find(e => e.userId === payload.userId);
    if (existing) {
      existing.socketId = socket.id;
    } else {
      queue.push({
        socketId: socket.id,
        userId:   payload.userId,
        username: payload.username,
        avatarUrl: payload.avatarUrl,
      });
    }
    cb?.({ ok: true, size: queue.length });
    tryMatch(io);
  });

  socket.on('leave_casual_queue', (payload: { userId: string }) => {
    removeFromQueue(io, e => e.userId === payload.userId);
  });

  socket.on('disconnect', () => {
    removeFromQueue(io, e => e.socketId === socket.id);
  });
}
