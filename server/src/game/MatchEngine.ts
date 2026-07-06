import type { Server } from 'socket.io';
import { roomManager } from './RoomManager.js';
import { LaughProcessor } from './LaughProcessor.js';
import { saveMatch } from '../lib/matchPersistence.js';

/**
 * Match flow for the three game modes. All modes share the same core —
 * one active player per turn, laughs cost lives — but each runs its own
 * loop, tuned to feel fast with minimal downtime:
 *
 * CLASSIC ('casual'):
 *   countdown → spotlight turn (public) → whistle, 1.5s break → next
 *
 * WATER HOLD ('water_hold'):
 *   refill (fill your mouth!) → countdown → spotlight turn (public;
 *   opening your mouth = spilling = penalty) → short refill → next
 *
 * GUESS THE BITER ('guess_the_biter'):
 *   countdown → secret Biter performs (anonymous) → voting stage →
 *   votes revealed, penalties (caught Biter / wrong voters) → next
 */

const COUNTDOWN_MS      = 3_000;
const TURN_BREAK_MS     = 1_500;  // classic/water pause between turns
const REFILL_FIRST_MS   = 6_000;  // time to grab water at match start
const REFILL_BETWEEN_MS = 4_000;  // quick top-up between turns
const VOTING_MS         = 12_000;
const VOTES_REVEAL_MS   = 3_500;

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

type ViolationKind = 'laugh' | 'water';

export class MatchEngine {
  private io!: Server;
  private phaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private botTimers   = new Map<string, ReturnType<typeof setTimeout>>();
  private laughProcs  = new Map<string, LaughProcessor>();
  private activeTurns = new Map<string, string>();
  // Guess mode: votes for the current voting stage (voterId → targetId).
  private votes       = new Map<string, Map<string, string>>();
  private votingOpen  = new Set<string>();

  init(io: Server) { this.io = io; }

  private mode(roomCode: string): string {
    return roomManager.get(roomCode)?.gameMode ?? 'casual';
  }

  private setPhaseTimer(roomCode: string, ms: number, fn: () => void): void {
    clearTimeout(this.phaseTimers.get(roomCode));
    this.phaseTimers.set(roomCode, setTimeout(fn, ms));
  }

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

