import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export async function initFaceLandmarker(): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    numFaces: 1,
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
}

// Reusable offscreen canvas — avoids allocating one per frame
let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;

function getCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _ctx = _canvas.getContext('2d', { willReadFrequently: true })!;
  }
  if (_canvas.width !== w || _canvas.height !== h) {
    _canvas.width = w;
    _canvas.height = h;
  }
  return _ctx!;
}

export function detectFaceLandmarks(
  landmarker: FaceLandmarker,
  videoEl: HTMLVideoElement,
) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const ctx = getCanvas(w, h);
  ctx.drawImage(videoEl, 0, 0, w, h);

  // Debug: verify the canvas actually has pixel content
  const sample = ctx.getImageData(0, 0, 4, 4).data;
  const hasContent = sample.some((v) => v > 0);
  if (!hasContent) {
    console.warn('[faceLandmarker] canvas is blank — video not producing frames yet');
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const result = landmarker.detect(imageData);
  if (result.faceLandmarks.length === 0) {
    console.log('[faceLandmarker] no face found. dims:', w, 'x', h, 'hasContent:', hasContent);
  } else {
    console.log('[faceLandmarker] face detected! landmarks:', result.faceLandmarks.length);
  }
  return result;
}
