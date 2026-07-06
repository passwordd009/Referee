import { useEffect, useRef, useState } from 'react';
import { startWebcam, stopWebcam } from '../vision/webcam';
import { startVisionLoop } from '../vision/visionLoop';
import { initFaceLandmarker } from '../vision/faceLandmarker';
import { getEnhancementState } from '../vision/enhance';
import { SMILE_THRESHOLDS } from '../vision/smileDetector';

/**
 * Local AI laugh detection.
 *
 * Opens the webcam into a hidden, imperatively-created <video> element
 * (so it exists before any React render), runs the face-api.js vision
 * loop on it, and calls `onLaugh` when the player laughs.
 *
 * A laugh is only reported when the last LAUGH_STREAK face frames are
 * all above the smile threshold AND agree with each other (small
 * frame-to-frame spread). Real smiles hold a steady high score; noisy
 * feeds — dim rooms, grainy webcams — produce erratic spikes that never
 * stay consistent, so this blocks false penalties without making
 * genuine laughs harder to detect. Emits at most once per
 * EMIT_COOLDOWN_MS; the server applies its own cooldown too.
 */

const LAUGH_STREAK = 3;
/** Max spread between the streak's scores for them to count as one laugh. */
const MAX_SCORE_SPREAD = 0.25;
const EMIT_COOLDOWN_MS = 2_000;
/** Water Hold: consecutive open-mouth frames that count as spilling. */
const MOUTH_OPEN_STREAK = 3;

export type ViolationKind = 'laugh' | 'water';

/** Live detection status, for showing the player that the AI is working. */
export interface LiveFaceState {
  faceDetected: boolean;
  /** 0 (straight face) → 1 (big laugh). */
  smileScore: number;
  /** True while the low-light boost is brightening frames for the AI. */
  lowLight: boolean;
}

export type CameraStatus = 'starting' | 'active' | 'error';

interface UseLocalCameraOptions {
  onLaugh?: (confidence: number, kind: ViolationKind) => void;
  /**
   * 'water' (Water Hold) also treats a sustained open mouth as a
   * violation — you spat, swallowed, or broke the seal.
   */
  watchMode?: 'laugh' | 'water';
}

export function useLocalCamera({ onLaugh, watchMode = 'laugh' }: UseLocalCameraOptions = {}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const [faceState, setFaceState] = useState<LiveFaceState | null>(null);

  const onLaughRef = useRef(onLaugh);
  onLaughRef.current = onLaugh;
  // Ref, not closure: the game mode arrives from the server after mount.
  const watchModeRef = useRef(watchMode);
  watchModeRef.current = watchMode;

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let stopLoop: (() => void) | null = null;
    let cancelled = false;

    // Laugh confirmation state (see module comment).
    const recentScores: number[] = [];
    let mouthOpenStreak = 0;
    let lastEmitAt = 0;

    // Latest frame result, synced to React state on a slow interval so
    // the game UI doesn't re-render 30 times a second.
    let latest: LiveFaceState | null = null;
    const syncTimer = setInterval(() => {
      if (!cancelled && latest) {
        setFaceState({ ...latest, lowLight: getEnhancementState().boosting });
      }
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
            latest = { faceDetected: false, smileScore: 0, lowLight: false };
            recentScores.length = 0;
            mouthOpenStreak = 0;
            return;
          }
          if (event.type !== 'SMILE_SCORE_UPDATE') return;

          const score = event.faceState.smileScore;
          latest = { faceDetected: true, smileScore: score, lowLight: false };
          const now = Date.now();

          // Water Hold: a sustained open mouth is a violation on its own.
          if (watchModeRef.current === 'water') {
            mouthOpenStreak = event.faceState.mouthOpen ? mouthOpenStreak + 1 : 0;
            if (mouthOpenStreak >= MOUTH_OPEN_STREAK && now - lastEmitAt >= EMIT_COOLDOWN_MS) {
              lastEmitAt = now;
              onLaughRef.current?.(1, 'water');
              return;
            }
          }

          recentScores.push(score);
          if (recentScores.length > LAUGH_STREAK) recentScores.shift();
          if (recentScores.length < LAUGH_STREAK) return;

          const min = Math.min(...recentScores);
          const max = Math.max(...recentScores);
          const isLaugh = min >= SMILE_THRESHOLDS.violation && max - min <= MAX_SCORE_SPREAD;

          if (isLaugh && now - lastEmitAt >= EMIT_COOLDOWN_MS) {
            lastEmitAt = now;
            onLaughRef.current?.(min, 'laugh');
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
