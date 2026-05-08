import * as faceapi from 'face-api.js';

let _loaded = false;

export async function initFaceLandmarker(): Promise<void> {
  if (_loaded) return;
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri('/weights'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/weights'),
  ]);
  _loaded = true;
}

export async function detectFaceLandmarks(videoEl: HTMLVideoElement) {
  return faceapi
    .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks();
}
