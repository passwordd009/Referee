import type { GameState, VisionEvent } from '../../types';

export const DUEL_SMILE_THRESHOLD = 0.5;
export const DUEL_FACE_LOST_GRACE_MS = 3000;

export function processDuelVision(
  state: GameState,
  event: VisionEvent
): Partial<GameState> {
  if (event.type === 'VIOLATION_DETECTED') {
    return {
      status: 'ended',
      roundWon: false,
      violations: state.violations + 1,
    };
  }
  if (event.type === 'FACE_NOT_DETECTED') {
    const faceLostMs = state.faceLostMs === 0 ? event.faceState.timestamp : state.faceLostMs;
    const elapsed = event.faceState.timestamp - faceLostMs;
    if (elapsed >= DUEL_FACE_LOST_GRACE_MS) {
      return { status: 'ended', roundWon: false, faceLostMs };
    }
    return { faceLostMs };
  }
  if (event.type === 'SMILE_SCORE_UPDATE') {
    return { faceLostMs: 0 };
  }
  return {};
}
