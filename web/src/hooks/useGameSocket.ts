import { useEffect, useReducer, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';

export interface GamePlayer {
  userId: string;
  username: string;
  livesRemaining: number;
  isEliminated: boolean;
  isBot: boolean;
}

type Phase = 'loading' | 'turn_active' | 'turn_reveal' | 'finished';

interface State {
  phase: Phase;
  players: GamePlayer[];
  myTurn: boolean;
  activeBit: { textContent?: string } | null;
  revealedPlayer: { playerId: string; username: string } | null;
  timeLeft: number;
  turnDurationMs: number;
  result: { winnerId: string | null; stats: Record<string, unknown> } | null;
  laughFlash: { playerId: string } | null;
}

type Action =
  | { type: 'INIT'; players: GamePlayer[] }
  | { type: 'TURN_START'; durationMs: number; myTurn: boolean }
  | { type: 'MY_TURN'; durationMs: number }
  | { type: 'BIT_PLAYED'; textContent?: string }
  | { type: 'TURN_REVEAL'; playerId: string; username: string }
  | { type: 'LIFE_REMOVED'; playerId: string; livesRemaining: number }
  | { type: 'PLAYER_ELIMINATED'; playerId: string }
  | { type: 'LAUGH_FLASH'; playerId: string }
  | { type: 'MATCH_FINISHED'; winnerId: string | null; stats: Record<string, unknown> }
  | { type: 'TICK' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT':
      return { ...state, players: action.players };

    case 'TURN_START':
      return {
        ...state,
        phase: 'turn_active',
        myTurn: action.myTurn,
        activeBit: null,
        revealedPlayer: null,
        laughFlash: null,
        timeLeft: Math.round(action.durationMs / 1000),
        turnDurationMs: action.durationMs,
      };

    case 'MY_TURN':
      return { ...state, myTurn: true };

    case 'BIT_PLAYED':
      return { ...state, activeBit: { textContent: action.textContent } };

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
        laughFlash: { playerId: action.playerId },
      };

    case 'PLAYER_ELIMINATED':
      return {
        ...state,
        players: state.players.map(p =>
          p.userId === action.playerId ? { ...p, isEliminated: true } : p
        ),
      };

    case 'LAUGH_FLASH':
      return { ...state, laughFlash: { playerId: action.playerId } };

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
  laughFlash: null,
};

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
    // Fetch current match state (socket was kept alive from lobby)
    socket.emit('get_match_state', { roomCode }, (res: { ok: boolean; room?: { players: GamePlayer[] } }) => {
      if (!res.ok || !res.room) return;
      dispatch({ type: 'INIT', players: res.room.players });
    });

    socket.on('anonymous_turn_started', ({ durationMs }: { durationMs: number }) => {
      dispatch({ type: 'TURN_START', durationMs, myTurn: false });
      startTick();
    });

    socket.on('your_turn', ({ durationMs }: { durationMs: number }) => {
      dispatch({ type: 'MY_TURN', durationMs });
    });

    socket.on('bit_played', ({ textContent }: { textContent?: string }) => {
      dispatch({ type: 'BIT_PLAYED', textContent });
    });

    socket.on('turn_revealed', ({ playerId, username }: { playerId: string; username: string }) => {
      stopTick();
      dispatch({ type: 'TURN_REVEAL', playerId, username });
    });

    socket.on('life_removed', ({ playerId, livesRemaining }: { playerId: string; livesRemaining: number }) => {
      dispatch({ type: 'LIFE_REMOVED', playerId, livesRemaining });
    });

    socket.on('laugh_detected', ({ playerId }: { playerId: string }) => {
      dispatch({ type: 'LAUGH_FLASH', playerId });
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
      socket.off('laugh_detected');
      socket.off('player_eliminated');
      socket.off('match_finished');
      socket.disconnect();
    };
  }, [roomCode]);

  const playBit = useCallback((textContent: string) => {
    socket.emit('play_bit', { roomCode, userId, mediaType: 'text', textContent });
  }, [roomCode, userId]);

  const skipTurn = useCallback(() => {
    socket.emit('skip_turn', { roomCode, userId });
  }, [roomCode, userId]);

  return { ...state, playBit, skipTurn };
}
