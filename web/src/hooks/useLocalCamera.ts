import { useEffect, useRef, useState } from 'react';
import { startWebcam, stopWebcam } from '../vision/webcam';
import { startVisionLoop } from '../vision/visionLoop';
import { initFaceLandmarker } from '../vision/faceLandmarker';

const LAUGH_THRESHOLD = 0.5;

interface UseLocalCameraOptions {
  onLaugh?: (confidence: number) => void;
}

export function useLocalCamera({ onLaugh }: UseLocalCameraOptions = {}) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onLaughRef = useRef(onLaugh);
  onLaughRef.current = onLaugh;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopLoop: (() => void) | null = null;
    let cancelled = false;

    async function init() {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      const result = await startWebcam(videoEl);
      if (cancelled) return;

      if ('error' in result) {
        setError(
          result.error.kind === 'permission-denied' ? 'Camera permission denied' :
          result.error.kind === 'not-found' ? 'No camera found' : 'Camera error'
        );
        return;
      }
      stream = result.stream;

      await initFaceLandmarker();
      if (cancelled) return;

      stopLoop = startVisionLoop({
        videoEl,
        onEvent: (event) => {
          if (event.type === 'VIOLATION_DETECTED') {
            onLaughRef.current?.(event.faceState.smileScore);
          }
        },
        smileThreshold: LAUGH_THRESHOLD,
      });
    }

    void init();

    return () => {
      cancelled = true;
      stopLoop?.();
      if (stream) stopWebcam(stream);
    };
  }, []);

  return { videoRef, error };
}
