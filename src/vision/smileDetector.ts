import type { WithFaceLandmarks, WithFaceDetection, FaceLandmarks68 } from 'face-api.js';
import type { FaceState } from '../types';

// face-api.js 68-point landmark indices
const LM = {
  JAW_LEFT: 0,
  JAW_RIGHT: 16,
  MOUTH_LEFT: 48,
  MOUTH_RIGHT: 54,
  LIP_TOP: 51,
  LIP_BOTTOM: 57,
} as const;

export const SMILE_THRESHOLDS = {
  violation: 0.5,
  laugh: 0.75,
} as const;

type Detection = WithFaceLandmarks<WithFaceDetection<object>, FaceLandmarks68>;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

export function detectionToFaceState(det: Detection, timestamp: number): FaceState {
  const pts = det.landmarks.positions;
  const faceWidth = Math.abs(pts[LM.JAW_RIGHT].x - pts[LM.JAW_LEFT].x);

  if (faceWidth < 1) return { faceDetected: true, smileScore: 0, mouthOpen: false, timestamp };

  const midLipY = (pts[LM.LIP_TOP].y + pts[LM.LIP_BOTTOM].y) / 2;
  const avgRise = ((midLipY - pts[LM.MOUTH_LEFT].y) + (midLipY - pts[LM.MOUTH_RIGHT].y)) / 2;
  const mouthWidth = Math.abs(pts[LM.MOUTH_RIGHT].x - pts[LM.MOUTH_LEFT].x);
  const widthRatio = mouthWidth / faceWidth;

  // Normalize: smile rise ~5-8% of face width; resting width ratio ~0.35
  const cornerScore = clamp(avgRise / (faceWidth * 0.06), 0, 1);
  const widthScore = clamp((widthRatio - 0.35) / 0.15, 0, 1);
  const smileScore = 0.6 * cornerScore + 0.4 * widthScore;

  const vertGap = Math.abs(pts[LM.LIP_BOTTOM].y - pts[LM.LIP_TOP].y);
  const mouthOpen = vertGap > faceWidth * 0.05;

  console.log(
    `[smile] score=${smileScore.toFixed(3)} corner=${cornerScore.toFixed(3)} width=${widthScore.toFixed(3)} rise=${avgRise.toFixed(1)}px ratio=${widthRatio.toFixed(3)} faceW=${faceWidth.toFixed(0)}px`
  );

  return { faceDetected: true, smileScore, mouthOpen, timestamp };
}

export const noFaceState = (timestamp: number): FaceState => ({
  faceDetected: false,
  smileScore: 0,
  mouthOpen: false,
  timestamp,
});
