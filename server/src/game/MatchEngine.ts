import type { Server } from 'socket.io';
import { roomManager } from './RoomManager.js';
import { LaughProcessor } from './LaughProcessor.js';
import { saveMatch } from '../lib/matchPersistence.js';

const TURN_MS    = 20_000;
const REVEAL_MS  = 5_000;
const BETWEEN_MS = 2_000;

export class MatchEngine {
  private io!: Server;
  private turnTimers   = new Map<string, ReturnType<typeof setTimeout>>();
  private laughProcs   = new Map<string, LaughProcessor>();
  private activeTurns  = new Map<string, string>(); // roomCode → active userId

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
    this.activeTurns.set(roomCode, activeId);

    // Tell everyone a turn started — identity hidden
    this.io.to(roomCode).emit('anonymous_turn_started', { durationMs: TURN_MS });

    // Tell only the active player it's their turn (private)
    const activeSocket = this.getSocketId(roomCode, activeId);
    if (activeSocket) {
      this.io.to(activeSocket).emit('your_turn', { durationMs: TURN_MS });
    }

    const timer = setTimeout(() => this.endTurn(roomCode), TURN_MS);
    this.turnTimers.set(roomCode, timer);
  }

  // Active player plays a bit — broadcast content but not identity
  playBit(roomCode: string, userId: string, bit: { mediaType: string; mediaUrl?: string; textContent?: string; title?: string }): void {
    const activeId = this.activeTurns.get(roomCode);
    if (activeId !== userId) return;

    this.io.to(roomCode).emit('bit_played', {
      mediaType:   bit.mediaType,
      mediaUrl:    bit.mediaUrl,
      textContent: bit.textContent,
      title:       bit.title,
    });
  }

  // A player guesses who played the bit
  submitGuess(roomCode: string, guesserId: string, targetId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const activeId = this.activeTurns.get(roomCode);
    if (!activeId || guesserId === activeId) return; // can't guess your own turn

    const correct = targetId === activeId;
    const guesser = room.players.get(guesserId);
    const target  = room.players.get(activeId);

    if (correct && target) {
      // Caught! Active player loses a life
      target.livesRemaining -= 1;

      this.io.to(roomCode).emit('guess_result', {
        guesserId,
        targetId,
        correct: true,
        revealedId: activeId,
      });

      this.io.to(roomCode).emit('life_removed', {
        playerId: activeId,
        livesRemaining: target.livesRemaining,
        reason: 'caught',
      });

      if (target.livesRemaining <= 0) {
        target.isEliminated = true;
        this.io.to(roomCode).emit('player_eliminated', { playerId: activeId });
      }

      // End turn immediately after being caught
      this.endTurn(roomCode);
    } else if (guesser) {
      // Wrong guess — guesser loses a life
      guesser.livesRemaining -= 1;

      this.io.to(roomCode).emit('guess_result', {
        guesserId,
        targetId,
        correct: false,
      });

      this.io.to(roomCode).emit('life_removed', {
        playerId: guesserId,
        livesRemaining: guesser.livesRemaining,
        reason: 'wrong_guess',
      });

      if (guesser.livesRemaining <= 0) {
        guesser.isEliminated = true;
        this.io.to(roomCode).emit('player_eliminated', { playerId: guesserId });
      }

      if (this.activePlayers(roomCode).length <= 1) {
        this.endMatch(roomCode);
      }
    }
  }

  endTurn(roomCode: string): void {
    clearTimeout(this.turnTimers.get(roomCode));
    this.turnTimers.delete(roomCode);

    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const endingId = this.activeTurns.get(roomCode);
    if (!endingId) return;

    // Reveal who played the bit
    const player = room.players.get(endingId);
    this.io.to(roomCode).emit('turn_revealed', {
      playerId: endingId,
      username: player?.username,
    });

    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
    this.activeTurns.delete(roomCode);

    if (this.activePlayers(roomCode).length <= 1) {
      setTimeout(() => this.endMatch(roomCode), REVEAL_MS);
    } else {
      setTimeout(() => this.startTurn(roomCode), REVEAL_MS + BETWEEN_MS);
    }
  }

  // Active player is invincible — laughing only costs non-active players
  processLaugh(roomCode: string, laughingPlayerId: string, confidence: number): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const activeId = this.activeTurns.get(roomCode);

    // Active player is invincible during their turn
    if (laughingPlayerId === activeId) return;

    const proc = this.laughProcs.get(roomCode);
    if (!proc?.shouldRegister(laughingPlayerId, confidence)) return;

    const player = room.players.get(laughingPlayerId);
    if (!player || player.isEliminated) return;

    player.livesRemaining  -= 1;
    player.laughsReceived  += 1;

    if (activeId) {
      const attacker = room.players.get(activeId);
      if (attacker) attacker.laughsCaused += 1;
    }

    this.io.to(roomCode).emit('laugh_detected', { playerId: laughingPlayerId, confidence });
    this.io.to(roomCode).emit('life_removed', {
      playerId: laughingPlayerId,
      livesRemaining: player.livesRemaining,
      reason: 'laughed',
    });

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
    this.activeTurns.delete(roomCode);
    room.status = 'finished';

    const players  = Array.from(room.players.values());
    const active   = this.activePlayers(roomCode);
    const winnerId = active[0] ?? null;

    const sorted = (key: keyof typeof players[0]) =>
      [...players].sort((a, b) => (b[key] as number) - (a[key] as number));

    this.io.to(roomCode).emit('match_finished', {
      winnerId,
      stats: {
        funniest:     sorted('laughsCaused')[0]?.userId    ?? null,
        mostLaughed:  sorted('laughsReceived')[0]?.userId  ?? null,
        leastLaughed: [...players].sort((a, b) => a.laughsReceived - b.laughsReceived)[0]?.userId ?? null,
        totalLaughs:  players.reduce((s, p) => s + p.laughsReceived, 0),
        players: players.map(({ userId, laughsCaused, laughsReceived, isEliminated }) =>
          ({ userId, laughsCaused, laughsReceived, isEliminated })),
      },
    });

    saveMatch(room, winnerId).catch(err => console.error('[persist]', err));
  }

  private getSocketId(roomCode: string, userId: string): string | undefined {
    const room = roomManager.get(roomCode);
    return room?.players.get(userId)?.socketId;
  }
}

export const matchEngine = new MatchEngine();
