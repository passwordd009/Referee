import { useEffect, useRef, useState } from 'react';
import { startWebcam, stopWebcam } from '../vision/webcam';
import { startVisionLoop } from '../vision/visionLoop';
import { initFaceLandmarker } from '../vision/faceLandmarker';

const LAUGH_THRESHOLD = 0.5;

interface UseLocalCameraOptions {
  onLaugh?: (confidence: number) => void;
}

export function useLocalCamera({ onLaugh }: UseLocalCameraOptions = {}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const onLaughRef = useRef(onLaugh);
  onLaughRef.current = onLaugh;

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
      if (activeStream) stopWebcam(activeStream);
      if (document.body.contains(videoEl)) document.body.removeChild(videoEl);
      setStream(null);
    };
  }, []);

  return { stream, error };
}
