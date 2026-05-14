import { randomBytes } from 'crypto';

export type RoomType = 'private' | 'public' | 'ranked';
export type RoomStatus = 'lobby' | 'in_game' | 'finished';
export type GameMode = 'water_hold' | 'guess_the_biter' | 'casual';

export interface Player {
  userId: string;
  username: string;
  avatarUrl?: string;
  socketId: string;
  livesRemaining: number;
  laughsCaused: number;
  laughsReceived: number;
  isEliminated: boolean;
  isReady: boolean;
}

export interface Room {
  id: string;
  roomCode: string;
  roomType: RoomType;
  maxPlayers: number;
  livesCount: number;
  gameMode: GameMode;
  turnTimeSecs: number;
  status: RoomStatus;
  createdBy: string;
  players: Map<string, Player>;
  currentTurnIndex: number;
  turnOrder: string[];
}

class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToRoom = new Map<string, string>();
  private pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

  generateCode(): string {
    return randomBytes(3).toString('hex').toUpperCase();
  }

  create(opts: {
    roomType: RoomType;
    maxPlayers: number;
    livesCount: number;
    gameMode: GameMode;
    turnTimeSecs: number;
    createdBy: string;
  }): Room {
    const roomCode = this.generateCode();
    const room: Room = {
      id: crypto.randomUUID(),
      roomCode,
      status: 'lobby',
      players: new Map(),
      currentTurnIndex: 0,
      turnOrder: [],
      ...opts,
    };
    this.rooms.set(roomCode, room);
    return room;
  }

  get(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  delete(roomCode: string): void {
    this.rooms.delete(roomCode);
    this.pendingDeletes.delete(roomCode);
  }

  removeSocketMapping(socketId: string): void {
    this.socketToRoom.delete(socketId);
  }

  scheduleDelete(roomCode: string, delayMs = 10_000): void {
    this.cancelDelete(roomCode);
    const timer = setTimeout(() => {
      this.rooms.delete(roomCode);
      this.pendingDeletes.delete(roomCode);
    }, delayMs);
    this.pendingDeletes.set(roomCode, timer);
  }

  cancelDelete(roomCode: string): void {
    const timer = this.pendingDeletes.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.pendingDeletes.delete(roomCode);
    }
  }

  addPlayer(roomCode: string, player: Player): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    room.players.set(player.userId, player);
    room.turnOrder.push(player.userId);
    this.socketToRoom.set(player.socketId, roomCode);
  }

  removeBySocket(socketId: string): { roomCode: string; userId: string; room: Room } | null {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    let userId = '';
    for (const [uid, p] of room.players) {
      if (p.socketId === socketId) { userId = uid; break; }
    }
    if (!userId) return null;

    room.players.delete(userId);
    room.turnOrder = room.turnOrder.filter(id => id !== userId);
    this.socketToRoom.delete(socketId);

    if (room.players.size === 0) this.rooms.delete(roomCode);

    return { roomCode, userId, room };
  }

  getBySocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  serialize(room: Room) {
    return {
      id: room.id,
      roomCode: room.roomCode,
      roomType: room.roomType,
      maxPlayers: room.maxPlayers,
      livesCount: room.livesCount,
      gameMode: room.gameMode,
      turnTimeSecs: room.turnTimeSecs,
      status: room.status,
      createdBy: room.createdBy,
      players: Array.from(room.players.values()).map(
        ({ socketId: _s, ...rest }) => rest
      ),
      currentTurnUserId: room.turnOrder[room.currentTurnIndex] ?? null,
    };
  }
}

export const roomManager = new RoomManager();
