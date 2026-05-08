import { useEffect, useRef } from 'react';
import type { FaceState } from '../types';

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  faceState: FaceState | null;
}

function smileColor(score: number): string {
  if (score < 0.3) return '#22c55e';
  if (score < 0.5) return '#eab308';
  return '#ef4444';
}

export function CameraFeed({ videoRef, faceState }: CameraFeedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !faceState) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [faceState]);

  const score = faceState?.smileScore ?? 0;
  const borderColor = faceState?.faceDetected ? smileColor(score) : '#6b7280';

  return (
    <div className="camera-container" style={{ borderColor }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-video"
      />
      <canvas ref={canvasRef} className="camera-canvas" />
    </div>
  );
}
