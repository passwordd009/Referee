import { useEffect, useRef } from 'react';
import type { FaceState } from '../types';

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  faceState: FaceState | null;
}

// face-api.js 68-point landmark groups
const LANDMARK_GROUPS = {
  jaw:        [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
  leftBrow:   [17,18,19,20,21],
  rightBrow:  [22,23,24,25,26],
  nose:       [27,28,29,30,31,32,33,34,35],
  leftEye:    [36,37,38,39,40,41],
  rightEye:   [42,43,44,45,46,47],
  mouthOuter: [48,49,50,51,52,53,54,55,56,57,58,59],
  mouthInner: [60,61,62,63,64,65,66,67],
};

function smileColor(score: number): string {
  if (score < 0.3) return '#22c55e';
  if (score < 0.5) return '#eab308';
  return '#ef4444';
}

function drawGroup(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  indices: number[],
  color: string,
  radius: number,
  videoWidth: number,
  close = false
) {
  const mirrored = indices.map((i) => ({ x: videoWidth - pts[i].x, y: pts[i].y }));

  // Connect the dots
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.7;
  mirrored.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (close) ctx.closePath();
  ctx.stroke();

  // Draw dots
  mirrored.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
  });

  ctx.globalAlpha = 1;
}

export function CameraFeed({ videoRef, faceState }: CameraFeedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const w = video.videoWidth || canvas.offsetWidth;
    const h = video.videoHeight || canvas.offsetHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (!faceState?.faceDetected || !faceState.landmarks || !faceState.box) return;

    const { landmarks, smileScore, box } = faceState;
    const color = smileColor(smileScore);

    // Bounding box
    const mx = w - box.x - box.width;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(mx, box.y, box.width, box.height);
    ctx.globalAlpha = 1;

    // Score label
    ctx.fillStyle = color;
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`smile ${Math.round(smileScore * 100)}%`, mx + 4, box.y - 6);

    // Landmark groups
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.jaw,        'rgba(255,255,255,0.5)', 1.5, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.nose,       'rgba(255,255,255,0.5)', 1.5, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.leftBrow,   'rgba(255,255,255,0.5)', 1.5, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.rightBrow,  'rgba(255,255,255,0.5)', 1.5, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.leftEye,    'rgba(100,200,255,0.8)', 1.5, w, true);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.rightEye,   'rgba(100,200,255,0.8)', 1.5, w, true);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.mouthOuter, color, 2, w, true);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.mouthInner, color, 1.5, w, true);
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
