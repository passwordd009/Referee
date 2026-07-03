/**
 * Shared types for the local vision (laugh-detection) pipeline.
 *
 * The pipeline: webcam frames → face-api.js landmarks → smile score →
 * VisionEvent → socket `laugh_detected` → server deducts a life.
 */

/** Bounding box of a detected face, in video pixel coordinates. */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Snapshot of what the vision loop sees on a single frame. */
export interface FaceState {
  faceDetected: boolean;
  /** 0 (neutral) → 1 (big smile). A laugh is a score above the threshold. */
  smileScore: number;
  mouthOpen: boolean;
  timestamp: number;
  box?: FaceBox;
  landmarks?: { x: number; y: number }[];
}

/** Events emitted by the vision loop, one per analyzed frame. */
export interface VisionEvent {
  type: 'FACE_NOT_DETECTED' | 'SMILE_SCORE_UPDATE' | 'VIOLATION_DETECTED';
  faceState: FaceState;
}
