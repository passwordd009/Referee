# Laugh Table

A live multiplayer party game with one rule: **don't laugh.**

Players join a virtual table on their webcams, with voice chat always on.
An AI laugh detector watches every player's face locally in their browser —
crack a smile and the referee whistle blows: you lose a life, and everyone
knows. Last player with lives remaining wins.

## Classic Mode

The only game mode — a series of rotating mini-rounds with secret roles:

**Round types** (the Jester picks the next one each round):

| Round | What happens |
|---|---|
| 🔊 Match the Sound | A random sound plays; the selected player must imitate it. |
| 🔍 Guess the Item | A hint is shown; everyone privately submits a guess (45s), then all guesses are revealed. |
| 💬 Fill in the Blank | Complete a sentence out loud in an assigned impersonation voice ("angry coach", …). |
| 🕵️ Accusation | The Detective picks who they think the Saboteur is. |

**Roles** (assigned randomly at match start):

- **🃏 Jester** — picks the next round type; loses a life if a round they
  perform makes nobody laugh.
- **🤫 Saboteur** — secret; can fire soundboard sounds any time (8s cooldown).
  Caught in an Accusation Round → loses **all** lives.
- **🕵️ Detective** — can call up to 3 discussions to talk it out; runs
  Accusation Rounds. If eliminated, Accusation Rounds are skipped.
- Everyone else is a regular player: keep a straight face, survive.

**💀 Sudden Death** — when the endgame nears (2 players left), the finale:
no turns, no immunity, everyone gets the soundboard and can throw bits,
one laugh = instant elimination.

## Playing

- **Casual Mode** — matchmaking queue: 3 players match instantly, 2 match
  after a short wait.
- **Custom Game** — create a room, share the code. The lobby shows every
  player's live camera (with a laugh-detector preflight meter on your own
  tile). Host settings: lives, show/hide cameras, camera layout (grid or
  spotlight), allow spectators. Cameras hidden still means laugh
  detection runs — it's all local.
- **Spectator mode** — when allowed by the host, anyone can "Watch as
  spectator" from the lobby, and anyone joining mid-match spectates
  automatically. Spectators see and hear everything and can chat, but
  have no lives, no role, and their laughs cost nothing.
- **Chat** — lobby and match have text chat, including referee/system
  messages ("bob joined the room", round announcements, eliminations).
- **Voice** — microphone is on by default everywhere (lobby, match,
  spectating); there's a mute button.

## Getting started

Requires Node 20+.

```bash
npm install
cp web/.env.example web/.env        # Supabase auth required to sign in
cp server/.env.example server/.env  # all optional for local play
npm run dev                         # web (5173) + server (3001)
```

### What's optional

- **Server Supabase vars** — match history persistence and the bits media
  API. Without them the game runs; those features are disabled.
- **LiveKit vars** (`VITE_LIVEKIT_URL` + server API key/secret) — seeing and
  hearing other players. Laugh detection is local and works without it.

## Testing

End-to-end socket tests (Classic flow + spectator mode):

```bash
npm run dev --workspace=server   # in one terminal
node server/test/classic-flow.e2e.mjs
node server/test/spectator-flow.e2e.mjs
```

Laugh detector:

- **Manual**: open `/vision-test.html` (dev or production build) — the
  exact match pipeline with a live smile meter; smile and it should fire.
- **Unit**: `npx tsx web/test/smileDetector.test.mjs` — scoring math on
  crafted landmarks (neutral vs grin, thresholds, monotonicity).
- **Browser**: `node web/test/vision-browser.e2e.mjs` (dev server up) —
  headless Chromium with a fake webcam proves camera acquisition, model
  loading, and the vision loop end-to-end.

## Project layout

```
web/     React + Vite client (auth, lobby, game UI, local laugh detection)
server/  Node + Express + Socket.IO game server (rooms, Classic engine, queue)
```
