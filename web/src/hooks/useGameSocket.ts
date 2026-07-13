import { useEffect, useReducer, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';
import { playSound } from '../lib/soundboard';

export type Role = 'jester' | 'saboteur' | 'detective' | 'regular';

export interface GamePlayer {
  userId: string;
  username: string;
  livesRemaining: number;
  isEliminated: boolean;
}

export type RoundType = 'match_the_sound' | 'guess_the_item' | 'fill_blank' | 'accusation';

type Phase =
  | 'loading'
  | 'role_reveal'
  | 'selecting'      // jester picking the round
  | 'round_active'
  | 'round_break'
  | 'discussion'
  | 'sudden_death'
  | 'finished';

export interface RoundInfo {
  type: RoundType;
  performerId?: string;
  soundId?: string;
  soundLabel?: string;
  sentence?: string;
  voice?: string;
  hint?: string;
  detectivePlayerId?: string;
}

export interface MatchResult {
  winnerId: string | null;
  stats: {
    funniest: string | null;
    mostLaughed: string | null;
    leastLaughed: string | null;
    totalLaughs: number;
    roles: { jesterPlayerId: string | null; detectivePlayerId: string | null; saboteurPlayerId: string | null };
    players: { userId: string; username: string; laughsCaused: number; laughsReceived: number; role: Role }[];
  };
}

interface State {
  phase: Phase;
  players: GamePlayer[];
  myRole: Role;
  discussionsRemaining: number;
  jesterPlayerId: string | null;
  detectivePlayerId: string | null;
  round: RoundInfo | null;
  roundIndex: number;
  roundOptions: RoundType[] | null;   // set when I'm the jester choosing
  guessProgress: { submitted: number; total: number } | null;
  guessesRevealed: { item: string; guesses: { userId: string; username: string; guess: string }[] } | null;
  accusationResult: { guessed: boolean; correct: boolean; targetId: string | null } | null;
  suddenDeath: boolean;
  activeBit: { mediaType?: string; textContent?: string; mediaUrl?: string; title?: string } | null;
  timeLeft: number;
  durationMs: number;
  result: MatchResult | null;
  laughFlash: { playerId: string } | null;
  lastPenalty: { playerId: string; reason: string } | null;
  showCameras: boolean;
  cameraLayout: 'grid' | 'spotlight';
}

type Action =
  | { type: 'INIT'; players: GamePlayer[]; showCameras: boolean; cameraLayout: 'grid' | 'spotlight' }
  | { type: 'MATCH_STARTED'; players: GamePlayer[] }
  | { type: 'ROLES'; jesterPlayerId: string | null; detectivePlayerId: string | null }
  | { type: 'MY_ROLE'; role: Role; discussionsRemaining: number }
  | { type: 'SELECTING'; durationMs: number }
  | { type: 'CHOOSE_ROUND'; options: RoundType[] }
  | { type: 'ROUND_SELECTED'; roundIndex: number }
  | { type: 'ROUND_STARTED'; round: RoundInfo; durationMs: number }
  | { type: 'ROUND_ENDED' }
  | { type: 'GUESS_PROGRESS'; submitted: number; total: number }
  | { type: 'GUESSES_REVEALED'; item: string; guesses: { userId: string; username: string; guess: string }[] }
  | { type: 'ACCUSE_RESULT'; guessed: boolean; correct: boolean; targetId: string | null }
  | { type: 'DISCUSSION_STARTED'; durationMs: number; remaining: number }
  | { type: 'DISCUSSION_ENDED' }
  | { type: 'SUDDEN_DEATH' }
  | { type: 'BIT_PLAYED'; bit: State['activeBit'] }
  | { type: 'LIFE_REMOVED'; playerId: string; livesRemaining: number; reason: string }
  | { type: 'PLAYER_ELIMINATED'; playerId: string }
  | { type: 'LAUGH_FLASH'; playerId: string }
  | { type: 'MATCH_FINISHED'; result: MatchResult }
  | { type: 'TICK' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        players: action.players,
        showCameras: action.showCameras,
        cameraLayout: action.cameraLayout,
        phase: state.phase === 'loading' ? 'role_reveal' : state.phase,
      };

    case 'MATCH_STARTED': // rematch resets everything
      return {
        ...initial,
        players: action.players,
        showCameras: state.showCameras,
        cameraLayout: state.cameraLayout,
        phase: 'role_reveal',
      };

    case 'ROLES':
      return { ...state, jesterPlayerId: action.jesterPlayerId, detectivePlayerId: action.detectivePlayerId };

    case 'MY_ROLE':
      return { ...state, myRole: action.role, discussionsRemaining: action.discussionsRemaining };

    case 'SELECTING':
      return {
        ...state, phase: 'selecting', round: null, activeBit: null,
        guessesRevealed: null, accusationResult: null, laughFlash: null,
        timeLeft: Math.round(action.durationMs / 1000), durationMs: action.durationMs,
      };

    case 'CHOOSE_ROUND':
      return { ...state, roundOptions: action.options };

    case 'ROUND_SELECTED':
      return { ...state, roundOptions: null, roundIndex: action.roundIndex };

    case 'ROUND_STARTED':
      return {
        ...state, phase: 'round_active', round: action.round, roundOptions: null,
        activeBit: null, guessProgress: null, guessesRevealed: null, accusationResult: null,
        timeLeft: Math.round(action.durationMs / 1000), durationMs: action.durationMs,
      };

    case 'ROUND_ENDED':
      return { ...state, phase: state.suddenDeath ? 'sudden_death' : 'round_break', round: null };

    case 'GUESS_PROGRESS':
      return { ...state, guessProgress: { submitted: action.submitted, total: action.total } };

    case 'GUESSES_REVEALED':
      return { ...state, guessesRevealed: { item: action.item, guesses: action.guesses } };

    case 'ACCUSE_RESULT':
      return { ...state, accusationResult: { guessed: action.guessed, correct: action.correct, targetId: action.targetId } };

    case 'DISCUSSION_STARTED':
      return {
        ...state, phase: 'discussion',
        discussionsRemaining: state.myRole === 'detective' ? action.remaining : state.discussionsRemaining,
        timeLeft: Math.round(action.durationMs / 1000), durationMs: action.durationMs,
      };

    case 'DISCUSSION_ENDED':
      return { ...state, phase: 'round_break' };

    case 'SUDDEN_DEATH':
      return { ...state, phase: 'sudden_death', suddenDeath: true, round: null, roundOptions: null };

    case 'BIT_PLAYED':
      return { ...state, activeBit: action.bit };

    case 'LIFE_REMOVED':
      return {
        ...state,
        players: state.players.map(p =>
          p.userId === action.playerId ? { ...p, livesRemaining: action.livesRemaining } : p
        ),
        laughFlash: { playerId: action.playerId },
        lastPenalty: { playerId: action.playerId, reason: action.reason },
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
      return { ...state, phase: 'finished', result: action.result };

    case 'TICK':
      return { ...state, timeLeft: Math.max(0, state.timeLeft - 1) };

    default:
      return state;
  }
}

