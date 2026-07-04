# Laugh detection tests

Automated proof that the AI laugh detection works: a real Chromium browser
runs the actual vision pipeline against a **fake webcam** playing a face
video. Two layers are tested:

- **Vision layer** (`run-vision-test.mjs` → `web/vision-test.html`): raw
  face tracking + smile scoring. Asserts faces are found and smiles score
  above/below the threshold.
- **Decision layer** (`run-hook-test.mjs` → `web/hook-test.html`): the real
  `useLocalCamera` hook, which is what the game uses to deduct lives. A
  laugh fires only for a *stable* streak of high scores — erratic scores
  from noisy/dark feeds never cause a penalty.

## Fixtures

| File | What it tests |
|---|---|
| `smiling.jpg` | Big smile — must fire a laugh |
| `talking.jpg` | Mouth open, talking, not smiling — must NOT fire |
| `smiling-darker-tone.jpg` | Same smile, facial reflectance reduced to 40% |
| `smiling-darkest-tone.jpg` | Same smile, facial reflectance reduced to 25% |
| `smiling-backlit.jpg` | Dark face against a brightened background |

The base photos are public-domain official White House portraits (from the
`face_recognition` package's test suite). The tone variants are generated
by `make_dark_face.py`, which reduces luminance inside a feathered face
mask only — background, expression, and geometry stay identical. This is a
*controlled reflectance stress test* that isolates how the pipeline handles
less light reflected from the face (darker skin, backlighting, or both).
It is an engineering test, not a demographic benchmark — but it directly
exercises the failure mode that makes face detection less reliable for
darker-skinned players, and it gates regressions on it.

## Running

```bash
# one-time: fixtures → fake-webcam videos (needs python3 + pillow)
#   make_y4m.py <image> <out.y4m> [brightness] [noise-sigma]
python3 make_y4m.py fixtures/smiling.jpg smiling.y4m
python3 make_y4m.py fixtures/talking.jpg talking.y4m
python3 make_y4m.py fixtures/smiling-darker-tone.jpg hard.y4m 0.25 10   # dim + sensor noise
python3 make_y4m.py fixtures/talking.jpg hard-talk.y4m 0.25 10

# needs playwright-core + a chromium (npx playwright install chromium)
npm run dev:web &   # from repo root

# vision layer: yes = must laugh, no = must not
node run-vision-test.mjs "$PWD/smiling.y4m" yes
node run-vision-test.mjs "$PWD/talking.y4m" no

# decision layer (the one that costs lives): last arg = seconds to observe
node run-hook-test.mjs "$PWD/hard.y4m" yes 45       # darker tone, dim, noisy → laugh fires
node run-hook-test.mjs "$PWD/hard-talk.y4m" no 40   # same conditions, talking → NO penalty
```

Pass a URL as the third argument to `run-vision-test.mjs` to test a
production build or deployed site.

## Manual check

Open `/vision-test.html` in the running app (dev or production) — smile at
your camera and watch the meter spike and a LAUGH event fire.
