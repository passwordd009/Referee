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
2. Each frame passes through adaptive enhancement (`vision/enhance.ts`),
   designed so detection works equally well regardless of lighting or skin
   tone: scene-level auto-levels when the whole room is dark, face-metered
   contrast stretching when the *face* is underexposed even though the scene
   looks fine (darker skin tones, backlighting), temporal denoising for
   grainy low-light webcams, and a higher-resolution detector fallback for
   faces the standard pass can't find. Well-lit frames are untouched. A 🌙
   icon appears on your tile while a boost is active.
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
| `server/src/lib/progression.ts` | XP / tickets / crowns helpers (atomic, no gameplay hooks yet) |
| `server/src/lib/auth.ts` | JWT verification middleware for authenticated API routes |
| `server/src/routes/profile.ts` | `GET/PATCH /api/me/profile` |
| `server/src/routes/reports.ts` | Player & bit reporting endpoints |

## Progression & security foundation

Run `supabase/migrations/003_progression_and_security.sql` **and
`004_fix_match_stats.sql`** to get:

- **XP & level** on profiles (level = `floor(sqrt(xp/100)) + 1`). Every
  finished match awards rewards to human players: the winner gets
  **50 XP + 10 tickets**, everyone else **15 XP + 3 tickets** (constants in
  `server/src/lib/matchPersistence.ts`). The results screen shows what you
  earned and celebrates level-ups. Match stats and rewards require the
  server's Supabase env vars.
- **Tickets** (earnable currency, future cosmetics) and **crowns** (premium
  currency, schema only — no payments). All balance changes go through
  atomic SQL functions that can never produce a negative balance, callable
  only by the game server's service role.
- **Age verification**: signup requires a date of birth and enforces a
  minimum age (`VITE_MIN_AGE`, default 13). Passwords remain entirely in
  Supabase Auth — never stored by the app.
- **Moderation foundation**: a `reports` table (players and bits, validated
  reasons per type, duplicate-report protection), plus `moderation_status`
  and `visibility` fields on bits for a future review queue.
- **Authenticated API**: `/api/me/*` and report endpoints verify the
  Supabase JWT server-side; the caller's identity always comes from the
  token, never the request body.
- **Profile page** at `/profile`: level + XP progress, tickets, crowns,
  win rate, laughs-per-match, and username settings.

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

Open http://localhost:5173, create an account, create a room, and share the
room code. Matches need at least 2 players — grab a friend (or a second
browser profile) and ready up.

### What's optional

- **Server Supabase vars** — only needed for match history persistence and the
  bits media API. Without them the game runs fine; persistence is skipped.
- **LiveKit vars** — only needed to see and *hear* other players. Laugh
  detection is local and works without it.

## Environment variables

Client (`web/.env`):

| Var | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | yes | Sign-in / sign-up |
| `VITE_SERVER_URL` | yes | Game server address |
| `VITE_LIVEKIT_URL` | no | Player-to-player video |
| `VITE_MIN_AGE` | no | Minimum signup age (default 13) |

Server (`server/.env`):

| Var | Required | Purpose |
|---|---|---|
| `PORT` / `WEB_URL` | no | Defaults: 3001 / http://localhost:5173 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | no | Match history + bits API |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | no | Video room tokens |

## Deploy to Render

The app runs as two Render services: a **Static Site** (the web client) and a
**Web Service** (the game server). A blueprint (`render.yaml`) sets up both.

### With the blueprint (recommended)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo. It reads `render.yaml` and
   creates `laugh-table-server` (Node web service) and `laugh-table-web`
   (static site).
3. Set environment variables on each service (see the tables above). Because
   the `VITE_*` vars are baked in at **build time**, there's a one-time
   chicken-and-egg step:
   - Let both services deploy once to get their `*.onrender.com` URLs.
   - On **laugh-table-web**, set `VITE_SERVER_URL` to the server's URL
     (e.g. `https://laugh-table-server.onrender.com`).
   - On **laugh-table-server**, set `WEB_URL` to the static site's URL
     (e.g. `https://laugh-table-web.onrender.com`) — this is the CORS origin.
   - Redeploy both (Manual Deploy → Clear build cache & deploy for the web
     site so the new `VITE_SERVER_URL` bakes in).
4. Run the Supabase migrations (`supabase/migrations/001`–`004`, in order) in
   the Supabase SQL editor, and add your static site URL under Supabase
   **Authentication → URL Configuration** (Site URL + redirect URLs).

### Manual (no blueprint)

- **Static Site**: root dir `.`, build command
  `npm install && npm run build --workspace=web`, publish directory
  `web/dist`, and add a rewrite rule `/*` → `/index.html` (Redirects/Rewrites
  tab) so deep links work. Add the `VITE_*` env vars.
- **Web Service**: root dir `.`, build command
  `npm install && npm run build --workspace=server`, start command
  `npm run start --workspace=server`, health check path `/health`. Add the
  server env vars including `WEB_URL`.

### Notes

- **Free tier sleeps.** A free web service spins down after ~15 min idle, so
  the first player to join a cold server waits ~30s. The static site is always
  on. Upgrade the server to a paid instance to avoid the cold start.
- **HTTPS is required for webcams** — Render serves both services over HTTPS,
  so laugh detection and video work out of the box.
- **LiveKit is optional.** Without `VITE_LIVEKIT_URL` (web) and the LiveKit
  server keys, players just don't see each other's cameras; laugh detection
  still runs locally.
