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

export async function detectFaceLandmarks(videoEl: HTMLVideoElement) {
  if (videoEl.videoWidth === 0) {
    console.warn('[faceapi] video not ready — videoWidth=0');
    return undefined;
  }
  const result = await faceapi
    .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks();
  if (!result) console.log('[faceapi] no detection (video ' + videoEl.videoWidth + 'x' + videoEl.videoHeight + ')');
  return result;
}
