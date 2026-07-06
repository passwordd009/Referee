import { useEffect, useReducer, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';

/**
 * Client-side match state, driven entirely by server socket events.
 *
 * Shared flow: countdown → turns → results. Each mode adds its own
 * phases: Water Hold inserts refill breaks, Guess the Biter replaces
 * the public spotlight with anonymous turns plus a voting stage.
 */

export interface GamePlayer {
  userId: string;
  username: string;
  livesRemaining: number;
  isEliminated: boolean;
  isBot: boolean;
}

/** Why a player lost a life — matches the server's `life_removed.reason`. */
export type PenaltyReason = 'laughed' | 'spilled' | 'caught' | 'wrong_guess';

export interface Penalty {
  playerId: string;
  reason: PenaltyReason;
  /** Changes on every penalty so repeat offenders retrigger the banner. */
  key: number;
}

/** The bit currently being performed (text, image, video, or YouTube). */
export interface ActiveBit {
  mediaType: string;
  mediaUrl?: string;
  textContent?: string;
  title?: string;
}

/** XP/tickets a player earned when the match finished. */
export interface MatchReward {
  userId: string;
  xpGained: number;
  ticketsGained: number;
  level: number;
  xp: number;
  leveledUp: boolean;
}

export interface VoteEntry {
  voterId: string;
  targetId: string;
}

export type GameMode = 'casual' | 'water_hold' | 'guess_the_biter';

type Phase =
  | 'loading'
  | 'countdown'
  | 'refill'
  | 'turn_active'
  | 'turn_break'
  | 'voting'
  | 'votes_reveal'
  | 'finished';

interface State {
  phase: Phase;
  gameMode: GameMode;
  players: GamePlayer[];
  myTurn: boolean;
  /** Public active player (classic / water hold). Null in guess mode. */
  spotlightId: string | null;
  activeBit: ActiveBit | null;
  /** Whose turn just ended (classic/water break screen). */
  endedTurn: { playerId: string; username: string } | null;
  countdownSecs: number;
  refillSecs: number;
  votesIn: number;
  votesReveal: { votes: VoteEntry[]; biterId: string; username?: string } | null;
  myVoteTarget: string | null;
  timeLeft: number;
  turnDurationMs: number;
  result: { winnerId: string | null; stats: Record<string, unknown> } | null;
  rewards: MatchReward[] | null;
  /** Most recent life loss — drives the whistle + banner. Auto-clears. */
  penalty: Penalty | null;
}

type Action =
  | { type: 'INIT'; players: GamePlayer[]; gameMode: GameMode }
  | { type: 'MATCH_RESET'; players: GamePlayer[]; gameMode: GameMode }
  | { type: 'COUNTDOWN'; seconds: number }
  | { type: 'REFILL'; seconds: number }
  | { type: 'TURN_START'; durationMs: number; spotlightId: string | null }
  | { type: 'MY_TURN' }
  | { type: 'BIT_PLAYED'; bit: ActiveBit }
  | { type: 'TURN_ENDED'; playerId: string; username: string }
  | { type: 'VOTING_STARTED'; durationMs: number }
  | { type: 'VOTE_CAST'; votesIn: number }
  | { type: 'MY_VOTE'; targetId: string }
  | { type: 'VOTES_REVEALED'; votes: VoteEntry[]; biterId: string; username?: string }
  | { type: 'LIFE_REMOVED'; playerId: string; livesRemaining: number; reason: PenaltyReason }
  | { type: 'PLAYER_ELIMINATED'; playerId: string }
  | { type: 'CLEAR_PENALTY'; key: number }
  | { type: 'MATCH_FINISHED'; winnerId: string | null; stats: Record<string, unknown> }
  | { type: 'MATCH_REWARDS'; rewards: MatchReward[] }
  | { type: 'TICK' };

let penaltyCounter = 0;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT':
      return { ...state, players: action.players, gameMode: action.gameMode };

    case 'MATCH_RESET':
      // Rematch: fresh match state, keep identity/config.
      return {
        ...initial,
        phase: 'countdown',
        countdownSecs: 3,
        players: action.players,
        gameMode: action.gameMode,
      };

    case 'COUNTDOWN':
      return { ...state, phase: 'countdown', countdownSecs: action.seconds, endedTurn: null, votesReveal: null };

    case 'REFILL':
      return { ...state, phase: 'refill', refillSecs: action.seconds, endedTurn: null, activeBit: null };

    case 'TURN_START':
      return {
        ...state,
        phase: 'turn_active',
        myTurn: false,
        spotlightId: action.spotlightId,
        activeBit: null,
        endedTurn: null,
        votesReveal: null,
        myVoteTarget: null,
        votesIn: 0,
        timeLeft: Math.round(action.durationMs / 1000),
        turnDurationMs: action.durationMs,
      };

    case 'MY_TURN':
      return { ...state, myTurn: true };

    case 'BIT_PLAYED':
      return { ...state, activeBit: action.bit };

    case 'TURN_ENDED':
      return {
        ...state,
        phase: 'turn_break',
        myTurn: false,
        spotlightId: null,
        activeBit: null,
        endedTurn: { playerId: action.playerId, username: action.username },
      };

    case 'VOTING_STARTED':
      return {
        ...state,
        phase: 'voting',
        myTurn: false,
        activeBit: null,
        votesIn: 0,
        myVoteTarget: null,
        timeLeft: Math.round(action.durationMs / 1000),
        turnDurationMs: action.durationMs,
      };

    case 'VOTE_CAST':
      return { ...state, votesIn: action.votesIn };

    case 'MY_VOTE':
      return { ...state, myVoteTarget: action.targetId };

    case 'VOTES_REVEALED':
      return {
        ...state,
        phase: 'votes_reveal',
        votesReveal: { votes: action.votes, biterId: action.biterId, username: action.username },
      };

    case 'LIFE_REMOVED':
      return {
        ...state,
        players: state.players.map(p =>
          p.userId === action.playerId ? { ...p, livesRemaining: action.livesRemaining } : p
        ),
        penalty: { playerId: action.playerId, reason: action.reason, key: ++penaltyCounter },
      };

    case 'PLAYER_ELIMINATED':
      return {
        ...state,
        players: state.players.map(p =>
          p.userId === action.playerId ? { ...p, isEliminated: true } : p
        ),
      };

    case 'CLEAR_PENALTY':
      return state.penalty?.key === action.key ? { ...state, penalty: null } : state;

    case 'MATCH_FINISHED':
      return { ...state, phase: 'finished', result: { winnerId: action.winnerId, stats: action.stats } };

    case 'MATCH_REWARDS':
      return { ...state, rewards: action.rewards };

    case 'TICK':
      return { ...state, timeLeft: Math.max(0, state.timeLeft - 1) };

    default:
      return state;
  }
}

