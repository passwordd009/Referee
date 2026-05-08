import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { FaceState } from '../types';

const LM = {
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
  LIP_TOP: 13,
  LIP_BOTTOM: 14,
  FACE_LEFT: 234,
  FACE_RIGHT: 454,
} as const;

export const SMILE_THRESHOLDS = {
  violation: 0.5,
  laugh: 0.75,
  cornerRiseScale: 0.04,
  widthRatioMin: 0.28,
  widthRatioRange: 0.18,
  mouthOpenGap: 0.018,
} as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function calculateSmileScore(landmarks: NormalizedLandmark[]): number {
  const faceWidth = Math.abs(landmarks[LM.FACE_RIGHT].x - landmarks[LM.FACE_LEFT].x);
  if (faceWidth < 0.001) return 0;

  const midLipY = (landmarks[LM.LIP_TOP].y + landmarks[LM.LIP_BOTTOM].y) / 2;
  const leftRise = midLipY - landmarks[LM.MOUTH_LEFT].y;
  const rightRise = midLipY - landmarks[LM.MOUTH_RIGHT].y;
  const avgRise = (leftRise + rightRise) / 2;

  const mouthWidth = Math.abs(landmarks[LM.MOUTH_RIGHT].x - landmarks[LM.MOUTH_LEFT].x);
  const widthRatio = mouthWidth / faceWidth;

  const cornerScore = clamp(avgRise / SMILE_THRESHOLDS.cornerRiseScale, 0, 1);
  const widthScore = clamp(
    (widthRatio - SMILE_THRESHOLDS.widthRatioMin) / SMILE_THRESHOLDS.widthRatioRange,
    0,
    1
  );

  return 0.6 * cornerScore + 0.4 * widthScore;
}

export function isMouthOpen(landmarks: NormalizedLandmark[]): boolean {
  const gap = Math.abs(landmarks[LM.LIP_BOTTOM].y - landmarks[LM.LIP_TOP].y);
  return gap > SMILE_THRESHOLDS.mouthOpenGap;
}

export function landmarksToFaceState(
  landmarks: NormalizedLandmark[],
  timestamp: number
): FaceState {
  return {
    faceDetected: true,
    smileScore: calculateSmileScore(landmarks),
    mouthOpen: isMouthOpen(landmarks),
    timestamp,
  };
}

export const noFaceState = (timestamp: number): FaceState => ({
  faceDetected: false,
  smileScore: 0,
  mouthOpen: false,
  timestamp,
});
