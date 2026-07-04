// Tests the real useLocalCamera hook (laugh decision layer).
// Usage: node run-hook-test.mjs <video.y4m> <expectLaugh: yes|no> [seconds]
import { chromium } from 'playwright-core';

const [video, expectLaugh, secs = '30'] = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:5173/hook-test.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__hookTest?.status === 'active', null, { timeout: 60000 });
await page.waitForTimeout(Number(secs) * 1000);

const t = await page.evaluate(() => window.__hookTest);
await browser.close();

console.log(JSON.stringify({ laughs: t.laughs.length, faceFrames: t.faceFrames,
  frames: t.frames, status: t.status, error: t.error, pageErrors: errors }));

const fail = [];
if (errors.length) fail.push('page errors: ' + errors.join('; '));
if (t.status !== 'active') fail.push('hook not active');
if (!t.faceFrames) fail.push('face never tracked');
if (expectLaugh === 'yes' && t.laughs.length < 1) fail.push('expected laugh, got none');
if (expectLaugh === 'no' && t.laughs.length > 0) fail.push(`FALSE PENALTY: ${t.laughs.length} laughs`);

if (fail.length) { console.log('❌ FAIL: ' + fail.join('; ')); process.exit(1); }
console.log('✅ PASS');
