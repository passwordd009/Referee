import * as faceapi from 'face-api.js';

let _loaded = false;

export async function initFaceLandmarker(): Promise<void> {
  if (_loaded) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/weights'),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri('/weights'),
  ]);
  _loaded = true;
}

export async function detectFaceLandmarks(videoEl: HTMLVideoElement) {
  return faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
    .withFaceLandmarks(true);
}
