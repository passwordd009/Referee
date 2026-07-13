import type { Server } from 'socket.io';
import { roomManager } from './RoomManager.js';
import type { Room } from './RoomManager.js';
import { LaughProcessor } from './LaughProcessor.js';
import { saveMatch } from '../lib/matchPersistence.js';
import {
  ROUND_TYPES, type RoundType,
  SOUNDS, ITEMS, SENTENCES, VOICES, pick, shuffle,
} from './roundContent.js';

/**
 * Classic Mode — the only game mode. A match is a series of rotating
 * mini-rounds. Roles spice it up:
 *
 *   JESTER    — picks the next round type; loses a life if a round they
 *               perform makes nobody laugh.
 *   SABOTEUR  — secret; can fire soundboard sounds any time (cooldown).
 *               Caught in an Accusation Round → loses ALL lives.
 *   DETECTIVE — can call up to 3 discussions; runs Accusation Rounds.
 *               If eliminated, accusations are skipped.
 *
 * Round types: match_the_sound, guess_the_item, fill_blank, accusation.
 * Endgame: when few players remain, SUDDEN DEATH — no turns, no
 * immunity, everyone gets the soundboard, one laugh = elimination.
 */

const ROLE_REVEAL_MS   = 4_000;
const SELECT_MS        = 8_000;   // jester's window to pick a round
const SELECT_GAP_MS    = 1_500;   // pause before auto-pick / round start
const PERFORM_MS       = 20_000;  // match_the_sound / fill_blank
const GUESS_ITEM_MS    = 45_000;  // guess_the_item input window
const ACCUSE_MS        = 25_000;  // detective's decision window
const BREAK_MS         = 2_500;   // between rounds
const DISCUSSION_MS    = 20_000;
const SOUND_COOLDOWN_MS = 8_000;
const SUDDEN_DEATH_CAP_MS = 180_000; // safety: end SD after 3 minutes

export class MatchEngine {
  private io!: Server;
  private phaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private laughProcs  = new Map<string, LaughProcessor>();
  /** Current performer (immune to laugh penalties outside Sudden Death). */
  private performers  = new Map<string, string>();
  private roundActive = new Set<string>();
  private selectionOpen = new Set<string>();
  /** Jester performed this round and hasn't caused a laugh yet. */
  private jesterOnTheHook = new Set<string>();
  private itemGuesses = new Map<string, Map<string, string>>();
  private currentItem = new Map<string, { item: string; hint: string }>();
  private accusationOpen = new Set<string>();
  private soundCooldowns = new Map<string, Map<string, number>>();
  private pendingDiscussion = new Set<string>();
  private inDiscussion = new Set<string>();

  init(io: Server) { this.io = io; }

  /** Referee/system line in the room chat. */
  private sys(roomCode: string, text: string): void {
    this.io.to(roomCode).emit('system_message', { text, ts: Date.now() });
  }

  private setPhaseTimer(roomCode: string, ms: number, fn: () => void): void {
    clearTimeout(this.phaseTimers.get(roomCode));
    this.phaseTimers.set(roomCode, setTimeout(fn, ms));
  }

  private alivePlayers(roomCode: string): string[] {
    const room = roomManager.get(roomCode);
    if (!room) return [];
    return room.turnOrder.filter(id => !room.players.get(id)?.isEliminated);
  }

  private getSocketId(roomCode: string, userId: string): string | undefined {
    return roomManager.get(roomCode)?.players.get(userId)?.socketId;
  }

  /* ── Match lifecycle ───────────────────────────────────── */

  startMatch(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'lobby') return;

    room.status = 'in_game';
    room.currentTurnIndex = 0;
    room.currentRoundIndex = 0;
    room.currentRoundType = null;
    room.suddenDeathActive = false;
    room.turnOrder = Array.from(room.players.keys());
    this.laughProcs.set(roomCode, new LaughProcessor());
    this.soundCooldowns.set(roomCode, new Map());
    this.jesterOnTheHook.delete(roomCode);
    this.pendingDiscussion.delete(roomCode);
    this.inDiscussion.delete(roomCode);

    this.assignRoles(room);

    this.io.to(roomCode).emit('match_started', {
      turnOrder: room.turnOrder,
      room: roomManager.serialize(room),
    });

    // Public roles: Jester & Detective. The Saboteur stays secret.
    this.io.to(roomCode).emit('roles_assigned', {
      jesterPlayerId:    room.jesterPlayerId,
      detectivePlayerId: room.detectivePlayerId,
    });
    for (const p of room.players.values()) {
      this.io.to(p.socketId).emit('role_revealed_to_player', {
        role: p.role,
        discussionsRemaining: p.discussionsRemaining,
      });
    }

