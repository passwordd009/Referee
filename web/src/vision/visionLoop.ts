import type { VisionEvent } from '../types';
import { detectFaceLandmarks } from './faceLandmarker';
import { detectionToFaceState, noFaceState, SMILE_THRESHOLDS } from './smileDetector';

export interface VisionLoopOptions {
  videoEl: HTMLVideoElement;
  onEvent: (event: VisionEvent) => void;
  smileThreshold?: number;
}

export function startVisionLoop(opts: VisionLoopOptions): () => void {
  let running = true;
  const threshold = opts.smileThreshold ?? SMILE_THRESHOLDS.violation;

  async function loop() {
    while (running) {
      // Pace to display refresh rate
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!running) break;

      const { videoEl } = opts;
      if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) continue;

      try {
        const det = await detectFaceLandmarks(videoEl);
        if (!running) break;

        const now = Date.now();
        if (!det) {
          opts.onEvent({ type: 'FACE_NOT_DETECTED', faceState: noFaceState(now) });
        } else {
          const faceState = detectionToFaceState(det, now);
          opts.onEvent({ type: 'SMILE_SCORE_UPDATE', faceState });
          if (faceState.smileScore >= threshold) {
            opts.onEvent({ type: 'VIOLATION_DETECTED', faceState });
          }
        }
      } catch (err) {
        console.warn('[visionLoop] error:', err);
      }
    }
  }

  loop();
  return () => { running = false; };
}
