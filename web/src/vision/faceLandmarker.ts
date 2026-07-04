import * as faceapi from 'face-api.js';
import {
  enhanceLowLight,
  faceExposureBoost,
  applyGamma,
  resetFaceExposure,
  getEnhancementState,
  type FaceRegion,
} from './enhance';

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

// Previous (raw) frame, for temporal denoising in difficult conditions.
let historyCanvas: HTMLCanvasElement | null = null;
let historyValid = false;

// Last known face location (padded), for face-aware exposure metering.
let lastFaceBox: FaceRegion | null = null;
let missStreak = 0;

// "Hard mode": a bigger detector input and lower score threshold for
// faces the standard pass can't find (underexposed faces, heavy noise).
// Costs ~2x inference time, so it's entered only when needed and exited
// as soon as the standard pass works again.
let hardMode = false;
let framesSinceProbe = 0;

/** Extra brightening tried when a frame yields no detection at all. */
const RETRY_GAMMA = 2.2;
/** Forget the face location after this many consecutive missed frames. */
const MAX_MISSES = 30;
/** Standard detector settings. */
const STD_INPUT = 416;
const STD_THRESHOLD = 0.15;
/** Hard-mode detector settings. */
const HARD_INPUT = 608;
const HARD_THRESHOLD = 0.06;
/** Leave hard mode when the standard pass scores at least this. */
const EXIT_SCORE = 0.25;
/** In hard mode, re-try the cheaper standard pass every N frames. */
const PROBE_EVERY = 30;

function detectAt(input: number, threshold: number) {
  return faceapi
    .detectSingleFace(
      frameCanvas!,
      new faceapi.TinyFaceDetectorOptions({ scoreThreshold: threshold, inputSize: input })
    )
    .withFaceLandmarks();
}

type Detection = Awaited<ReturnType<typeof detectAt>>;

/**
 * Hard mode accepts very low detector scores, so guard against a patch
 * of furniture being "found": a webcam player's face is never tiny.
 */
function plausible(det: Detection, frameWidth: number): Detection {
  if (det && det.detection.box.width < frameWidth * 0.1) return undefined;
  return det;
}

function padBox(box: { x: number; y: number; width: number; height: number }): FaceRegion {
  const pad = 0.35;
  return {
    x: box.x - box.width * pad,
    y: box.y - box.height * pad,
    width: box.width * (1 + 2 * pad),
    height: box.height * (1 + 2 * pad),
  };
}

/**
 * Average the current frame with the previous one. Sensor noise is
 * independent frame to frame, so blending cancels much of it — a big
 * help for underexposed faces, where boosting also amplifies grain.
 */
function temporalDenoise(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  if (!historyCanvas) historyCanvas = document.createElement('canvas');
  if (historyCanvas.width !== width || historyCanvas.height !== height) {
    historyCanvas.width = width;
    historyCanvas.height = height;
    historyValid = false;
  }

  if (historyValid) {
    // Weight history harder in hard mode — those are the noisiest feeds,
    // and landmark accuracy there depends on suppressing the grain.
    ctx.globalAlpha = hardMode ? 0.65 : 0.5;
    ctx.drawImage(historyCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // The blended frame becomes the new history (exponential average).
  const hctx = historyCanvas.getContext('2d');
  if (hctx) {
    hctx.drawImage(frameCanvas!, 0, 0);
    historyValid = true;
  }
}

/**
 * Detect the most prominent face (with landmarks) in the current video
 * frame. Returns undefined when the video isn't ready or no face is found.
 *
 * The pipeline is deliberately layered so that players in difficult
 * conditions — dim rooms, darker skin tones, backlighting, noisy
 * webcams — get extra help without slowing anyone else down:
 *
 *  1. Temporal denoise (only while boosts are active).
 *  2. Scene-level auto-levels when the whole frame is dark.
 *  3. Face-aware gamma lift when the face region is underexposed even
 *     though the scene looks fine.
 *  4. Standard detection; if it fails, brighten hard and retry with a
 *     bigger input and lower threshold ("hard mode"). Hard mode then
 *     persists — probing the cheaper pass occasionally — until the
 *     standard pass works again.
 */
export async function detectFaceLandmarks(videoEl: HTMLVideoElement) {
  if (videoEl.videoWidth === 0) return undefined;

  // Draw to a canvas first — avoids browser restrictions on direct
  // video→WebGL reads and lets us enhance the frame before detection.
  if (!frameCanvas) frameCanvas = document.createElement('canvas');
  if (frameCanvas.width !== videoEl.videoWidth) frameCanvas.width = videoEl.videoWidth;
  if (frameCanvas.height !== videoEl.videoHeight) frameCanvas.height = videoEl.videoHeight;
  const width = frameCanvas.width;
  const height = frameCanvas.height;

  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(videoEl, 0, 0);

  if (hardMode || getEnhancementState().boosting) {
    temporalDenoise(ctx, width, height);
  } else {
    historyValid = false;
  }

  enhanceLowLight(ctx, width, height);
  if (lastFaceBox) faceExposureBoost(ctx, width, height, lastFaceBox);

  let det: Detection;

  if (hardMode && ++framesSinceProbe < PROBE_EVERY) {
    det = plausible(await detectAt(HARD_INPUT, HARD_THRESHOLD), width);
  } else {
    // Standard pass (also serves as the periodic hard-mode probe).
    framesSinceProbe = 0;
    det = await detectAt(STD_INPUT, STD_THRESHOLD);

    if (det) {
      if (det.detection.score >= EXIT_SCORE) hardMode = false;
    } else {
      // Nothing found: brighten hard and escalate the detector. This is
      // what first locks onto underexposed faces.
      applyGamma(ctx, width, height, RETRY_GAMMA);
      det = plausible(await detectAt(HARD_INPUT, HARD_THRESHOLD), width);
      if (det) hardMode = true;
    }
  }

  if (det) {
    lastFaceBox = padBox(det.detection.box);
    missStreak = 0;
  } else if (++missStreak >= MAX_MISSES) {
    lastFaceBox = null;
    missStreak = 0;
    hardMode = false;
    resetFaceExposure();
  }

  return det;
}
