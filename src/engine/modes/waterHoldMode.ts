import type { GameState, VisionEvent } from '../../types';

export const WATER_HOLD_DURATION_S = 60;
export const WATER_HOLD_SMILE_THRESHOLD = 0.45;
export const WATER_HOLD_FACE_LOST_GRACE_MS = 3000;

export function processWaterHoldVision(
  state: GameState,
  event: VisionEvent
): Partial<GameState> {
  if (event.type === 'VIOLATION_DETECTED') {
    return { status: 'ended', roundWon: false };
  }
  if (event.type === 'SMILE_SCORE_UPDATE' && event.faceState.mouthOpen) {
    return { status: 'ended', roundWon: false };
  }
  if (event.type === 'FACE_NOT_DETECTED') {
    const faceLostMs = state.faceLostMs === 0 ? event.faceState.timestamp : state.faceLostMs;
    const elapsed = event.faceState.timestamp - faceLostMs;
    if (elapsed >= WATER_HOLD_FACE_LOST_GRACE_MS) {
      return { status: 'ended', roundWon: false, faceLostMs };
    }
    return { faceLostMs };
  }
  if (event.type === 'SMILE_SCORE_UPDATE') {
    return { faceLostMs: 0 };
  }
  return {};
}

export function processWaterHoldTimer(
  state: GameState,
  deltaMs: number
): Partial<GameState> {
  const newTimer = state.timer - deltaMs / 1000;
  if (newTimer <= 0) {
    return { status: 'ended', roundWon: true, timer: 0 };
  }
  return { timer: newTimer };
}
