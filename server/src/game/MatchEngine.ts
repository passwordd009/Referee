import type { Server } from 'socket.io';
import { roomManager } from './RoomManager.js';
import { LaughProcessor } from './LaughProcessor.js';
import { saveMatch } from '../lib/matchPersistence.js';

const REVEAL_MS  = 4_000;
const BETWEEN_MS = 2_000;

const BOT_BITS = [
  "I asked my dog what two minus two is. He said nothing.",
  "Why do cows wear bells? Because their horns don't work.",
  "I told my doctor I broke my arm in two places. He told me to stop going to those places.",
  "I used to hate facial hair, but then it grew on me.",
  "I'm on a seafood diet. I see food and I eat it.",
  "Why don't scientists trust atoms? Because they make up everything.",
  "I would tell you a construction joke but I'm still working on it.",
  "The librarian asked if I needed help finding anything. I said, 'Just my will to live.'",
  "My wife told me to stop acting like a flamingo. I had to put my foot down.",
  "I told my boss I needed a raise because three companies were after me. He asked which ones. I said, 'The gas, electric, and water company.'",
  "I'm writing a book on reverse psychology. Please don't buy it.",
  "A skeleton walks into a bar and says, 'I'll have a beer and a mop.'",
];

export class MatchEngine {
  private io!: Server;
  private turnTimers  = new Map<string, ReturnType<typeof setTimeout>>();
  private botTimers   = new Map<string, ReturnType<typeof setTimeout>>();
  private laughProcs  = new Map<string, LaughProcessor>();
  private activeTurns = new Map<string, string>();

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
    const activePlayer = room.players.get(activeId);
    const turnMs = (room.turnTimeSecs ?? 20) * 1000;

    this.io.to(roomCode).emit('anonymous_turn_started', { durationMs: turnMs });

    if (activePlayer?.isBot) {
      // Bot auto-plays a random bit after 1.5–3s
      const delay = 1500 + Math.random() * 1500;
      const botPlay = setTimeout(() => {
        const bit = BOT_BITS[Math.floor(Math.random() * BOT_BITS.length)];
        this.playBit(roomCode, activeId, { mediaType: 'text', textContent: bit });
      }, delay);
      this.botTimers.set(roomCode, botPlay);
    } else {
      // Tell only the active human player it's their turn. The bot
      // reacts when they actually play a bit (see playBit).
      const activeSocket = this.getSocketId(roomCode, activeId);
      if (activeSocket) {
        this.io.to(activeSocket).emit('your_turn', { durationMs: turnMs });
      }
    }