    this.sys(roomCode, 'Match started — roles have been assigned.');
    const jester = room.jesterPlayerId ? room.players.get(room.jesterPlayerId) : null;
    if (jester) this.sys(roomCode, `${jester.username} is the Jester and picks the rounds.`);
    const det = room.detectivePlayerId ? room.players.get(room.detectivePlayerId) : null;
    if (det) this.sys(roomCode, `${det.username} is the Detective.`);

    this.setPhaseTimer(roomCode, ROLE_REVEAL_MS, () => this.beginRoundSelection(roomCode));
  }

  private assignRoles(room: Room): void {
    const ids = shuffle(Array.from(room.players.keys()));
    room.jesterPlayerId    = ids[0] ?? null;
    room.saboteurPlayerId  = ids[1] ?? null;                 // 2+ players
    room.detectivePlayerId = ids.length >= 3 ? ids[2] : null; // 3+ players

    for (const p of room.players.values()) {
      p.role = 'regular';
      p.discussionsRemaining = 0;
      if (p.userId === room.jesterPlayerId)    p.role = 'jester';
      if (p.userId === room.saboteurPlayerId)  p.role = 'saboteur';
      if (p.userId === room.detectivePlayerId) {
        p.role = 'detective';
        p.discussionsRemaining = 3;
      }
    }
  }

  /** Play again with the same room and players. */
  rematch(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'finished') return;

    for (const p of room.players.values()) {
      p.livesRemaining = room.livesCount;
      p.isEliminated = false;
      p.laughsCaused = 0;
      p.laughsReceived = 0;
      p.role = 'regular';
      p.discussionsRemaining = 0;
    }
    room.status = 'lobby';
    this.startMatch(roomCode);
  }

  /* ── Round selection (Jester's power) ──────────────────── */

  private availableRounds(room: Room): RoundType[] {
    const rounds: RoundType[] = ['match_the_sound', 'guess_the_item', 'fill_blank'];
    const detAlive = !!room.detectivePlayerId && !room.players.get(room.detectivePlayerId)?.isEliminated;
    const sabAlive = !!room.saboteurPlayerId  && !room.players.get(room.saboteurPlayerId)?.isEliminated;
    // Accusation needs a living Detective AND an uncaught Saboteur;
    // if the Detective is eliminated the round is skipped entirely.
    if (detAlive && sabAlive) rounds.push('accusation');
    return rounds;
  }

  private beginRoundSelection(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    // Sudden Death is self-driving — no more round selection.
    if (room.suddenDeathActive) return;

    if (this.checkEnd(roomCode)) return;

    // A queued Detective discussion runs between rounds.
    if (this.pendingDiscussion.has(roomCode)) {
      this.pendingDiscussion.delete(roomCode);
      this.runDiscussion(roomCode);
      return;
    }

    // Endgame → Sudden Death (after at least 2 normal rounds).
    if (!room.suddenDeathActive &&
        this.alivePlayers(roomCode).length <= 2 &&
        room.currentRoundIndex >= 2) {
      this.startSuddenDeath(roomCode);
      return;
    }

    const options = this.availableRounds(room);
    const jesterAlive = !!room.jesterPlayerId && !room.players.get(room.jesterPlayerId)?.isEliminated;

    if (jesterAlive) {
      this.selectionOpen.add(roomCode);
      this.io.to(roomCode).emit('round_selection_started', {
        jesterPlayerId: room.jesterPlayerId,
        durationMs: SELECT_MS,
      });
      const jesterSocket = this.getSocketId(roomCode, room.jesterPlayerId!);
      if (jesterSocket) {
        this.io.to(jesterSocket).emit('choose_round', { options, durationMs: SELECT_MS });
      }
      // Jester dawdles → server picks.
      this.setPhaseTimer(roomCode, SELECT_MS, () => {
        this.selectionOpen.delete(roomCode);
        this.startRound(roomCode, pick(options), false);
      });
    } else {
      this.setPhaseTimer(roomCode, SELECT_GAP_MS, () =>
        this.startRound(roomCode, pick(options), false));
    }
  }

  selectRound(roomCode: string, userId: string, type: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    if (!this.selectionOpen.has(roomCode)) return;
    if (userId !== room.jesterPlayerId) return;
    const options = this.availableRounds(room);
    if (!options.includes(type as RoundType)) return;

    this.selectionOpen.delete(roomCode);
    this.startRound(roomCode, type as RoundType, true);
  }

  /* ── Rounds ────────────────────────────────────────────── */

  /** Advance the rotation to the next living player and return them. */
  private nextPerformer(room: Room): string | null {
    const total = room.turnOrder.length;
    if (total === 0) return null;
    for (let i = 0; i < total; i++) {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % total;
      const id = room.turnOrder[room.currentTurnIndex];
      if (id && !room.players.get(id)?.isEliminated) return id;
    }
    return null;
  }

  private startRound(roomCode: string, type: RoundType, byJester: boolean): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    room.currentRoundIndex += 1;
    room.currentRoundType = type;
    this.roundActive.add(roomCode);
    this.jesterOnTheHook.delete(roomCode);

    this.io.to(roomCode).emit('round_selected', {
      type,
      roundIndex: room.currentRoundIndex,
      chosenByJester: byJester,
    });

    switch (type) {
      case 'match_the_sound': {
        const performerId = this.nextPerformer(room);
        if (!performerId) return void this.endRound(roomCode);
        this.performers.set(roomCode, performerId);
        if (performerId === room.jesterPlayerId) this.jesterOnTheHook.add(roomCode);
        const sound = pick(SOUNDS);
        const performer = room.players.get(performerId);
        this.sys(roomCode, `Round ${room.currentRoundIndex}: Match the Sound — ${performer?.username} must imitate "${sound.label}".`);
        this.io.to(roomCode).emit('round_started', {
          type, performerId,
          soundId: sound.id, soundLabel: sound.label,
          durationMs: PERFORM_MS,
        });
        this.setPhaseTimer(roomCode, PERFORM_MS, () => this.endRound(roomCode));
        break;
      }

      case 'fill_blank': {
        const performerId = this.nextPerformer(room);
        if (!performerId) return void this.endRound(roomCode);
        this.performers.set(roomCode, performerId);
        if (performerId === room.jesterPlayerId) this.jesterOnTheHook.add(roomCode);
        const sentence = pick(SENTENCES);
        const voice = pick(VOICES);
        const performer = room.players.get(performerId);
        this.sys(roomCode, `Round ${room.currentRoundIndex}: Fill in the Blank — ${performer?.username} performs as "${voice}".`);
        this.io.to(roomCode).emit('round_started', {
          type, performerId, sentence, voice,
          durationMs: PERFORM_MS,
        });
        this.setPhaseTimer(roomCode, PERFORM_MS, () => this.endRound(roomCode));
        break;
      }

      case 'guess_the_item': {
        // No performer — everyone guesses, everyone is laughable.
        this.performers.delete(roomCode);
        const entry = pick(ITEMS);
        this.currentItem.set(roomCode, entry);
        this.itemGuesses.set(roomCode, new Map());
        this.sys(roomCode, `Round ${room.currentRoundIndex}: Guess the Item — submit your guess!`);
        this.io.to(roomCode).emit('round_started', {
          type, hint: entry.hint,
          durationMs: GUESS_ITEM_MS,
        });
        this.setPhaseTimer(roomCode, GUESS_ITEM_MS, () => this.endRound(roomCode));
        break;
      }

      case 'accusation': {
        this.performers.delete(roomCode);
        this.accusationOpen.add(roomCode);
        const det = room.players.get(room.detectivePlayerId!);
        this.sys(roomCode, `Round ${room.currentRoundIndex}: Accusation — ${det?.username} is deciding who the Saboteur is…`);
        this.io.to(roomCode).emit('round_started', {
          type, detectivePlayerId: room.detectivePlayerId,
          durationMs: ACCUSE_MS,
        });
        this.setPhaseTimer(roomCode, ACCUSE_MS, () => {
          if (this.accusationOpen.delete(roomCode)) {
            this.io.to(roomCode).emit('detective_guess_result', {
              guessed: false, correct: false, targetId: null, saboteurPlayerId: null,
            });
            this.sys(roomCode, 'The Detective stayed silent. No accusation made.');
          }
          this.endRound(roomCode);
        });
        break;
      }
    }
  }

  submitItemGuess(roomCode: string, userId: string, guess: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    if (room.currentRoundType !== 'guess_the_item' || !this.roundActive.has(roomCode)) return;
    const player = room.players.get(userId);
    if (!player || player.isEliminated) return;

    const guesses = this.itemGuesses.get(roomCode);
    if (!guesses || guesses.has(userId)) return;
    guesses.set(userId, guess.trim().slice(0, 100));

    const alive = this.alivePlayers(roomCode);
    this.io.to(roomCode).emit('item_guess_progress', {
      submitted: guesses.size, total: alive.length,
    });
    // Everyone's in → reveal early.
    if (guesses.size >= alive.length) this.endRound(roomCode);
  }

  detectiveGuess(roomCode: string, userId: string, targetId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    if (!this.accusationOpen.has(roomCode)) return;
    if (userId !== room.detectivePlayerId) return;
    if (!room.players.has(targetId) || targetId === userId) return;

    this.accusationOpen.delete(roomCode);
    const correct = targetId === room.saboteurPlayerId;
    const target = room.players.get(targetId);

    if (correct && target) {
      // Caught: the Saboteur loses ALL remaining lives.
      target.livesRemaining = 0;
      target.isEliminated = true;
      this.io.to(roomCode).emit('detective_guess_result', {
        guessed: true, correct: true, targetId,
        saboteurPlayerId: room.saboteurPlayerId,
      });
      this.io.to(roomCode).emit('saboteur_caught', { saboteurPlayerId: targetId });
      this.io.to(roomCode).emit('life_removed', {
        playerId: targetId, livesRemaining: 0, reason: 'saboteur_caught',
      });
      this.io.to(roomCode).emit('player_eliminated', { playerId: targetId });
      this.sys(roomCode, `🕵️ The Detective was RIGHT — ${target.username} was the Saboteur! All lives lost.`);
    } else {
      // MVP balance: no penalty for a wrong accusation.
      this.io.to(roomCode).emit('detective_guess_result', {
        guessed: true, correct: false, targetId, saboteurPlayerId: null,
      });
      this.sys(roomCode, `The Detective accused ${target?.username ?? 'someone'}… and was wrong.`);
    }

    this.setPhaseTimer(roomCode, 2_000, () => this.endRound(roomCode));
  }

  /** Performer may end their own round early. */
  endRoundEarly(roomCode: string, userId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    if (this.performers.get(roomCode) !== userId) return;
    this.endRound(roomCode);
  }

  private endRound(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    if (!this.roundActive.delete(roomCode)) return;
    clearTimeout(this.phaseTimers.get(roomCode));
    this.accusationOpen.delete(roomCode);

    // Guess-the-item reveal.
    if (room.currentRoundType === 'guess_the_item') {
      const entry = this.currentItem.get(roomCode);
      const guesses = this.itemGuesses.get(roomCode) ?? new Map<string, string>();
      this.io.to(roomCode).emit('item_guesses_revealed', {
        item: entry?.item ?? '???',
        guesses: Array.from(guesses.entries()).map(([uid, guess]) => ({
          userId: uid,
          username: room.players.get(uid)?.username ?? '??',
          guess,
        })),
      });
      if (entry) this.sys(roomCode, `The item was: ${entry.item}`);
      this.currentItem.delete(roomCode);
      this.itemGuesses.delete(roomCode);
    }

    // Jester flopped: performed a round and nobody laughed.
    if (this.jesterOnTheHook.delete(roomCode) && room.jesterPlayerId) {
      const jester = room.players.get(room.jesterPlayerId);
      if (jester && !jester.isEliminated) {
        jester.livesRemaining -= 1;
        this.io.to(roomCode).emit('life_removed', {
          playerId: jester.userId,
          livesRemaining: jester.livesRemaining,
          reason: 'jester_flop',
        });
        this.sys(roomCode, `🃏 ${jester.username} made nobody laugh — the Jester loses a life.`);
        if (jester.livesRemaining <= 0) {
          jester.isEliminated = true;
          this.io.to(roomCode).emit('player_eliminated', { playerId: jester.userId });
          this.sys(roomCode, `${jester.username} was eliminated.`);
        }
      }
    }

    this.performers.delete(roomCode);
    this.io.to(roomCode).emit('round_ended', { roundIndex: room.currentRoundIndex });
    room.currentRoundType = null;

    if (this.checkEnd(roomCode)) return;
    this.setPhaseTimer(roomCode, BREAK_MS, () => this.beginRoundSelection(roomCode));
  }

  /* ── Detective: discussion ─────────────────────────────── */

  activateDiscussion(roomCode: string, userId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    if (room.suddenDeathActive) return; // no pausing the finale
    if (userId !== room.detectivePlayerId) return;
    const det = room.players.get(userId);
    if (!det || det.isEliminated || det.discussionsRemaining <= 0) return;
    if (this.inDiscussion.has(roomCode) || this.pendingDiscussion.has(roomCode)) return;

    det.discussionsRemaining -= 1;

    if (this.roundActive.has(roomCode)) {
      // Mid-round: queue it for the next break.
      this.pendingDiscussion.add(roomCode);
      this.sys(roomCode, `🕵️ The Detective called a discussion — it starts after this round. (${det.discussionsRemaining} left)`);
      this.io.to(roomCode).emit('discussion_queued', {
        discussionsRemaining: det.discussionsRemaining,
      });
    } else {
      this.runDiscussion(roomCode);
    }
  }

  private runDiscussion(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    const det = room.detectivePlayerId ? room.players.get(room.detectivePlayerId) : null;

    this.inDiscussion.add(roomCode);
    this.sys(roomCode, '🕵️ Discussion time — talk it out. Who is the Saboteur?');
    this.io.to(roomCode).emit('discussion_started', {
      durationMs: DISCUSSION_MS,
      discussionsRemaining: det?.discussionsRemaining ?? 0,
    });
    this.setPhaseTimer(roomCode, DISCUSSION_MS, () => {
      this.inDiscussion.delete(roomCode);
      this.io.to(roomCode).emit('discussion_ended', {});
      this.beginRoundSelection(roomCode);
    });
  }

  /* ── Soundboard (Saboteur always; everyone in Sudden Death) ─ */

  playSound(roomCode: string, userId: string, soundId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    const player = room.players.get(userId);
    if (!player || player.isEliminated) return;

    const allowed = room.suddenDeathActive || player.role === 'saboteur';
    if (!allowed) return;
    if (!SOUNDS.some(s => s.id === soundId)) return;

    const cooldowns = this.soundCooldowns.get(roomCode) ?? new Map<string, number>();
    this.soundCooldowns.set(roomCode, cooldowns);
    const last = cooldowns.get(userId) ?? 0;
    const now = Date.now();
    if (now - last < SOUND_COOLDOWN_MS) return;
    cooldowns.set(userId, now);

    // Anonymous on purpose — nobody learns who fired it.
    this.io.to(roomCode).emit('saboteur_sound_played', { soundId });
  }

  /* ── Bits ──────────────────────────────────────────────── */

  playBit(roomCode: string, userId: string, bit: {
    mediaType: string;
    mediaUrl?: string;
    textContent?: string;
    title?: string;
  }): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    // Normal rounds: only the performer. Sudden Death: free-for-all.
    if (!room.suddenDeathActive && this.performers.get(roomCode) !== userId) return;
    const player = room.players.get(userId);
    if (!player || player.isEliminated) return;

    this.io.to(roomCode).emit('bit_played', {
      mediaType:   bit.mediaType,
      mediaUrl:    bit.mediaUrl,
      textContent: bit.textContent,
      title:       bit.title,
    });
  }

  /* ── Sudden Death ──────────────────────────────────────── */

  private startSuddenDeath(roomCode: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    room.suddenDeathActive = true;
    room.currentRoundType = 'sudden_death';
    this.performers.delete(roomCode);

    this.sys(roomCode, '💀 SUDDEN DEATH — one laugh and you are OUT. Everyone gets the soundboard. No immunity.');
    this.io.to(roomCode).emit('sudden_death_started', {
      sounds: SOUNDS.map(s => ({ id: s.id, label: s.label })),
      capMs: SUDDEN_DEATH_CAP_MS,
    });

    // Safety cap: if faces of steel prevail, most lives wins.
    this.setPhaseTimer(roomCode, SUDDEN_DEATH_CAP_MS, () => this.endMatch(roomCode));
  }

  /* ── Laughs ────────────────────────────────────────────── */

  processLaugh(roomCode: string, laughingPlayerId: string, confidence: number): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;

    const player = room.players.get(laughingPlayerId);
    if (!player || player.isEliminated) return;

    const performerId = this.performers.get(roomCode);
    // Performer immunity — except in Sudden Death, where nobody is safe.
    if (!room.suddenDeathActive && laughingPlayerId === performerId) return;

    const proc = this.laughProcs.get(roomCode);
    if (!proc?.shouldRegister(laughingPlayerId, confidence)) return;

    if (room.suddenDeathActive) {
      // Laugh = instant elimination.
      player.livesRemaining = 0;
      player.laughsReceived += 1;
      player.isEliminated = true;
      this.io.to(roomCode).emit('laugh_detected', { playerId: laughingPlayerId, confidence });
      this.io.to(roomCode).emit('life_removed', {
        playerId: laughingPlayerId, livesRemaining: 0, reason: 'sudden_death',
      });
      this.io.to(roomCode).emit('player_eliminated', { playerId: laughingPlayerId });
      this.sys(roomCode, `💀 ${player.username} laughed — eliminated!`);
      this.checkEnd(roomCode);
      return;
    }

    player.livesRemaining -= 1;
    player.laughsReceived += 1;

    if (performerId) {
      const performer = room.players.get(performerId);
      if (performer) performer.laughsCaused += 1;
      // The Jester delivered — off the hook this round.
      if (performerId === room.jesterPlayerId) this.jesterOnTheHook.delete(roomCode);
    }

    this.io.to(roomCode).emit('laugh_detected', { playerId: laughingPlayerId, confidence });
    this.io.to(roomCode).emit('life_removed', {
      playerId: laughingPlayerId, livesRemaining: player.livesRemaining, reason: 'laughed',
    });

    if (player.livesRemaining <= 0) {
      player.isEliminated = true;
      this.io.to(roomCode).emit('player_eliminated', { playerId: laughingPlayerId });
      this.sys(roomCode, `${player.username} was eliminated.`);
      this.checkEnd(roomCode);
    }
  }

  /** A player voluntarily leaves mid-match: forfeit. */
  leaveMatch(roomCode: string, userId: string): void {
    const room = roomManager.get(roomCode);
    if (!room || room.status !== 'in_game') return;
    const player = room.players.get(userId);
    if (!player || player.isEliminated) return;

    player.isEliminated = true;
    player.livesRemaining = 0;
    this.io.to(roomCode).emit('player_eliminated', { playerId: userId });
    this.sys(roomCode, `${player.username} left the match.`);

    if (this.performers.get(roomCode) === userId) {
      this.endRound(roomCode);
    } else {
      this.checkEnd(roomCode);
    }
  }

  /* ── End of match ──────────────────────────────────────── */

  private checkEnd(roomCode: string): boolean {
    if (this.alivePlayers(roomCode).length <= 1) {
      this.endMatch(roomCode);
      return true;
    }
    return false;
  }

  private endMatch(roomCode: string): void {
    clearTimeout(this.phaseTimers.get(roomCode));
    this.phaseTimers.delete(roomCode);

    const room = roomManager.get(roomCode);
    if (!room || room.status === 'finished') return;

    this.performers.delete(roomCode);
    this.roundActive.delete(roomCode);
    this.selectionOpen.delete(roomCode);
    this.accusationOpen.delete(roomCode);
    this.inDiscussion.delete(roomCode);
    this.pendingDiscussion.delete(roomCode);
    room.status = 'finished';
    room.suddenDeathActive = false;
    room.currentRoundType = null;

    const players = Array.from(room.players.values());
    const alive = this.alivePlayers(roomCode);
    // Normal end: last one standing. Sudden-death cap: most lives wins.
    const winnerId = alive.length === 1
      ? alive[0]
      : alive.sort((a, b) =>
          (room.players.get(b)?.livesRemaining ?? 0) - (room.players.get(a)?.livesRemaining ?? 0)
        )[0] ?? null;

    const by = (key: 'laughsCaused' | 'laughsReceived', dir: 1 | -1) =>
      [...players].sort((a, b) => dir * (b[key] - a[key]))[0]?.userId ?? null;

    const winner = winnerId ? room.players.get(winnerId) : null;
    this.sys(roomCode, winner ? `🏆 ${winner.username} wins!` : 'Match over — no survivors.');

    this.io.to(roomCode).emit('match_finished', {
      winnerId,
      stats: {
        funniest:     by('laughsCaused', 1),
        mostLaughed:  by('laughsReceived', 1),
        leastLaughed: by('laughsReceived', -1),
        totalLaughs:  players.reduce((s, p) => s + p.laughsReceived, 0),
        roles: {
          jesterPlayerId:    room.jesterPlayerId,
          detectivePlayerId: room.detectivePlayerId,
          saboteurPlayerId:  room.saboteurPlayerId, // revealed at the end
        },
        players: players.map(({ userId, username, laughsCaused, laughsReceived, isEliminated, role }) =>
          ({ userId, username, laughsCaused, laughsReceived, isEliminated, role })),
      },
    });

    saveMatch(room, winnerId).catch(err => console.error('[persist]', err));
  }
}

export const matchEngine = new MatchEngine();
