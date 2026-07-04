import type { WithFaceLandmarks, WithFaceDetection, FaceLandmarks68 } from 'face-api.js';
import type { FaceState, FaceBox } from '../types';

/**
 * Smile scoring from face-api.js 68-point landmarks.
 *
 * A smile shows up in two ways:
 *  1. The mouth corners rise above the lip midline ("corner rise").
 *  2. The mouth gets wider relative to the face ("width ratio").
 *
 * Both signals are normalized against face width so the score is
 * independent of how close the player sits to the camera.
 */

// Landmark indices in the 68-point model.
const LM = {
  JAW_LEFT: 0,
  JAW_RIGHT: 16,
  MOUTH_LEFT: 48,
  MOUTH_RIGHT: 54,
  LIP_TOP: 51,
  LIP_BOTTOM: 57,
} as const;

/** Score thresholds: `violation` counts as a laugh, `laugh` is a big laugh. */
export const SMILE_THRESHOLDS = {
  violation: 0.5,
  laugh: 0.75,
} as const;

type Detection = WithFaceLandmarks<WithFaceDetection<object>, FaceLandmarks68>;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/** Convert a raw face-api.js detection into a scored FaceState. */
export function detectionToFaceState(det: Detection, timestamp: number): FaceState {
  const pts = det.landmarks.positions;
  const faceWidth = Math.abs(pts[LM.JAW_RIGHT].x - pts[LM.JAW_LEFT].x);

  if (faceWidth < 1) return { faceDetected: true, smileScore: 0, mouthOpen: false, timestamp };

  // How far the mouth corners sit above the lip midline (positive = smiling).
  const midLipY = (pts[LM.LIP_TOP].y + pts[LM.LIP_BOTTOM].y) / 2;
  const avgRise = ((midLipY - pts[LM.MOUTH_LEFT].y) + (midLipY - pts[LM.MOUTH_RIGHT].y)) / 2;

  // How wide the mouth is relative to the face (resting ratio ≈ 0.35).
  const mouthWidth = Math.abs(pts[LM.MOUTH_RIGHT].x - pts[LM.MOUTH_LEFT].x);
  const widthRatio = mouthWidth / faceWidth;

  // Sanity bounds: real mouths span ~20-60% of face width and corners
  // rise at most ~15-20% of it. Values outside that mean the landmarks
  // landed on noise (dark/grainy feeds) — never score those frames,
  // or garbage geometry reads as a huge fake smile. Kept loose so
  // degraded-but-real faces still score; the laugh *decision* also
  // requires frame-to-frame score stability (see useLocalCamera).
  if (widthRatio > 0.75 || widthRatio < 0.15 || avgRise > faceWidth * 0.2) {
    return { faceDetected: true, smileScore: 0, mouthOpen: false, timestamp };
  }

  // A full smile rises ~6% of face width and widens the ratio by ~0.15.
  const cornerScore = clamp(avgRise / (faceWidth * 0.06), 0, 1);
  const widthScore = clamp((widthRatio - 0.35) / 0.15, 0, 1);
  const smileScore = 0.6 * cornerScore + 0.4 * widthScore;

  const vertGap = Math.abs(pts[LM.LIP_BOTTOM].y - pts[LM.LIP_TOP].y);
  const mouthOpen = vertGap > faceWidth * 0.05;

  const { x, y, width, height } = det.detection.box;
  const box: FaceBox = { x, y, width, height };
  const landmarks = det.landmarks.positions.map((p) => ({ x: p.x, y: p.y }));

  return { faceDetected: true, smileScore, mouthOpen, timestamp, box, landmarks };
}

/** FaceState for frames where no face was found. */
export const noFaceState = (timestamp: number): FaceState => ({
  faceDetected: false,
  smileScore: 0,
  mouthOpen: false,
  timestamp,
});
