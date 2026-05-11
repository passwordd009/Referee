import type { Server } from 'socket.io';
import { roomManager } from './RoomManager.js';
import { LaughProcessor } from './LaughProcessor.js';
import { saveMatch } from '../lib/matchPersistence.js';

const TURN_MS      = 15_000;
const BETWEEN_MS   = 1_500;

export class MatchEngine {
  private io!: Server;
  private turnTimers   = new Map<string, ReturnType<typeof setTimeout>>();
  private laughProcs   = new Map<string, LaughProcessor>();

  init(io: Server) { this.io = io; }

  startMatch(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'lobby') return;

    room.status = 'in_game';
    room.currentTurnIndex = 0;
    room.turnOrder = Array.from(room.players.keys());
    this.laughProcs.set(roomCode, new LaughProcessor());

    this.io.to(roomCode).emit('match_started', {
      turnOrder: room.turnOrder,
      room: roomManager.serialize(room),
    });

    this.startTurn(roomCode);
  }

  private activePlayers(roomCode: string): string[] {
    const room = roomManager.get(roomCode);
    if (!room) return [];
    return room.turnOrder.filter(id => !room.players.get(id)?.isEliminated);
  }

  private startTurn(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    // Advance past eliminated players
    const total = room.turnOrder.length;
    let attempts = 0;
    while (
      room.players.get(room.turnOrder[room.currentTurnIndex])?.isEliminated &&
      attempts++ < total
    ) {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % total;
    }

    const activeId = room.turnOrder[room.currentTurnIndex];
    this.io.to(roomCode).emit('turn_started', { playerId: activeId, durationMs: TURN_MS });

    const timer = setTimeout(() => this.endTurn(roomCode), TURN_MS);
    this.turnTimers.set(roomCode, timer);
  }

  endTurn(roomCode: string): void {
    clearTimeout(this.turnTimers.get(roomCode));
    this.turnTimers.delete(roomCode);

    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const endingId = room.turnOrder[room.currentTurnIndex];
    this.io.to(roomCode).emit('turn_ended', { playerId: endingId });

    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;

    if (this.activePlayers(roomCode).length <= 1) {
      this.endMatch(roomCode);
    } else {
      setTimeout(() => this.startTurn(roomCode), BETWEEN_MS);
    }
  }

  processLaugh(roomCode: string, laughingPlayerId: string, confidence: number): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const proc = this.laughProcs.get(roomCode);
    if (!proc?.shouldRegister(laughingPlayerId, confidence)) return;

    const player = room.players.get(laughingPlayerId);
    if (!player || player.isEliminated) return;

    player.livesRemaining  -= 1;
    player.laughsReceived  += 1;

    const activeId = room.turnOrder[room.currentTurnIndex];
    const attacker = room.players.get(activeId);
    if (attacker && activeId !== laughingPlayerId) attacker.laughsCaused += 1;

    this.io.to(roomCode).emit('laugh_detected', {
      playerId: laughingPlayerId,
      confidence,
      causedBy: activeId,
    });

    this.io.to(roomCode).emit('life_removed', {
      playerId: laughingPlayerId,
      livesRemaining: player.livesRemaining,
    });

    if (attacker) {
      this.io.to(roomCode).emit('score_updated', {
        playerId: activeId,
        laughsCaused: attacker.laughsCaused,
      });
    }

    if (player.livesRemaining <= 0) {
      player.isEliminated = true;
      this.io.to(roomCode).emit('player_eliminated', { playerId: laughingPlayerId });

      if (this.activePlayers(roomCode).length <= 1) {
        this.endMatch(roomCode);
      }
    }
  }

  private endMatch(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room) return;

    clearTimeout(this.turnTimers.get(roomCode));
    this.turnTimers.delete(roomCode);
    room.status = 'finished';

    const players = Array.from(room.players.values());
    const active   = this.activePlayers(roomCode);
    const winnerId = active[0] ?? null;

    const sorted = (key: keyof typeof players[0]) =>
      [...players].sort((a, b) => (b[key] as number) - (a[key] as number));

    this.io.to(roomCode).emit('match_finished', {
      winnerId,
      stats: {
        funniest:     sorted('laughsCaused')[0]?.userId ?? null,
        mostLaughed:  sorted('laughsReceived')[0]?.userId ?? null,
        leastLaughed: [...players].sort((a, b) => a.laughsReceived - b.laughsReceived)[0]?.userId ?? null,
        totalLaughs:  players.reduce((s, p) => s + p.laughsReceived, 0),
        players: players.map(({ userId, laughsCaused, laughsReceived, isEliminated }) =>
          ({ userId, laughsCaused, laughsReceived, isEliminated })),
      },
    });

    saveMatch(room, winnerId).catch(err => console.error('[persist]', err));
  }
}

export const matchEngine = new MatchEngine();
