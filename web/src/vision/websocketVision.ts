import type { VisionEvent, FaceState } from '../types';
import { SMILE_THRESHOLDS } from './smileDetector';

export interface WebSocketVisionOptions {
  onEvent: (event: VisionEvent) => void;
  onReady?: () => void;
  smileThreshold?: number;
  url?: string;
}

export function startWebSocketVision(opts: WebSocketVisionOptions): () => void {
  const url = opts.url ?? 'ws://localhost:8765';
  const threshold = opts.smileThreshold ?? SMILE_THRESHOLDS.violation;
  let running = true;
  let ws: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (!running) return;
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[wsVision] connected');
      opts.onReady?.();
    };

    ws.onmessage = (e: MessageEvent) => {
      if (!running) return;
      try {
        const data = JSON.parse(e.data as string) as Omit<FaceState, 'timestamp'>;
        const faceState: FaceState = { ...data, timestamp: Date.now() };

        if (!faceState.faceDetected) {
          opts.onEvent({ type: 'FACE_NOT_DETECTED', faceState });
          return;
        }

        opts.onEvent({ type: 'SMILE_SCORE_UPDATE', faceState });

        if (faceState.smileScore >= threshold) {
          opts.onEvent({ type: 'VIOLATION_DETECTED', faceState });
        }
      } catch (err) {
        console.warn('[wsVision] parse error:', err);
      }
    };

    ws.onclose = () => {
      if (running) {
        console.log('[wsVision] disconnected — retrying in 1s');
        retryTimer = setTimeout(connect, 1000);
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror, so reconnect is handled there
    };
  }

  connect();

  return () => {
    running = false;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}
