// Automated laugh-detection test: drives web/vision-test.html in real
// Chromium with a fake webcam video and asserts the AI pipeline behaves.
//
// Usage:
//   node run-vision-test.mjs <video.y4m> <expectLaugh: yes|no> [url]
//
// Generate the .y4m fixtures first (needs python3 + pillow):
//   python3 make_y4m.py fixtures/smiling.jpg smiling.y4m   # must laugh
//   python3 make_y4m.py fixtures/talking.jpg talking.y4m   # must NOT laugh
//
// Then, with the web dev server running (npm run dev:web):
//   node run-vision-test.mjs "$PWD/smiling.y4m" yes
//   node run-vision-test.mjs "$PWD/talking.y4m" no
import { chromium } from 'playwright-core';

const [video, expectLaugh, url = 'http://localhost:5173/vision-test.html'] = process.argv.slice(2);
if (!video || !['yes', 'no'].includes(expectLaugh)) {
  console.error('usage: node run-vision-test.mjs <video.y4m> <yes|no> [url]');
  process.exit(2);
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',        // auto-accept the camera prompt
    '--use-fake-device-for-media-stream',    // fake webcam...
    `--use-file-for-fake-video-capture=${video}`, // ...playing this video
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();

const consoleLines = [];
page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => consoleLines.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });

// Wait until the pipeline errored or analyzed enough frames to judge.
await page.waitForFunction(
  () => window.__visionTest && (window.__visionTest.phase === 'error' ||
        window.__visionTest.framesWithFace + window.__visionTest.framesWithoutFace >= 25),
  null, { timeout: 90000 }
).catch(() => {});

const result = await page.evaluate(() => {
  const t = window.__visionTest ?? {};
  return { ...t, scores: undefined,
           maxScore: t.scores?.length ? Math.max(...t.scores) : null };
});
await browser.close();

console.log(consoleLines.filter(l => !l.startsWith('[debug]')).join('\n'));
console.log(JSON.stringify(result, null, 2));

const fail = [];
if (result.phase === 'error') fail.push('pipeline errored: ' + result.errors);
if (!result.framesWithFace) fail.push('face never detected');
if (expectLaugh === 'yes' && !result.violations) fail.push('expected LAUGH, none fired');
if (expectLaugh === 'no' && result.violations > 0) fail.push(`false positive: ${result.violations} laughs on a non-smiling face`);

if (fail.length) { console.log('❌ FAIL: ' + fail.join('; ')); process.exit(1); }
console.log('✅ PASS');
