import { useEffect, useReducer, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';

/**
 * Client-side match state, driven entirely by server socket events.
 *
 * Turn flow (server → client):
 *   anonymous_turn_started → everyone sees "someone is performing"
 *   your_turn              → only the active player learns it's them
 *   bit_played             → the bit content is shown to the room
 *   life_removed           → someone lost a life (laughed / caught / wrong guess)
 *   turn_revealed          → the performer's identity is revealed
 *   match_finished         → winner + stats
 */

export interface GamePlayer {
  userId: string;
  username: string;
  livesRemaining: number;
  isEliminated: boolean;
  isBot: boolean;
}

/** Why a player lost a life — matches the server's `life_removed.reason`. */
export type PenaltyReason = 'laughed' | 'caught' | 'wrong_guess';

export interface Penalty {
  playerId: string;
  reason: PenaltyReason;
  /** Changes on every penalty so repeat offenders retrigger the banner. */
  key: number;
}

/** The bit currently being performed (text, image, or YouTube). */
export interface ActiveBit {
  mediaType: string;
  mediaUrl?: string;
  textContent?: string;
  title?: string;
}

type Phase = 'loading' | 'turn_active' | 'turn_reveal' | 'finished';

interface State {
  phase: Phase;
  players: GamePlayer[];
  myTurn: boolean;
  activeBit: ActiveBit | null;
  revealedPlayer: { playerId: string; username: string } | null;
  timeLeft: number;
  turnDurationMs: number;
  result: { winnerId: string | null; stats: Record<string, unknown> } | null;
  /** Most recent life loss — drives the whistle + banner. Auto-clears. */
  penalty: Penalty | null;
}

type Action =
  | { type: 'INIT'; players: GamePlayer[] }
  | { type: 'TURN_START'; durationMs: number }
  | { type: 'MY_TURN' }
  | { type: 'BIT_PLAYED'; bit: ActiveBit }
  | { type: 'TURN_REVEAL'; playerId: string; username: string }
  | { type: 'LIFE_REMOVED'; playerId: string; livesRemaining: number; reason: PenaltyReason }
  | { type: 'PLAYER_ELIMINATED'; playerId: string }
  | { type: 'CLEAR_PENALTY'; key: number }
  | { type: 'MATCH_FINISHED'; winnerId: string | null; stats: Record<string, unknown> }
  | { type: 'TICK' };

let penaltyCounter = 0;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT':
      return { ...state, players: action.players };

    case 'TURN_START':
      return {
        ...state,
        phase: 'turn_active',
        myTurn: false,
        activeBit: null,
        revealedPlayer: null,
        timeLeft: Math.round(action.durationMs / 1000),
        turnDurationMs: action.durationMs,
      };

    case 'MY_TURN':
      return { ...state, myTurn: true };

    case 'BIT_PLAYED':
      return { ...state, activeBit: action.bit };

    case 'TURN_REVEAL':
      return {
        ...state,
        phase: 'turn_reveal',
        myTurn: false,
        revealedPlayer: { playerId: action.playerId, username: action.username },
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
      // Only clear if a newer penalty hasn't replaced this one.
      return state.penalty?.key === action.key ? { ...state, penalty: null } : state;

    case 'MATCH_FINISHED':
      return { ...state, phase: 'finished', result: { winnerId: action.winnerId, stats: action.stats } };

    case 'TICK':
      return { ...state, timeLeft: Math.max(0, state.timeLeft - 1) };

    default:
      return state;
  }
}

const initial: State = {
  phase: 'loading',
  players: [],
  myTurn: false,
  activeBit: null,
  revealedPlayer: null,
  timeLeft: 0,
  turnDurationMs: 20_000,
  result: null,
  penalty: null,
};

/** How long the whistle banner stays on screen. */
const PENALTY_BANNER_MS = 3_000;

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
    socket.emit('get_match_state', { roomCode }, (res: { ok: boolean; room?: { players: GamePlayer[] } }) => {
      if (!res.ok || !res.room) return;
      dispatch({ type: 'INIT', players: res.room.players });
    });

    socket.on('anonymous_turn_started', ({ durationMs }: { durationMs: number }) => {
      dispatch({ type: 'TURN_START', durationMs });
      startTick();
    });

    socket.on('your_turn', () => {
      dispatch({ type: 'MY_TURN' });
    });

    socket.on('bit_played', (bit: ActiveBit) => {
      dispatch({ type: 'BIT_PLAYED', bit });
    });

    socket.on('turn_revealed', ({ playerId, username }: { playerId: string; username: string }) => {
      stopTick();
      dispatch({ type: 'TURN_REVEAL', playerId, username });
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

    return () => {
      stopTick();
      socket.off('anonymous_turn_started');
      socket.off('your_turn');
      socket.off('bit_played');
      socket.off('turn_revealed');
      socket.off('life_removed');
      socket.off('player_eliminated');
      socket.off('match_finished');
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

  return { ...state, playBit, skipTurn };
}
