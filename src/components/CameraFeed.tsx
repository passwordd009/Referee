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
    const video = videoRef.current;
    if (!canvas || !video) return;

    const w = video.videoWidth || canvas.offsetWidth;
    const h = video.videoHeight || canvas.offsetHeight;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (!faceState?.faceDetected || !faceState.box) return;

    const { box, smileScore } = faceState;
    const color = smileColor(smileScore);

    // Mirror x to match the CSS scaleX(-1) on the video element
    const mx = w - box.x - box.width;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeRect(mx, box.y, box.width, box.height);

    // Score label
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`${Math.round(smileScore * 100)}%`, mx + 4, box.y - 6);
  }, [faceState]);

  const score = faceState?.smileScore ?? 0;
  const borderColor = faceState?.faceDetected ? smileColor(score) : '#6b7280';

  return (
    <div className="camera-container" style={{ borderColor }}>
      <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
      <canvas ref={canvasRef} className="camera-canvas" />
    </div>
  );
}
