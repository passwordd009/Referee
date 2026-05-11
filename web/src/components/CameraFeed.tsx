import { useEffect, useRef } from 'react';
import type { FaceState } from '../types';

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  faceState: FaceState | null;
}

// MediaPipe FaceMesh 468-point landmark groups
const LANDMARK_GROUPS = {
  oval:       [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
  leftBrow:   [276,283,282,295,285,300,293,334,296,336],
  rightBrow:  [46,53,52,65,55,70,63,105,66,107],
  nose:       [168,6,197,195,5,4,1,19,94,2],
  leftEye:    [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
  rightEye:   [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398],
  lipsOuter:  [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],
  lipsInner:  [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191],
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
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.oval,       'rgba(255,255,255,0.4)', 1.2, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.nose,       'rgba(255,255,255,0.5)', 1.5, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.leftBrow,   'rgba(255,255,255,0.5)', 1.5, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.rightBrow,  'rgba(255,255,255,0.5)', 1.5, w);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.leftEye,    'rgba(100,200,255,0.8)', 1.5, w, true);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.rightEye,   'rgba(100,200,255,0.8)', 1.5, w, true);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.lipsOuter,  color, 2, w, true);
    drawGroup(ctx, landmarks, LANDMARK_GROUPS.lipsInner,  color, 1.5, w, true);
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
