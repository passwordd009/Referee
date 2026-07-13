/**
 * Unit test of the laugh-detector scoring math — feeds hand-crafted
 * 68-point landmarks (neutral face vs grin) into detectionToFaceState.
 * Run: npx tsx web/test/smileDetector.test.mjs
 */
import { detectionToFaceState, SMILE_THRESHOLDS } from '../src/vision/smileDetector.ts';

const ok  = (msg) => console.log(`  ✓ ${msg}`);
const die = (msg) => { console.error(`  ✗ FAIL: ${msg}`); process.exit(1); };

/**
 * Build a fake face-api detection. Face is 100px wide (jaw x 100→200).
 * Only the landmark indices the detector reads matter:
 *   0/16 jaw corners, 48/54 mouth corners, 51/57 lip top/bottom.
 */
function fakeDet({ cornerRise = 0, mouthWidth = 35, lipGap = 10 }) {
  const positions = Array.from({ length: 68 }, () => ({ x: 150, y: 150 }));
  positions[0]  = { x: 100, y: 120 };                       // jaw left
  positions[16] = { x: 200, y: 120 };                       // jaw right
  positions[51] = { x: 150, y: 150 - lipGap / 2 };          // lip top
  positions[57] = { x: 150, y: 150 + lipGap / 2 };          // lip bottom
  // corners rise above the lip midline (y=150) when smiling
  positions[48] = { x: 150 - mouthWidth / 2, y: 150 - cornerRise }; // mouth left
  positions[54] = { x: 150 + mouthWidth / 2, y: 150 - cornerRise }; // mouth right
  return {
    landmarks: { positions },
    detection: { box: { x: 100, y: 80, width: 100, height: 130 } },
  };
}

const score = (opts) => detectionToFaceState(fakeDet(opts), Date.now()).smileScore;

// Neutral: corners level with the lip midline, resting mouth width
const neutral = score({ cornerRise: 0, mouthWidth: 35 });
if (neutral >= SMILE_THRESHOLDS.violation) die(`neutral face scored ${neutral} (>= ${SMILE_THRESHOLDS.violation})`);
ok(`neutral face scores ${neutral.toFixed(2)} — below the ${SMILE_THRESHOLDS.violation} violation threshold`);

// Slight smirk: a bit of corner rise, slightly wider
const smirk = score({ cornerRise: 2, mouthWidth: 38 });
if (smirk >= SMILE_THRESHOLDS.violation) die(`smirk scored ${smirk} — too trigger-happy`);
ok(`slight smirk scores ${smirk.toFixed(2)} — still safe`);

// Big grin: strong corner rise + wide mouth
const grin = score({ cornerRise: 7, mouthWidth: 50 });
if (grin < SMILE_THRESHOLDS.violation) die(`grin scored ${grin} (< ${SMILE_THRESHOLDS.violation}) — laugh would be missed`);
if (grin < SMILE_THRESHOLDS.laugh) die(`grin scored ${grin} — expected a full laugh (>= ${SMILE_THRESHOLDS.laugh})`);
ok(`big grin scores ${grin.toFixed(2)} — fires the laugh threshold (${SMILE_THRESHOLDS.laugh})`);

// Monotonic: more smile → higher score
const s1 = score({ cornerRise: 1, mouthWidth: 36 });
const s2 = score({ cornerRise: 3, mouthWidth: 42 });
const s3 = score({ cornerRise: 6, mouthWidth: 48 });
if (!(s1 < s2 && s2 < s3)) die(`scores not monotonic: ${s1}, ${s2}, ${s3}`);
ok(`scoring is monotonic in smile intensity (${s1.toFixed(2)} < ${s2.toFixed(2)} < ${s3.toFixed(2)})`);

// Mouth-open detection (used by future rounds)
const open = detectionToFaceState(fakeDet({ lipGap: 12 }), Date.now());
const closed = detectionToFaceState(fakeDet({ lipGap: 2 }), Date.now());
if (!open.mouthOpen || closed.mouthOpen) die('mouthOpen detection wrong');
ok('mouth-open detection works');

// No face
console.log('\n✅ SMILE DETECTOR MATH PASSES');