    const timer = setTimeout(() => this.endTurn(roomCode), turnMs);
    this.turnTimers.set(roomCode, timer);
  }

  /**
   * The bot laughs in reaction to a bit — a short beat after it's
   * performed, 75% of the time. (It used to roll a 40% chance at turn
   * start and could "laugh" before any bit was played, which mostly
   * looked like it never laughed at all.)
   */
  private scheduleBotLaughAtBit(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room) return;
    const bot = Array.from(room.players.values()).find(p => p.isBot && !p.isEliminated);
    if (!bot) return;
    if (Math.random() > 0.75) return;

    const delay = 1_500 + Math.random() * 3_500; // read the joke, then crack
    const timer = setTimeout(() => {
      this.processLaugh(roomCode, bot.userId, 0.75 + Math.random() * 0.25);
    }, delay);
    this.botTimers.set(roomCode, timer);
  }

  playBit(roomCode: string, userId: string, bit: {
    mediaType: string;
    mediaUrl?: string;
    textContent?: string;
    title?: string;
  }): void {
    const activeId = this.activeTurns.get(roomCode);
    if (activeId !== userId) return;

    this.io.to(roomCode).emit('bit_played', {
      mediaType:   bit.mediaType,
      mediaUrl:    bit.mediaUrl,
      textContent: bit.textContent,
      title:       bit.title,
    });

    // A human performed — give the bot a chance to break.
    const performer = roomManager.get(roomCode)?.players.get(userId);
    if (performer && !performer.isBot) {
      this.scheduleBotLaughAtBit(roomCode);
    }
  }

  /** A player voluntarily leaves the match: they forfeit and are out. */
  leaveMatch(roomCode: string, userId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const player = room.players.get(userId);
    if (!player || player.isEliminated) return;

    player.isEliminated = true;
    player.livesRemaining = 0;
    this.io.to(roomCode).emit('player_eliminated', { playerId: userId, reason: 'left' });

    if (this.activeTurns.get(roomCode) === userId) {
      this.endTurn(roomCode);
    } else if (this.activePlayers(roomCode).length <= 1) {
      this.endMatch(roomCode);
    }
  }

  submitGuess(roomCode: string, guesserId: string, targetId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const activeId = this.activeTurns.get(roomCode);
    if (!activeId || guesserId === activeId) return;

    const correct = targetId === activeId;
    const guesser = room.players.get(guesserId);
    const target  = room.players.get(activeId);

    if (correct && target) {
      target.livesRemaining -= 1;
      this.io.to(roomCode).emit('guess_result', { guesserId, targetId, correct: true, revealedId: activeId });
      this.io.to(roomCode).emit('life_removed', { playerId: activeId, livesRemaining: target.livesRemaining, reason: 'caught' });

      if (target.livesRemaining <= 0) {
        target.isEliminated = true;
        this.io.to(roomCode).emit('player_eliminated', { playerId: activeId });
      }
      this.endTurn(roomCode);
    } else if (guesser) {
      guesser.livesRemaining -= 1;
      this.io.to(roomCode).emit('guess_result', { guesserId, targetId, correct: false });
      this.io.to(roomCode).emit('life_removed', { playerId: guesserId, livesRemaining: guesser.livesRemaining, reason: 'wrong_guess' });

      if (guesser.livesRemaining <= 0) {
        guesser.isEliminated = true;
        this.io.to(roomCode).emit('player_eliminated', { playerId: guesserId });
      }

      if (this.activePlayers(roomCode).length <= 1) this.endMatch(roomCode);
    }
  }

  endTurn(roomCode: string): void {
    clearTimeout(this.turnTimers.get(roomCode));
    this.turnTimers.delete(roomCode);
    clearTimeout(this.botTimers.get(roomCode));
    this.botTimers.delete(roomCode);

    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const endingId = this.activeTurns.get(roomCode);
    if (!endingId) return;

    const player = room.players.get(endingId);
    this.io.to(roomCode).emit('turn_revealed', { playerId: endingId, username: player?.username });

    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
    this.activeTurns.delete(roomCode);

    if (this.activePlayers(roomCode).length <= 1) {
      setTimeout(() => this.endMatch(roomCode), REVEAL_MS);
    } else {
      setTimeout(() => this.startTurn(roomCode), REVEAL_MS + BETWEEN_MS);
    }
  }

  processLaugh(roomCode: string, laughingPlayerId: string, confidence: number): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const activeId = this.activeTurns.get(roomCode);
    if (laughingPlayerId === activeId) return; // active player is invincible

    const proc = this.laughProcs.get(roomCode);
    if (!proc?.shouldRegister(laughingPlayerId, confidence)) return;

    const player = room.players.get(laughingPlayerId);
    if (!player || player.isEliminated) return;

    player.livesRemaining -= 1;
    player.laughsReceived += 1;

    if (activeId) {
      const attacker = room.players.get(activeId);
      if (attacker) attacker.laughsCaused += 1;
    }

    this.io.to(roomCode).emit('laugh_detected', { playerId: laughingPlayerId, confidence });
    this.io.to(roomCode).emit('life_removed', { playerId: laughingPlayerId, livesRemaining: player.livesRemaining, reason: 'laughed' });

    if (player.livesRemaining <= 0) {
      player.isEliminated = true;
      this.io.to(roomCode).emit('player_eliminated', { playerId: laughingPlayerId });
      if (this.activePlayers(roomCode).length <= 1) this.endMatch(roomCode);
    }
  }

  private endMatch(roomCode: string): void {
    clearTimeout(this.turnTimers.get(roomCode));
    this.turnTimers.delete(roomCode);
    clearTimeout(this.botTimers.get(roomCode));
    this.botTimers.delete(roomCode);

    const room = roomManager.get(roomCode);
    if (!room) return;

    this.activeTurns.delete(roomCode);
    room.status = 'finished';

    const players  = Array.from(room.players.values());
    const active   = this.activePlayers(roomCode);
    const winnerId = active[0] ?? null;

    const sorted = (key: 'laughsCaused' | 'laughsReceived') =>
      [...players].sort((a, b) => b[key] - a[key]);

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

    // Persist stats and award XP/tickets, then tell the room what
    // everyone earned (client shows it on the results screen).
    saveMatch(room, winnerId)
      .then(rewards => {
        if (rewards.length > 0) {
          this.io.to(roomCode).emit('match_rewards', { rewards });
        }
      })
      .catch(err => console.error('[persist]', err));
  }

  private getSocketId(roomCode: string, userId: string): string | undefined {
    return roomManager.get(roomCode)?.players.get(userId)?.socketId;
  }
}

export const matchEngine = new MatchEngine();
