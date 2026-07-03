import { useEffect, useRef, useState } from 'react';
import { startWebcam, stopWebcam } from '../vision/webcam';
import { startVisionLoop } from '../vision/visionLoop';
import { initFaceLandmarker } from '../vision/faceLandmarker';
import { SMILE_THRESHOLDS } from '../vision/smileDetector';

/**
 * Local AI laugh detection.
 *
 * Opens the webcam into a hidden, imperatively-created <video> element
 * (so it exists before any React render), runs the face-api.js vision
 * loop on it, and calls `onLaugh` when the player laughs.
 *
 * A laugh is only reported after LAUGH_STREAK consecutive frames above
 * the smile threshold — a single glitchy frame never costs a life — and
 * at most once per EMIT_COOLDOWN_MS, so a long laugh doesn't spam the
 * server (which applies its own cooldown too).
 */

const LAUGH_STREAK = 3;
const EMIT_COOLDOWN_MS = 2_000;

/** Live detection status, for showing the player that the AI is working. */
export interface LiveFaceState {
  faceDetected: boolean;
  /** 0 (straight face) → 1 (big laugh). */
  smileScore: number;
}

export type CameraStatus = 'starting' | 'active' | 'error';

interface UseLocalCameraOptions {
  onLaugh?: (confidence: number) => void;
}

export function useLocalCamera({ onLaugh }: UseLocalCameraOptions = {}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const [faceState, setFaceState] = useState<LiveFaceState | null>(null);

  const onLaughRef = useRef(onLaugh);
  onLaughRef.current = onLaugh;

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let stopLoop: (() => void) | null = null;
    let cancelled = false;

    // Laugh confirmation state (see module comment).
    let streak = 0;
    let lastEmitAt = 0;

    // Latest frame result, synced to React state on a slow interval so
    // the game UI doesn't re-render 30 times a second.
    let latest: LiveFaceState | null = null;
    const syncTimer = setInterval(() => {
      if (!cancelled && latest) setFaceState({ ...latest });
    }, 200);

    // Hidden video element the vision loop reads frames from. The visible
    // self-view is a separate element fed the same MediaStream.
    const videoEl = document.createElement('video');
    videoEl.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;';
    document.body.appendChild(videoEl);

    async function init() {
      const result = await startWebcam(videoEl);
      if (cancelled) return;

      if ('error' in result) {
        setStatus('error');
        setError(
          result.error.kind === 'permission-denied' ? 'Camera permission denied' :
          result.error.kind === 'not-found'         ? 'No camera found' :
          result.error.kind === 'in-use'            ? 'Camera is in use by another app' :
          'Camera error'
        );
        return;
      }

      activeStream = result.stream;
      setStream(result.stream);

      try {
        await initFaceLandmarker();
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError('Could not load the AI models');
          console.error('[useLocalCamera] model load failed:', err);
        }
        return;
      }
      if (cancelled) return;

      setStatus('active');
      stopLoop = startVisionLoop({
        videoEl,
        smileThreshold: SMILE_THRESHOLDS.violation,
        onEvent: (event) => {
          if (event.type === 'FACE_NOT_DETECTED') {
            latest = { faceDetected: false, smileScore: 0 };
            streak = 0;
            return;
          }

          latest = { faceDetected: true, smileScore: event.faceState.smileScore };

          if (event.type === 'VIOLATION_DETECTED') {
            streak += 1;
            const now = Date.now();
            if (streak >= LAUGH_STREAK && now - lastEmitAt >= EMIT_COOLDOWN_MS) {
              lastEmitAt = now;
              onLaughRef.current?.(event.faceState.smileScore);
            }
          } else if (event.faceState.smileScore < SMILE_THRESHOLDS.violation) {
            streak = 0;
          }
        },
      });
    }

    void init();

    return () => {
      cancelled = true;
      clearInterval(syncTimer);
      stopLoop?.();
      if (activeStream) stopWebcam(activeStream);
      if (document.body.contains(videoEl)) document.body.removeChild(videoEl);
      setStream(null);
    };
  }, []);

  return { stream, status, error, faceState };
}
