/**
 * Adaptive low-light enhancement for the vision pipeline.
 *
 * Face detection degrades badly in dim rooms, so before each frame
 * reaches the AI we run an "auto-levels" pass:
 *
 *  1. Build a brightness histogram of the frame (subsampled).
 *  2. If even the bright end (95th percentile) is dim, the *scene* is
 *     dark — not just someone in front of a dark wall — so we stretch
 *     the frame's actual brightness range to full range. That restores
 *     both brightness and contrast, which is what the detector needs.
 *  3. Well-lit frames pass through untouched.
 *
 * Cost: a subsampled histogram every frame, plus one pass through a
 * precomputed 256-entry lookup table when boosting (~1-2 ms at 640x480).
 */

/** Boost only when the frame's 95th-percentile luma is below this. */
const DARK_P95 = 110;
/** Stretch the [p5, p95] range onto [OUT_LO, OUT_HI]. */
const OUT_LO = 8;
const OUT_HI = 235;
/** Measure every Nth pixel — plenty accurate for a histogram. */
const SAMPLE_STRIDE = 16;

// Smoothed percentiles so the boost adapts instead of flickering.
let smoothP05: number | null = null;
let smoothP95: number | null = null;

// Cached lookup table, rebuilt only when the stretch changes noticeably.
let lut: Uint8Array | null = null;
let lutKey = '';

// Diagnostics for UIs / tests.
let lastBoosting = false;
let lastP95 = 255;

function percentiles(data: Uint8ClampedArray): { p05: number; p95: number } {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += 4 * SAMPLE_STRIDE) {
    const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
    hist[luma]++;
    total++;
  }
  let p05 = 0, p95 = 255, acc = 0;
  const lo = total * 0.05, hi = total * 0.95;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (p05 === 0 && acc >= lo) p05 = v;
    if (acc >= hi) { p95 = v; break; }
  }
  return { p05, p95 };
}

function getLut(p05: number, p95: number): Uint8Array {
  // Quantize inputs so consecutive near-identical frames reuse the table.
  const qLo = Math.round(p05 / 4) * 4;
  const qHi = Math.round(p95 / 4) * 4;
  const key = `${qLo}:${qHi}`;
  if (!lut || lutKey !== key) {
    const scale = (OUT_HI - OUT_LO) / Math.max(4, qHi - qLo);
    lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      lut[v] = Math.max(0, Math.min(255, Math.round(OUT_LO + (v - qLo) * scale)));
    }
    lutKey = key;
  }
  return lut;
}

/**
 * Auto-level the canvas in place if the scene is dark.
 * Returns true when a boost was applied.
 */
export function enhanceLowLight(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const frame = ctx.getImageData(0, 0, width, height);
  const { p05, p95 } = percentiles(frame.data);

  smoothP05 = smoothP05 === null ? p05 : smoothP05 * 0.8 + p05 * 0.2;
  smoothP95 = smoothP95 === null ? p95 : smoothP95 * 0.8 + p95 * 0.2;
  lastP95 = smoothP95;

  if (smoothP95 >= DARK_P95 || smoothP95 < 2) {
    lastBoosting = false;
    return false;
  }

  const table = getLut(smoothP05, smoothP95);
  const data = frame.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = table[data[i]];
    data[i + 1] = table[data[i + 1]];
    data[i + 2] = table[data[i + 2]];
  }
  ctx.putImageData(frame, 0, 0);

  lastBoosting = true;
  return true;
}

/** Diagnostics: is the low-light boost active, and how dark is the scene. */
export function getEnhancementState(): { boosting: boolean; p95: number } {
  return { boosting: lastBoosting, p95: lastP95 };
}
