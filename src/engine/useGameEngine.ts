import { useReducer, useRef, useEffect, useState, useCallback } from 'react';
import type { FaceState, RefereeEvent, GameAction, GameState } from '../types';
import { reduceGameState, initialGameState } from './gameEngine';
import { startWebcam, stopWebcam } from '../vision/webcam';
import { startWebSocketVision } from '../vision/websocketVision';
import { WATER_HOLD_SMILE_THRESHOLD } from './modes/waterHoldMode';
import { createRefereeEvent } from '../referee/refereeEngine';

export interface GameEngineResult {
  gameState: GameState;
  faceState: FaceState | null;
  refereeEvents: RefereeEvent[];
  videoRef: React.RefObject<HTMLVideoElement>;
  isVisionReady: boolean;
  webcamError: string | null;
  dispatch: (action: GameAction) => void;
}

export function useGameEngine(): GameEngineResult {
  const [gameState, dispatch] = useReducer(reduceGameState, initialGameState);
  const [faceState, setFaceState] = useState<FaceState | null>(null);
  const [refereeEvents, setRefereeEvents] = useState<RefereeEvent[]>([]);
  const [isVisionReady, setIsVisionReady] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const gameStateRef = useRef(gameState);
  const streamRef = useRef<MediaStream | null>(null);

  // keep ref in sync so vision loop callback reads latest state without stale closure
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // initialize MediaPipe + webcam once on mount
  useEffect(() => {
    let cancelled = false;
    let stopLoop: (() => void) | null = null;

    async function init() {
      const videoEl = videoRef.current;
      if (!videoEl) return;

        const result = await startWebcam(videoEl);
      if (cancelled) return;

      if ('error' in result) {
        const { error } = result;
        if (error.kind === 'permission-denied') {
          setWebcamError('Camera permission denied. Please allow camera access and refresh.');
        } else if (error.kind === 'not-found') {
          setWebcamError('No camera found. Please connect a webcam and refresh.');
        } else {
          setWebcamError('Could not start webcam.');
        }
        return;
      }

      streamRef.current = result.stream;

      const threshold =
        gameStateRef.current.mode === 'WaterHold'
          ? WATER_HOLD_SMILE_THRESHOLD
          : undefined;

      stopLoop = startWebSocketVision({
        smileThreshold: threshold,
        onReady: () => {
          if (!cancelled) setIsVisionReady(true);
        },
        onEvent: (event) => {
          setFaceState(event.faceState);

          const currentState = gameStateRef.current;
          const refereeEvent = createRefereeEvent(event, currentState);
          if (refereeEvent) {
            setRefereeEvents((prev) => [refereeEvent, ...prev].slice(0, 20));
          }

          dispatch({ type: 'VISION_EVENT', event });
        },
      });
    }

    init();

    return () => {
      cancelled = true;
      stopLoop?.();
      if (streamRef.current) {
        stopWebcam(streamRef.current);
        streamRef.current = null;
      }
    };
  }, []);

  // timer loop — runs during countdown and playing
  useEffect(() => {
    if (gameState.status !== 'countdown' && gameState.status !== 'playing') return;

    let lastTime: number | null = null;
    let rafId: number;

    function tick(now: number) {
      if (lastTime !== null) {
        dispatch({ type: 'TIMER_TICK', deltaMs: now - lastTime });
      }
      lastTime = now;
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gameState.status]);

  const stableDispatch = useCallback((action: GameAction) => dispatch(action), []);

  return { gameState, faceState, refereeEvents, videoRef, isVisionReady, webcamError, dispatch: stableDispatch };
}
