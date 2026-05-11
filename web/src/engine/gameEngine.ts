import type { GameState, GameAction } from '../types';
import { processDuelVision } from './modes/duelMode';
import { processWaterHoldVision, processWaterHoldTimer, WATER_HOLD_DURATION_S } from './modes/waterHoldMode';

const COUNTDOWN_START = 3;

export const initialGameState: GameState = {
  mode: null,
  status: 'idle',
  timer: 0,
  violations: 0,
  roundWon: null,
  countdownSeconds: COUNTDOWN_START,
  faceLostMs: 0,
};

export function reduceGameState(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'MODE_SELECTED':
      return { ...state, status: 'modeSelect', mode: action.mode };

    case 'START_GAME':
      return {
        ...state,
        status: 'countdown',
        countdownSeconds: COUNTDOWN_START,
        violations: 0,
        roundWon: null,
        faceLostMs: 0,
        timer: state.mode === 'WaterHold' ? WATER_HOLD_DURATION_S : 0,
      };

    case 'TIMER_TICK': {
      if (state.status === 'countdown') {
        const newCountdown = state.countdownSeconds - action.deltaMs / 1000;
        if (newCountdown <= 0) {
          return { ...state, status: 'playing', countdownSeconds: 0 };
        }
        return { ...state, countdownSeconds: newCountdown };
      }

      if (state.status === 'playing' && state.mode === 'WaterHold') {
        const patch = processWaterHoldTimer(state, action.deltaMs);
        return { ...state, ...patch };
      }

      if (state.status === 'playing' && state.mode === 'Duel') {
        return { ...state, timer: state.timer + action.deltaMs / 1000 };
      }

      return state;
    }

    case 'VISION_EVENT': {
      if (state.status !== 'playing') return state;

      let patch: Partial<GameState> = {};
      if (state.mode === 'Duel') {
        patch = processDuelVision(state, action.event);
      } else if (state.mode === 'WaterHold') {
        patch = processWaterHoldVision(state, action.event);
      }
      return { ...state, ...patch };
    }

    case 'RESET':
      return { ...initialGameState };

    default:
      return state;
  }
}