const initial: State = {
  phase: 'loading',
  players: [],
  myRole: 'regular',
  discussionsRemaining: 0,
  jesterPlayerId: null,
  detectivePlayerId: null,
  round: null,
  roundIndex: 0,
  roundOptions: null,
  guessProgress: null,
  guessesRevealed: null,
  accusationResult: null,
  suddenDeath: false,
  activeBit: null,
  timeLeft: 0,
  durationMs: 0,
  result: null,
  laughFlash: null,
  lastPenalty: null,
  showCameras: true,
  cameraLayout: 'grid',
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
    socket.connect();

    // (Re)attach to the room — also covers a page refresh mid-match.
    socket.emit('get_match_state', { roomCode }, (res: {
      ok: boolean;
      room?: {
        players: GamePlayer[]; showCameras: boolean; cameraLayout: 'grid' | 'spotlight';
        jesterPlayerId: string | null; detectivePlayerId: string | null;
      };
      myRole?: Role | null;
      discussionsRemaining?: number;
    }) => {
      if (!res.ok || !res.room) return;
      dispatch({
        type: 'INIT',
        players: res.room.players,
        showCameras: res.room.showCameras,
        cameraLayout: res.room.cameraLayout,
      });
      dispatch({
        type: 'ROLES',
        jesterPlayerId: res.room.jesterPlayerId,
        detectivePlayerId: res.room.detectivePlayerId,
      });
      if (res.myRole) {
        dispatch({ type: 'MY_ROLE', role: res.myRole, discussionsRemaining: res.discussionsRemaining ?? 0 });
      }
    });

    socket.on('match_started', ({ room }: { room: { players: GamePlayer[] } }) => {
      dispatch({ type: 'MATCH_STARTED', players: room.players });
    });

    socket.on('roles_assigned', (p: { jesterPlayerId: string | null; detectivePlayerId: string | null }) => {
      dispatch({ type: 'ROLES', ...p });
    });

    socket.on('role_revealed_to_player', (p: { role: Role; discussionsRemaining: number }) => {
      dispatch({ type: 'MY_ROLE', role: p.role, discussionsRemaining: p.discussionsRemaining });
    });

    socket.on('round_selection_started', ({ durationMs }: { jesterPlayerId: string; durationMs: number }) => {
      dispatch({ type: 'SELECTING', durationMs });
      startTick();
    });

    socket.on('choose_round', ({ options }: { options: RoundType[]; durationMs: number }) => {
      dispatch({ type: 'CHOOSE_ROUND', options });
    });

    socket.on('round_selected', ({ roundIndex }: { type: RoundType; roundIndex: number }) => {
      dispatch({ type: 'ROUND_SELECTED', roundIndex });
    });

    socket.on('round_started', (p: RoundInfo & { durationMs: number }) => {
      dispatch({ type: 'ROUND_STARTED', round: p, durationMs: p.durationMs });
      startTick();
      // Match-the-Sound: everyone hears the target sound.
      if (p.type === 'match_the_sound' && p.soundId) {
        playSound(p.soundId);
        setTimeout(() => p.soundId && playSound(p.soundId), 1800);
      }
    });

    socket.on('round_ended', () => {
      stopTick();
      dispatch({ type: 'ROUND_ENDED' });
    });

    socket.on('item_guess_progress', (p: { submitted: number; total: number }) => {
      dispatch({ type: 'GUESS_PROGRESS', ...p });
    });

    socket.on('item_guesses_revealed', (p: { item: string; guesses: { userId: string; username: string; guess: string }[] }) => {
      dispatch({ type: 'GUESSES_REVEALED', ...p });
    });

    socket.on('detective_guess_result', (p: { guessed: boolean; correct: boolean; targetId: string | null }) => {
      dispatch({ type: 'ACCUSE_RESULT', ...p });
    });

    socket.on('discussion_started', (p: { durationMs: number; discussionsRemaining: number }) => {
      dispatch({ type: 'DISCUSSION_STARTED', durationMs: p.durationMs, remaining: p.discussionsRemaining });
      startTick();
    });

    socket.on('discussion_ended', () => {
      stopTick();
      dispatch({ type: 'DISCUSSION_ENDED' });
    });

    socket.on('sudden_death_started', () => {
      stopTick();
      dispatch({ type: 'SUDDEN_DEATH' });
    });

    socket.on('saboteur_sound_played', ({ soundId }: { soundId: string }) => {
      playSound(soundId);
    });

    socket.on('bit_played', (bit: { mediaType?: string; textContent?: string; mediaUrl?: string; title?: string }) => {
      dispatch({ type: 'BIT_PLAYED', bit });
    });

    socket.on('life_removed', (p: { playerId: string; livesRemaining: number; reason: string }) => {
      dispatch({ type: 'LIFE_REMOVED', ...p });
    });

    socket.on('laugh_detected', ({ playerId }: { playerId: string }) => {
      dispatch({ type: 'LAUGH_FLASH', playerId });
    });

    socket.on('player_eliminated', ({ playerId }: { playerId: string }) => {
      dispatch({ type: 'PLAYER_ELIMINATED', playerId });
    });

    socket.on('match_finished', (result: MatchResult) => {
      stopTick();
      dispatch({ type: 'MATCH_FINISHED', result });
    });

    return () => {
      stopTick();
      [
        'match_started', 'roles_assigned', 'role_revealed_to_player',
        'round_selection_started', 'choose_round', 'round_selected',
        'round_started', 'round_ended',
        'item_guess_progress', 'item_guesses_revealed',
        'detective_guess_result', 'discussion_started', 'discussion_ended',
        'sudden_death_started', 'saboteur_sound_played',
        'bit_played', 'life_removed', 'laugh_detected',
        'player_eliminated', 'match_finished',
      ].forEach(ev => socket.off(ev));
      socket.disconnect();
    };
  }, [roomCode]);

  const selectRound = useCallback((type: RoundType) => {
    socket.emit('select_round', { roomCode, userId, type });
  }, [roomCode, userId]);

  const submitItemGuess = useCallback((guess: string) => {
    socket.emit('submit_item_guess', { roomCode, userId, guess });
  }, [roomCode, userId]);

  const detectiveGuess = useCallback((targetId: string) => {
    socket.emit('detective_guess', { roomCode, userId, targetId });
  }, [roomCode, userId]);

  const activateDiscussion = useCallback(() => {
    socket.emit('activate_discussion', { roomCode, userId });
  }, [roomCode, userId]);

  const playSoundboard = useCallback((soundId: string) => {
    socket.emit('play_soundboard', { roomCode, userId, soundId });
  }, [roomCode, userId]);

  const playBit = useCallback((textContent: string) => {
    socket.emit('play_bit', { roomCode, userId, mediaType: 'text', textContent });
  }, [roomCode, userId]);

  const skipTurn = useCallback(() => {
    socket.emit('skip_turn', { roomCode, userId });
  }, [roomCode, userId]);

  const rematch = useCallback(() => {
    socket.emit('rematch', { roomCode, userId });
  }, [roomCode, userId]);

  return {
    ...state,
    selectRound, submitItemGuess, detectiveGuess, activateDiscussion,
    playSoundboard, playBit, skipTurn, rematch,
  };
}
