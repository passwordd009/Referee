/**
 * Standalone laugh-detector check (/vision-test.html) — runs the exact
 * same camera + AI pipeline as a match, no sign-in needed. Also exposes
 * window.__vt for the automated browser test.
 */
import { startWebcam } from './vision/webcam';
import { initFaceLandmarker } from './vision/faceLandmarker';
import { startVisionLoop } from './vision/visionLoop';

interface VtStatus {
  cameraOk: boolean;
  modelsLoaded: boolean;
  frames: number;
  faceFrames: number;
  lastScore: number;
  laughs: number;
  error: string | null;
}

const vt: VtStatus = {
  cameraOk: false, modelsLoaded: false, frames: 0,
  faceFrames: 0, lastScore: 0, laughs: 0, error: null,
};
(window as unknown as { __vt: VtStatus }).__vt = vt;

const statusEl = document.getElementById('status')!;
const fillEl   = document.getElementById('fill')!;
const laughEl  = document.getElementById('laugh')!;
const videoEl  = document.getElementById('preview') as HTMLVideoElement;

async function main() {
  const result = await startWebcam(videoEl);
  if ('error' in result) {
    vt.error = result.error.kind;
    statusEl.textContent = `camera error: ${result.error.kind}`;
    return;
  }
  vt.cameraOk = true;
  statusEl.textContent = 'camera ok — loading AI models…';

  await initFaceLandmarker();
  vt.modelsLoaded = true;
  statusEl.textContent = 'AI ready — looking for your face…';

  let laughTimer: ReturnType<typeof setTimeout> | null = null;
  startVisionLoop({
    videoEl,
    onEvent: (event) => {
      vt.frames += 1;
      if (event.type === 'FACE_NOT_DETECTED') {
        statusEl.textContent = 'no face — get in frame';
        fillEl.style.width = '0%';
        return;
      }
      vt.faceFrames += 1;
      vt.lastScore = event.faceState.smileScore;
      fillEl.style.width = `${Math.min(100, event.faceState.smileScore * 100)}%`;
      statusEl.textContent = `face tracked — smile score ${event.faceState.smileScore.toFixed(2)}`;
      if (event.type === 'VIOLATION_DETECTED') {
        vt.laughs += 1;
        laughEl.style.visibility = 'visible';
        if (laughTimer) clearTimeout(laughTimer);
        laughTimer = setTimeout(() => { laughEl.style.visibility = 'hidden'; }, 1200);
      }
    },
  });
}

void main();
