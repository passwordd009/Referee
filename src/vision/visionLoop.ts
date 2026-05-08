import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { VisionEvent } from '../types';
import { detectFaceLandmarks } from './faceLandmarker';
import { landmarksToFaceState, noFaceState, SMILE_THRESHOLDS } from './smileDetector';

export interface VisionLoopOptions {
  videoEl: HTMLVideoElement;
  landmarker: FaceLandmarker;
  onEvent: (event: VisionEvent) => void;
  smileThreshold?: number;
}

const FRAME_INTERVAL_MS = 33; // ~30fps cap

export function startVisionLoop(opts: VisionLoopOptions): () => void {
  let running = true;
  let lastTimestamp = 0;
  const threshold = opts.smileThreshold ?? SMILE_THRESHOLDS.violation;

  function tick(nowMs: number) {
    if (!running) return;

    if (nowMs - lastTimestamp >= FRAME_INTERVAL_MS) {
      lastTimestamp = nowMs;

      try {
        // skip frames until video is actually producing pixels
        if (opts.videoEl.readyState < 2 || opts.videoEl.videoWidth === 0) {
          requestAnimationFrame(tick);
          return;
        }

        const result = detectFaceLandmarks(opts.landmarker, opts.videoEl, nowMs);

        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
          opts.onEvent({
            type: 'FACE_NOT_DETECTED',
            faceState: noFaceState(nowMs),
          });
        } else {
          const faceState = landmarksToFaceState(result.faceLandmarks[0], nowMs);
          opts.onEvent({ type: 'SMILE_SCORE_UPDATE', faceState });
          if (faceState.smileScore >= threshold) {
            opts.onEvent({ type: 'VIOLATION_DETECTED', faceState });
          }
        }
      } catch {
        // skip frame on detection error
      }
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
  return () => {
    running = false;
  };
}
