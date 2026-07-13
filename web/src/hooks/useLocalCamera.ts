import { useEffect, useRef, useState } from 'react';
import { startWebcam, stopWebcam } from '../vision/webcam';
import { startVisionLoop } from '../vision/visionLoop';
import { initFaceLandmarker } from '../vision/faceLandmarker';

const LAUGH_THRESHOLD = 0.5;
const STATUS_INTERVAL_MS = 250; // UI status updates, not per-frame

interface UseLocalCameraOptions {
  onLaugh?: (confidence: number) => void;
}

/**
 * Webcam + local AI laugh detection. Also exposes a live status so the
 * UI can show that the detector is actually working:
 *   aiReady    — models loaded and the loop is running
 *   faceOk     — a face is currently tracked
 *   smileScore — 0..1 latest smile score (throttled)
 */
export function useLocalCamera({ onLaugh }: UseLocalCameraOptions = {}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [faceOk, setFaceOk] = useState(false);
  const [smileScore, setSmileScore] = useState(0);
  const onLaughRef = useRef(onLaugh);
  onLaughRef.current = onLaugh;
  const lastStatusRef = useRef(0);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let stopLoop: (() => void) | null = null;
    let cancelled = false;

    // Create a hidden video element imperatively so it exists immediately
    const videoEl = document.createElement('video');
    videoEl.setAttribute('autoplay', '');
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('muted', '');
    videoEl.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;';
    document.body.appendChild(videoEl);

    async function init() {
      const result = await startWebcam(videoEl);
      if (cancelled) return;

      if ('error' in result) {
        setError(
          result.error.kind === 'permission-denied' ? 'Camera permission denied' :
          result.error.kind === 'not-found'         ? 'No camera found' : 'Camera error'
        );
        return;
      }

      activeStream = result.stream;
      setStream(result.stream);

      await initFaceLandmarker();
      if (cancelled) return;
      setAiReady(true);

      stopLoop = startVisionLoop({
        videoEl,
        onEvent: (event) => {
          if (event.type === 'VIOLATION_DETECTED') {
            onLaughRef.current?.(event.faceState.smileScore);
          }
          // Throttled status for UI indicators
          const now = Date.now();
          if (now - lastStatusRef.current >= STATUS_INTERVAL_MS) {
            lastStatusRef.current = now;
            setFaceOk(event.faceState.faceDetected);
            setSmileScore(event.faceState.smileScore);
          }
        },
        smileThreshold: LAUGH_THRESHOLD,
      });
    }

    void init();

    return () => {
      cancelled = true;
      stopLoop?.();
      if (activeStream) stopWebcam(activeStream);
      if (document.body.contains(videoEl)) document.body.removeChild(videoEl);
      setStream(null);
    };
  }, []);

  return { stream, error, aiReady, faceOk, smileScore };
}