    if (this.mode(roomCode) === 'water_hold') {
      this.beginRefill(roomCode, true);
    } else {
      this.beginCountdown(roomCode);
    }
  }

  /** Play again with the same room and players — no lobby round-trip. */
  rematch(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'finished') return;

    for (const p of room.players.values()) {
      p.livesRemaining = room.livesCount;
      p.isEliminated = false;
      p.laughsCaused = 0;
      p.laughsReceived = 0;
    }
    room.status = 'lobby';
    this.startMatch(roomCode);
  }

  private beginCountdown(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    this.io.to(roomCode).emit('countdown_started', { seconds: COUNTDOWN_MS / 1000 });
    this.setPhaseTimer(roomCode, COUNTDOWN_MS, () => this.startTurn(roomCode));
  }

  private beginRefill(roomCode: string, first: boolean): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const ms = first ? REFILL_FIRST_MS : REFILL_BETWEEN_MS;
    this.io.to(roomCode).emit('refill_started', { seconds: ms / 1000 });
    // The first refill flows into the countdown; between-turn refills
    // jump straight to the next turn to keep the pace up.
    this.setPhaseTimer(roomCode, ms, () =>
      first ? this.beginCountdown(roomCode) : this.startTurn(roomCode)
    );
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

    if (this.mode(roomCode) === 'guess_the_biter') {
      // Secret Biter: the room only learns someone is performing.
      this.io.to(roomCode).emit('anonymous_turn_started', { durationMs: turnMs });
      if (!activePlayer?.isBot) {
        const activeSocket = this.getSocketId(roomCode, activeId);
        if (activeSocket) this.io.to(activeSocket).emit('your_turn', { durationMs: turnMs });
      }
    } else {
      // Classic / Water Hold: public spotlight on the active player.
      this.io.to(roomCode).emit('turn_started', { activePlayerId: activeId, durationMs: turnMs });
    }

    if (activePlayer?.isBot) {
      const delay = 1500 + Math.random() * 1500;
      const botPlay = setTimeout(() => {
        const bit = BOT_BITS[Math.floor(Math.random() * BOT_BITS.length)];
        this.playBit(roomCode, activeId, { mediaType: 'text', textContent: bit });
      }, delay);
      this.botTimers.set(roomCode, botPlay);
    }

    this.setPhaseTimer(roomCode, turnMs, () => this.endTurn(roomCode));
  }

  /**
   * The bot laughs in reaction to a bit — a short beat after it's
   * performed, 75% of the time.
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

  endTurn(roomCode: string): void {
    clearTimeout(this.phaseTimers.get(roomCode));
    clearTimeout(this.botTimers.get(roomCode));
    this.botTimers.delete(roomCode);

    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const endingId = this.activeTurns.get(roomCode);
    if (!endingId) return;

    if (this.mode(roomCode) === 'guess_the_biter') {
      // Keep the Biter secret — voting decides whether they're caught.
      this.beginVoting(roomCode);
      return;
    }

    // Classic / Water Hold: whistle, brief break, next spotlight.
    const player = room.players.get(endingId);
    this.io.to(roomCode).emit('turn_ended', { playerId: endingId, username: player?.username });

    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
    this.activeTurns.delete(roomCode);

    if (this.activePlayers(roomCode).length <= 1) {
      this.setPhaseTimer(roomCode, TURN_BREAK_MS, () => this.endMatch(roomCode));
    } else if (this.mode(roomCode) === 'water_hold') {
      this.setPhaseTimer(roomCode, TURN_BREAK_MS, () => this.beginRefill(roomCode, false));
    } else {
      this.setPhaseTimer(roomCode, TURN_BREAK_MS, () => this.startTurn(roomCode));
    }
  }

  /* ── Guess the Biter: voting stage ─────────────────────────── */

  private beginVoting(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room) return;

    this.votes.set(roomCode, new Map());
    this.votingOpen.add(roomCode);
    this.io.to(roomCode).emit('voting_started', { durationMs: VOTING_MS });

    // The bot votes too (badly) — a random other living player.
    const bot = Array.from(room.players.values()).find(p => p.isBot && !p.isEliminated);
    if (bot) {
      const options = this.activePlayers(roomCode).filter(id => id !== bot.userId);
      if (options.length > 0) {
        const pick = options[Math.floor(Math.random() * options.length)];
        const timer = setTimeout(() => {
          this.submitVote(roomCode, bot.userId, pick);
        }, 2_000 + Math.random() * 3_000);
        this.botTimers.set(roomCode, timer);
      }
    }

    this.setPhaseTimer(roomCode, VOTING_MS, () => this.finishVoting(roomCode));
  }

  submitVote(roomCode: string, voterId: string, targetId: string): void {
    if (!this.votingOpen.has(roomCode)) return;
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const voter = room.players.get(voterId);
    const target = room.players.get(targetId);
    if (!voter || voter.isEliminated || !target || target.isEliminated) return;
    if (voterId === targetId) return;

    const roomVotes = this.votes.get(roomCode);
    if (!roomVotes || roomVotes.has(voterId)) return;
    roomVotes.set(voterId, targetId);

    this.io.to(roomCode).emit('vote_cast', { voterId, votesIn: roomVotes.size });

    // Everyone alive has voted — reveal immediately, no waiting.
    if (roomVotes.size >= this.activePlayers(roomCode).length) {
      this.finishVoting(roomCode);
    }
  }

  private finishVoting(roomCode: string): void {
    if (!this.votingOpen.has(roomCode)) return;
    this.votingOpen.delete(roomCode);
    clearTimeout(this.phaseTimers.get(roomCode));
    clearTimeout(this.botTimers.get(roomCode));

    const room = roomManager.get(roomCode);
    const biterId = this.activeTurns.get(roomCode);
    if (!room || !biterId) return;

    const roomVotes = this.votes.get(roomCode) ?? new Map<string, string>();
    const entries = Array.from(roomVotes.entries())
      .filter(([voterId]) => voterId !== biterId) // the Biter's vote is pure bluff
      .map(([voterId, targetId]) => ({ voterId, targetId }));

    this.io.to(roomCode).emit('votes_revealed', {
      votes: Array.from(roomVotes.entries()).map(([voterId, targetId]) => ({ voterId, targetId })),
      biterId,
      username: room.players.get(biterId)?.username,
    });

    // Caught: any correct vote costs the Biter a life. Wrong voters pay.
    const caught = entries.some(v => v.targetId === biterId);
    if (caught) this.penalize(roomCode, biterId, 'caught');
    for (const v of entries) {
      if (v.targetId !== biterId) this.penalize(roomCode, v.voterId, 'wrong_guess');
    }

    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
    this.activeTurns.delete(roomCode);
    this.votes.delete(roomCode);

    if (this.activePlayers(roomCode).length <= 1) {
      this.setPhaseTimer(roomCode, VOTES_REVEAL_MS, () => this.endMatch(roomCode));
    } else {
      this.setPhaseTimer(roomCode, VOTES_REVEAL_MS, () => this.startTurn(roomCode));
    }
  }

  /** Deduct a life with a reason and handle elimination. */
  private penalize(roomCode: string, playerId: string, reason: string): void {
    const room = roomManager.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player || player.isEliminated) return;

    player.livesRemaining -= 1;
    this.io.to(roomCode).emit('life_removed', {
      playerId, livesRemaining: player.livesRemaining, reason,
    });
    if (player.livesRemaining <= 0) {
      player.isEliminated = true;
      this.io.to(roomCode).emit('player_eliminated', { playerId });
    }
  }

  processLaugh(roomCode: string, laughingPlayerId: string, confidence: number, kind: ViolationKind = 'laugh'): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const activeId = this.activeTurns.get(roomCode);
    if (!activeId) return;                       // no penalties between turns
    if (laughingPlayerId === activeId) return;   // the performer is immune

    const proc = this.laughProcs.get(roomCode);
    if (!proc?.shouldRegister(laughingPlayerId, confidence)) return;

    const player = room.players.get(laughingPlayerId);
    if (!player || player.isEliminated) return;

    player.livesRemaining -= 1;
    player.laughsReceived += 1;

    const attacker = room.players.get(activeId);
    if (attacker) attacker.laughsCaused += 1;

    const reason = kind === 'water' ? 'spilled' : 'laughed';
    this.io.to(roomCode).emit('laugh_detected', { playerId: laughingPlayerId, confidence });
    this.io.to(roomCode).emit('life_removed', { playerId: laughingPlayerId, livesRemaining: player.livesRemaining, reason });

    if (player.livesRemaining <= 0) {
      player.isEliminated = true;
      this.io.to(roomCode).emit('player_eliminated', { playerId: laughingPlayerId });
      if (this.activePlayers(roomCode).length <= 1) this.endMatch(roomCode);
    }
  }

  private endMatch(roomCode: string): void {
    clearTimeout(this.phaseTimers.get(roomCode));
    this.phaseTimers.delete(roomCode);
    clearTimeout(this.botTimers.get(roomCode));
    this.botTimers.delete(roomCode);
    this.votingOpen.delete(roomCode);
    this.votes.delete(roomCode);

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
