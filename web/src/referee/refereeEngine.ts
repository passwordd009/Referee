import type { VisionEvent, GameState, RefereeEvent } from '../types';
import { REFEREE_MESSAGES, pickRandom } from './refereeMessages';

export function createRefereeEvent(
  visionEvent: VisionEvent,
  gameState: GameState
): RefereeEvent | null {
  if (gameState.status !== 'playing') return null;

  const mode = gameState.mode ?? 'Duel';
  const now = Date.now();

  switch (visionEvent.type) {
    case 'VIOLATION_DETECTED':
      return {
        type: 'VIOLATION_DETECTED',
        reason: `Smile score: ${visionEvent.faceState.smileScore.toFixed(2)}`,
        message: pickRandom(REFEREE_MESSAGES.VIOLATION_DETECTED[mode], `violation-${mode}`),
        severity: 'critical',
        timestamp: now,
      };

    case 'FACE_NOT_DETECTED':
      return {
        type: 'FACE_NOT_DETECTED',
        message: pickRandom(REFEREE_MESSAGES.FACE_NOT_DETECTED, 'face-not-detected'),
        severity: 'warning',
        timestamp: now,
      };

    default:
      return null;
  }
}

export function createRoundStartEvent(gameState: GameState): RefereeEvent {
  const mode = gameState.mode ?? 'Duel';
  return {
    type: 'ROUND_START',
    message: pickRandom(REFEREE_MESSAGES.ROUND_START[mode], `round-start-${mode}`),
    severity: 'info',
    timestamp: Date.now(),
  };
}

export function createRoundEndEvent(won: boolean): RefereeEvent {
  return {
    type: 'ROUND_END',
    message: won
      ? pickRandom(REFEREE_MESSAGES.ROUND_WON, 'round-won')
      : '',
    severity: won ? 'info' : 'critical',
    timestamp: Date.now(),
  };
}
