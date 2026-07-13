/**
 * Browser test of the camera + AI pipeline. Launches headless Chromium
 * with a fake webcam, opens /vision-test.html and asserts:
 *   - getUserMedia works (camera acquired)
 *   - face-api models load from /weights
 *   - the vision loop is processing frames
 *
 * Run (with the web dev server up on :5173):
 *   node web/test/vision-browser.e2e.mjs
 */
import { chromium } from 'playwright-core';

const URL = process.env.VT_URL ?? 'http://localhost:5173/vision-test.html';
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const die = (msg) => { console.error(`  ✗ FAIL: ${msg}`); process.exit(1); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-fake-device-for-media-stream', // synthetic webcam feed
    '--use-fake-ui-for-media-stream',     // auto-grant permission
    '--no-sandbox',
  ],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });

  await page.waitForFunction(() => window.__vt?.cameraOk === true, null, { timeout: 15_000 })
    .catch(() => die(`camera not acquired — __vt=${JSON.stringify(page.__vt)}`));
  ok('camera acquired via getUserMedia (fake device, permission auto-granted)');

  await page.waitForFunction(() => window.__vt?.modelsLoaded === true, null, { timeout: 30_000 })
    .catch(() => die('face-api models failed to load from /weights'));
  ok('face-api models loaded (TinyFaceDetector + 68-point landmarks)');

  await page.waitForFunction(() => window.__vt?.frames > 20, null, { timeout: 20_000 })
    .catch(() => die('vision loop not processing frames'));
  const vt = await page.evaluate(() => window.__vt);
  ok(`vision loop live — ${vt.frames} frames analyzed`);

  // The fake device is a test pattern, not a face — detector should
  // correctly report "no face" rather than hallucinate one.
  if (vt.faceFrames > vt.frames * 0.5) die(`detector hallucinated faces on a test pattern (${vt.faceFrames}/${vt.frames})`);
  ok(`no false faces on the synthetic pattern (${vt.faceFrames}/${vt.frames} face frames)`);

  const video = await page.evaluate(() => {
    const v = document.getElementById('preview');
    return { w: v.videoWidth, h: v.videoHeight, playing: !v.paused };
  });
  if (!video.playing || video.w === 0) die(`video element not playing: ${JSON.stringify(video)}`);
  ok(`video element playing at ${video.w}x${video.h}`);

  if (errors.length) die(`page errors: ${errors.join(' | ')}`);
  ok('no page errors');

  console.log('\n✅ CAMERA + VISION PIPELINE PASSES IN BROWSER');
} finally {
  await browser.close();
}
