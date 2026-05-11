import * as faceapi from 'face-api.js';

let _loaded = false;

export async function initFaceLandmarker(): Promise<void> {
  if (_loaded) return;
  // TinyFaceDetector for reliable detection + full 68-point model for accurate landmarks
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/weights'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/weights'),
  ]);
  _loaded = true;
}

export async function detectFaceLandmarks(videoEl: HTMLVideoElement) {
  if (videoEl.videoWidth === 0) return undefined;

  // Draw to offscreen canvas — avoids browser restrictions on direct video→WebGL reads
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(videoEl, 0, 0);

  return faceapi
    .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.15, inputSize: 416 }))
    .withFaceLandmarks();
}
