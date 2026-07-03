# Laugh detection tests

Automated proof that the AI laugh detection works: a real Chromium browser
runs the actual vision pipeline (`web/vision-test.html`, which imports the
same modules the game uses) against a **fake webcam** playing a face video.

- `fixtures/smiling.jpg` — big smile. Must be detected as a laugh.
- `fixtures/talking.jpg` — mouth open, talking, not smiling. Must NOT be a
  laugh (guards against penalizing players for talking).

Both photos are public-domain official White House portraits, sourced from
the `face_recognition` package's test suite.

## Running

```bash
# one-time: fixtures → fake-webcam videos (needs python3 + pillow)
python3 make_y4m.py fixtures/smiling.jpg smiling.y4m
python3 make_y4m.py fixtures/talking.jpg talking.y4m

# needs playwright-core + a chromium (npx playwright install chromium)
npm run dev:web &                                  # from repo root
node run-vision-test.mjs "$PWD/smiling.y4m" yes    # expect laugh
node run-vision-test.mjs "$PWD/talking.y4m" no     # expect no laugh
```

Pass a third argument to test a production build or deployed site, e.g.
`node run-vision-test.mjs "$PWD/smiling.y4m" yes https://your-app.example/vision-test.html`

## Manual check

Open `/vision-test.html` in the running app (dev or production) — smile at
your camera and watch the meter spike and a LAUGH event fire.
