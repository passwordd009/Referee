import * as faceapi from 'face-api.js';

let _loaded = false;

export async function initFaceLandmarker(): Promise<void> {
  if (_loaded) return;

  // Log TF.js backend state before loading models
  const tf = (faceapi as any).tf ?? (window as any).tf;
  if (tf) {
    console.log('[faceapi] tf backend before init:', tf.getBackend());
    try { await tf.ready(); console.log('[faceapi] tf backend after ready():', tf.getBackend()); }
    catch (e) { console.error('[faceapi] tf.ready() threw:', e); }
  } else {
    console.warn('[faceapi] tf not accessible on faceapi or window');
  }

  console.log('[faceapi] loading SSD + landmark models from /weights …');
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri('/weights'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/weights'),
  ]);
  console.log('[faceapi] models loaded ✓');
  _loaded = true;
}

let _diagCount = 0;

export async function detectFaceLandmarks(videoEl: HTMLVideoElement) {
  if (videoEl.videoWidth === 0) return undefined;

  // Draw to an offscreen canvas — some browsers restrict direct video→WebGL reads
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(videoEl, 0, 0);

  // Log frame brightness once every 90 frames to confirm we have real pixel data
  if (_diagCount++ % 90 === 0) {
    const d = ctx.getImageData(100, 100, 20, 20).data;
    const avg = Array.from(d).filter((_, i) => i % 4 !== 3).reduce((s, v) => s + v, 0) / (20 * 20 * 3);
    console.log('[faceapi] frame brightness sample (should be >20):', avg.toFixed(1),
      '| size:', videoEl.videoWidth + 'x' + videoEl.videoHeight);
  }

  const result = await faceapi
    .detectSingleFace(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.1 }))
    .withFaceLandmarks();

  if (!result && _diagCount % 90 === 1) console.log('[faceapi] no detection at minConfidence 0.1');
  return result;
}
