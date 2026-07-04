# Laugh Table

A live multiplayer party game with one rule: **don't laugh.**

Players join a virtual table on their webcams. Each round, one player secretly
performs a Bit — a joke shown to the whole room. An AI laugh detector watches
every player's face locally in their browser. Crack a smile and the referee
whistle blows: you lose a life, and everyone knows. After each bit, players can
guess who performed it — a correct guess costs the performer a life, a wrong
guess costs the guesser. Last player with lives remaining wins.

## How the AI laugh detection works

Everything runs **locally in each player's browser** — no video is sent to the
server for analysis.

1. `useLocalCamera` opens the webcam into a hidden `<video>` element.
2. Each frame passes through an adaptive low-light filter (`vision/enhance.ts`):
   if even the brightest parts of the frame are dim, the brightness range is
   auto-leveled to full contrast before the AI sees it. Detection works down
   to roughly 10% of normal room lighting; well-lit frames are untouched. A
   🌙 icon appears on your tile while the boost is active.
3. `visionLoop` analyzes frames with [face-api.js](https://github.com/justadudewhohacks/face-api.js)
   (TinyFaceDetector + 68-point landmarks, models in `web/public/weights/`).
4. `smileDetector` scores each frame 0→1 from two signals: mouth-corner rise
   and mouth width, both normalized by face width.
5. A score ≥ 0.5 sustained for 3 consecutive frames emits `laugh_detected`
   over Socket.IO (single glitchy frames never count, and a long laugh is
   reported at most once every 2 seconds).
6. The server (`MatchEngine.processLaugh`) validates it — 3-second cooldown per
   player, the performing player is immune — then deducts a life and broadcasts
   `life_removed` to the room.
7. Every client blows the whistle (synthesized with the Web Audio API — no
   audio file) and shows the penalty banner.

During a match, your own tile shows a live AI status strip: a green dot and
smile meter while your face is tracked, "face?" if you leave the frame, and
"AI off" if the camera failed.

### Verifying laugh detection

Open **`/vision-test.html`** (works in dev and production builds). It runs the
exact same camera + AI pipeline as a match and shows a live smile meter — if
the meter moves when you smile, laugh detection works in your browser. The
pipeline is also covered by automated browser tests that feed a fake webcam:
a smiling face must fire a laugh event and a talking-but-not-smiling face
must not.

## Project layout

```
web/     React + Vite client (auth, lobby, game UI, laugh detection)
server/  Node + Express + Socket.IO game server (rooms, match engine)
```

Key modules:

| Path | What it does |
|---|---|
| `web/src/vision/` | Webcam capture, face landmarks, smile scoring, detection loop |
| `web/src/hooks/useLocalCamera.ts` | Wires webcam + vision loop, reports laughs |
| `web/src/hooks/useGameSocket.ts` | All match state, driven by server events |
| `web/src/hooks/useLiveKit.ts` | Player-to-player video (optional) |
| `web/src/lib/whistle.ts` | Synthesized referee whistle sound |
| `server/src/game/MatchEngine.ts` | Turns, bits, guesses, laugh penalties, win detection |
| `server/src/game/LaughProcessor.ts` | Laugh cooldown + confidence threshold |

## Getting started

Requires Node 20+.

```bash
npm install

# Configure the client (Supabase auth is required to sign in)
cp web/.env.example web/.env       # fill in your values

# Configure the server (all optional for local play)
cp server/.env.example server/.env # or skip — see below

npm run dev                        # starts web (5173) + server (3001)
```

Open http://localhost:5173, create an account, create a room, ready up, and
start the match. A bot player joins every room so you can play solo.

### What's optional

- **Server Supabase vars** — only needed for match history persistence and the
  bits media API. Without them the game runs fine; persistence is skipped.
- **LiveKit vars** — only needed to see *other players'* cameras. Laugh
  detection is local and works without it.

## Environment variables

Client (`web/.env`):

| Var | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | yes | Sign-in / sign-up |
| `VITE_SERVER_URL` | yes | Game server address |
| `VITE_LIVEKIT_URL` | no | Player-to-player video |

Server (`server/.env`):

| Var | Required | Purpose |
|---|---|---|
| `PORT` / `WEB_URL` | no | Defaults: 3001 / http://localhost:5173 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | no | Match history + bits API |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | no | Video room tokens |