const initial: State = {
  phase: 'loading',
  gameMode: 'casual',
  players: [],
  myTurn: false,
  spotlightId: null,
  activeBit: null,
  endedTurn: null,
  countdownSecs: 3,
  refillSecs: 0,
  votesIn: 0,
  votesReveal: null,
  myVoteTarget: null,
  timeLeft: 0,
  turnDurationMs: 20_000,
  result: null,
  rewards: null,
  penalty: null,
};

/** How long the whistle banner stays on screen. */
const PENALTY_BANNER_MS = 3_000;

interface RoomPayload {
  players: GamePlayer[];
  gameMode?: GameMode;
}

export function useGameSocket(roomCode: string, userId: string) {
  const [state, dispatch] = useReducer(reducer, initial);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTick = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => dispatch({ type: 'TICK' }), 1000);
  };

  const stopTick = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  };

  useEffect(() => {
    // The socket stayed connected from the lobby — fetch current match state.
    socket.emit('get_match_state', { roomCode }, (res: { ok: boolean; room?: RoomPayload }) => {
      if (!res.ok || !res.room) return;
      dispatch({ type: 'INIT', players: res.room.players, gameMode: res.room.gameMode ?? 'casual' });
    });

    // Fires on rematch too — reset everything for the new match.
    socket.on('match_started', ({ room }: { room: RoomPayload }) => {
      dispatch({ type: 'MATCH_RESET', players: room.players, gameMode: room.gameMode ?? 'casual' });
    });

    socket.on('countdown_started', ({ seconds }: { seconds: number }) => {
      dispatch({ type: 'COUNTDOWN', seconds });
    });

    socket.on('refill_started', ({ seconds }: { seconds: number }) => {
      dispatch({ type: 'REFILL', seconds });
    });

    // Classic / Water Hold: public spotlight.
    socket.on('turn_started', ({ activePlayerId, durationMs }: { activePlayerId: string; durationMs: number }) => {
      dispatch({ type: 'TURN_START', durationMs, spotlightId: activePlayerId });
      startTick();
    });

    // Guess the Biter: nobody knows who performs...
    socket.on('anonymous_turn_started', ({ durationMs }: { durationMs: number }) => {
      dispatch({ type: 'TURN_START', durationMs, spotlightId: null });
      startTick();
    });

    // ...except the Biter themselves.
    socket.on('your_turn', () => {
      dispatch({ type: 'MY_TURN' });
    });

    socket.on('bit_played', (bit: ActiveBit) => {
      dispatch({ type: 'BIT_PLAYED', bit });
    });

    socket.on('turn_ended', ({ playerId, username }: { playerId: string; username: string }) => {
      stopTick();
      dispatch({ type: 'TURN_ENDED', playerId, username });
    });

    socket.on('voting_started', ({ durationMs }: { durationMs: number }) => {
      dispatch({ type: 'VOTING_STARTED', durationMs });
      startTick();
    });

    socket.on('vote_cast', ({ votesIn }: { votesIn: number }) => {
      dispatch({ type: 'VOTE_CAST', votesIn });
    });

    socket.on('votes_revealed', ({ votes, biterId, username }: { votes: VoteEntry[]; biterId: string; username?: string }) => {
      stopTick();
      dispatch({ type: 'VOTES_REVEALED', votes, biterId, username });
    });

    socket.on('life_removed', ({ playerId, livesRemaining, reason }: {
      playerId: string; livesRemaining: number; reason: PenaltyReason;
    }) => {
      dispatch({ type: 'LIFE_REMOVED', playerId, livesRemaining, reason });
      const key = penaltyCounter;
      setTimeout(() => dispatch({ type: 'CLEAR_PENALTY', key }), PENALTY_BANNER_MS);
    });

    socket.on('player_eliminated', ({ playerId }: { playerId: string }) => {
      dispatch({ type: 'PLAYER_ELIMINATED', playerId });
    });

    socket.on('match_finished', ({ winnerId, stats }: { winnerId: string | null; stats: Record<string, unknown> }) => {
      stopTick();
      dispatch({ type: 'MATCH_FINISHED', winnerId, stats });
    });

    socket.on('match_rewards', ({ rewards }: { rewards: MatchReward[] }) => {
      dispatch({ type: 'MATCH_REWARDS', rewards });
    });

    return () => {
      stopTick();
      socket.off('match_started');
      socket.off('countdown_started');
      socket.off('refill_started');
      socket.off('turn_started');
      socket.off('anonymous_turn_started');
      socket.off('your_turn');
      socket.off('bit_played');
      socket.off('turn_ended');
      socket.off('voting_started');
      socket.off('vote_cast');
      socket.off('votes_revealed');
      socket.off('life_removed');
      socket.off('player_eliminated');
      socket.off('match_finished');
      socket.off('match_rewards');
      socket.disconnect();
    };
  }, [roomCode]);

  /** Active player: perform a bit for the room. */
  const playBit = useCallback((bit: ActiveBit) => {
    socket.emit('play_bit', { roomCode, userId, ...bit });
  }, [roomCode, userId]);

  /** Active player: pass without performing. */
  const skipTurn = useCallback(() => {
    socket.emit('skip_turn', { roomCode, userId });
  }, [roomCode, userId]);

  /** Guess the Biter: cast your vote. */
  const submitVote = useCallback((targetId: string) => {
    socket.emit('submit_vote', { roomCode, voterId: userId, targetId });
    dispatch({ type: 'MY_VOTE', targetId });
  }, [roomCode, userId]);

  /** Results screen: run it back instantly. */
  const requestRematch = useCallback(() => {
    socket.emit('rematch', { roomCode });
  }, [roomCode]);

  return { ...state, playBit, skipTurn, submitVote, requestRematch };
}
