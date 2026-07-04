import * as faceapi from 'face-api.js';
import { enhanceLowLight } from './enhance';

/**
 * Face detection + landmarks via face-api.js.
 *
 * Models (in web/public/weights/):
 *  - TinyFaceDetector — fast face localization, good enough for webcams.
 *  - FaceLandmark68Net — 68 facial landmark points for smile scoring.
 */

let loadPromise: Promise<void> | null = null;

/** Load the models once. Concurrent callers share the same load. */
export function initFaceLandmarker(): Promise<void> {
  if (!loadPromise) {
    loadPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/weights'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/weights'),
    ]).then(() => undefined).catch((err) => {
      loadPromise = null; // allow a retry after e.g. a network blip
      throw err;
    });
  }
  return loadPromise;
}

// One reusable offscreen canvas — allocating a new one per frame churns GC.
let frameCanvas: HTMLCanvasElement | null = null;

/**
 * Detect the most prominent face (with landmarks) in the current video
 * frame. Returns undefined when the video isn't ready or no face is found.
 */
export async function detectFaceLandmarks(videoEl: HTMLVideoElement) {
  if (videoEl.videoWidth === 0) return undefined;

  // Draw to a canvas first — avoids browser restrictions on direct
  // video→WebGL reads and keeps input dimensions stable.
  if (!frameCanvas) frameCanvas = document.createElement('canvas');
  if (frameCanvas.width !== videoEl.videoWidth) frameCanvas.width = videoEl.videoWidth;
  if (frameCanvas.height !== videoEl.videoHeight) frameCanvas.height = videoEl.videoHeight;

  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(videoEl, 0, 0);

  // Brighten dark frames before the AI sees them — dim rooms are the
  // most common reason face detection fails on real webcams.
  enhanceLowLight(ctx, frameCanvas.width, frameCanvas.height);

  return faceapi
    .detectSingleFace(
      frameCanvas,
      new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.15, inputSize: 416 })
    )
    .withFaceLandmarks();
}
