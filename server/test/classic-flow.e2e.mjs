/**
 * End-to-end test of the Classic Mode flow over real sockets.
 * Start the server first (npm run dev --workspace=server), then:
 *   node server/test/classic-flow.e2e.mjs
 */
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const log = (msg) => console.log(`${new Date().toISOString().slice(17, 23)} ${msg}`);
const ok  = (msg) => log(`  ✓ ${msg}`);
const die = (msg) => { console.error(`  ✗ FAIL: ${msg}`); process.exit(1); };

function connect(name) {
  const s = io(URL, { transports: ['websocket'] });
  s.data = { name, events: [] };
  s.onAny((ev, payload) => s.data.events.push({ ev, payload, at: Date.now() }));
  return s;
}

function waitFor(sock, ev, timeoutMs = 30_000, pred = () => true, since = 0) {
  // Also matches events that already arrived (unless older than `since`).
  const seen = sock.data.events.find(e => e.ev === ev && e.at >= since && pred(e.payload));
  if (seen) return Promise.resolve(seen.payload);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${ev} on ${sock.data.name}`)), timeoutMs);
    const handler = (event, payload) => {
      if (event === ev && pred(payload)) {
        clearTimeout(timer);
        sock.offAny(handler);
        resolve(payload);
      }
    };
    sock.onAny(handler);
  });
}

function emitAck(sock, ev, payload) {
  return new Promise((resolve) => sock.emit(ev, payload, resolve));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const noEvent = async (sock, ev, ms, since = Date.now()) => {
  await sleep(ms);
  return !sock.data.events.some(e => e.ev === ev && e.at >= since);
};

const A = connect('alice'), B = connect('bob'), C = connect('carol');
const users = { 'u-a': A, 'u-b': B, 'u-c': C };

/* ── Room + chat + settings ─────────────────────────────── */
log('— LOBBY: room, chat, camera settings —');
const created = await emitAck(A, 'create_room', { userId: 'u-a', username: 'alice' });
if (!created.ok) die('create_room');
const CODE = created.room.roomCode;
if (created.room.players.length !== 1) die('bot still present or wrong player count');
if ('gameMode' in created.room || 'turnTimeSecs' in created.room) die('gameMode/turnTimeSecs still serialized');
if (created.room.showCameras !== true || created.room.cameraLayout !== 'grid') die('camera defaults wrong');
ok('room created — no bot, no gameMode/turnTimer, camera defaults present');

await emitAck(B, 'join_room', { roomCode: CODE, userId: 'u-b', username: 'bob' });
await waitFor(A, 'system_message', 5000, p => p.text.includes('bob joined'));
ok('system message: "bob joined the room"');
await emitAck(C, 'join_room', { roomCode: CODE, userId: 'u-c', username: 'carol' });

const chatSince = Date.now();
B.emit('chat_message', { roomCode: CODE, userId: 'u-b', text: 'hello table' });
const chatMsg = await waitFor(A, 'chat_message', 5000, p => p.at ?? true);
if (chatMsg.username !== 'bob' || chatMsg.text !== 'hello table') die('chat payload wrong');
await waitFor(C, 'chat_message', 5000);
ok('chat message broadcast to the whole room');

const upd = await emitAck(A, 'update_room_settings', { roomCode: CODE, userId: 'u-a', showCameras: false, cameraLayout: 'spotlight' });
if (!upd.ok) die('update settings');
const updEv = await waitFor(B, 'room_updated', 5000, p => p.room.showCameras === false);
if (updEv.room.cameraLayout !== 'spotlight') die('cameraLayout not applied');
ok('camera settings: showCameras=false, layout=spotlight applied');
await emitAck(A, 'update_room_settings', { roomCode: CODE, userId: 'u-a', showCameras: true });

/* ── Start + roles ──────────────────────────────────────── */
log('— ROLES —');
for (const [uid, s] of Object.entries(users)) s.emit('player_ready', { roomCode: CODE, userId: uid, ready: true });
await sleep(300);
const started = await emitAck(A, 'start_match', { roomCode: CODE, userId: 'u-a' });
if (!started.ok) die(`start_match: ${started.error}`);

const rolesPub = await waitFor(A, 'roles_assigned', 5000);
if (!rolesPub.jesterPlayerId || !rolesPub.detectivePlayerId) die('jester/detective not assigned publicly');

const myRoles = {};
for (const [uid, s] of Object.entries(users)) {
  const r = await waitFor(s, 'role_revealed_to_player', 5000);
  myRoles[uid] = r.role;
}
const byRole = (role) => Object.entries(myRoles).find(([, r]) => r === role)?.[0];
const jesterId = byRole('jester'), sabId = byRole('saboteur'), detId = byRole('detective');
if (!jesterId || !sabId || !detId) die(`3 players must get all 3 roles, got ${JSON.stringify(myRoles)}`);
if (rolesPub.jesterPlayerId !== jesterId || rolesPub.detectivePlayerId !== detId) die('public role ids mismatch');
if ('saboteurPlayerId' in rolesPub) die('saboteur leaked in public roles!');
const pubRoom = started.ok && (await emitAck(A, 'get_match_state', { roomCode: CODE }));
if (pubRoom.room.players.some(p => 'role' in p)) die('role leaked in serialized players!');
ok(`roles assigned: jester=${jesterId} detective=${detId} saboteur=${sabId} (saboteur secret)`);
const J = users[jesterId], S = users[sabId], D = users[detId];

/* ── Round 1: Guess the Item ────────────────────────────── */
log('— ROUND: guess the item —');
await waitFor(A, 'round_selection_started', 10_000);
const choice = await waitFor(J, 'choose_round', 5000);
if (!choice.options.includes('accusation')) die('accusation should be available (det+sab alive)');
ok(`jester offered rounds: ${choice.options.join(', ')}`);
J.emit('select_round', { roomCode: CODE, userId: jesterId, type: 'guess_the_item' });
const r1 = await waitFor(A, 'round_started', 5000, p => p.type === 'guess_the_item');
if (!r1.hint) die('no hint in guess round');
ok('guess round started with a hint');

for (const [uid, s] of Object.entries(users)) {
  s.emit('submit_item_guess', { roomCode: CODE, userId: uid, guess: `guess-by-${uid}` });
}
const reveal = await waitFor(A, 'item_guesses_revealed', 8000);
if (reveal.guesses.length !== 3) die(`expected 3 guesses, got ${reveal.guesses.length}`);
if (!reveal.item) die('item not revealed');
ok(`all guesses in → early reveal: item="${reveal.item}", 3 guesses`);
await waitFor(A, 'round_ended', 5000);

/* ── Detective discussion (between rounds) ──────────────── */
log('— DETECTIVE: discussion —');
D.emit('activate_discussion', { roomCode: CODE, userId: detId });
const disc = await waitFor(A, 'discussion_started', 8000);
if (disc.discussionsRemaining !== 2) die(`expected 2 discussions left, got ${disc.discussionsRemaining}`);
ok('discussion started (2 remaining)');
await waitFor(A, 'discussion_ended', 30_000);
ok('discussion ended, game resumes');

/* ── Round 2: Match the Sound (immunity + saboteur) ─────── */
log('— ROUND: match the sound —');
const t2 = Date.now();
await waitFor(A, 'round_selection_started', 10_000, () => true, t2);
await waitFor(J, 'choose_round', 6000, () => true, t2);
J.emit('select_round', { roomCode: CODE, userId: jesterId, type: 'match_the_sound' });
const r2 = await waitFor(A, 'round_started', 5000, p => p.type === 'match_the_sound');
if (!r2.performerId || !r2.soundId) die('no performer/sound');
ok(`sound round: performer=${r2.performerId} sound=${r2.soundId}`);

// Performer immunity
const immuneSince = Date.now();
users[r2.performerId].emit('laugh_detected', { roomCode: CODE, userId: r2.performerId, confidence: 0.99 });
if (!await noEvent(A, 'life_removed', 1200, immuneSince)) die('performer lost a life — immunity broken');
ok('performer is immune to laugh detection');

// A non-performer laughs → penalty
const laugher = Object.keys(users).find(id => id !== r2.performerId);
const laughSince = Date.now();
users[laugher].emit('laugh_detected', { roomCode: CODE, userId: laugher, confidence: 0.99 });
const lifeEv = await waitFor(A, 'life_removed', 5000, p => p.at ?? (p.playerId === laugher));
if (lifeEv.reason !== 'laughed') die(`wrong reason: ${lifeEv.reason}`);
ok(`${laugher} laughed → lost a life (${lifeEv.livesRemaining} left)`);

// Saboteur soundboard + cooldown
const sb1 = Date.now();
S.emit('play_soundboard', { roomCode: CODE, userId: sabId, soundId: 'honk' });
await waitFor(A, 'saboteur_sound_played', 5000, p => p.soundId === 'honk');
if (Object.values(await waitFor(A, 'saboteur_sound_played', 1000)).includes('userId')) die('sound leaked identity');
ok('saboteur fired a sound (anonymous)');
S.emit('play_soundboard', { roomCode: CODE, userId: sabId, soundId: 'boing' });
await sleep(1200);
if (A.data.events.some(e => e.ev === 'saboteur_sound_played' && e.payload.soundId === 'boing')) {
  die('cooldown not enforced');
}
ok('soundboard cooldown blocks spam');

const t2end = Date.now();
users[r2.performerId].emit('skip_turn', { roomCode: CODE, userId: r2.performerId });
await waitFor(A, 'round_ended', 5000, () => true, t2end);

/* ── Round 3: Accusation → saboteur caught ──────────────── */
log('— ROUND: accusation —');
const t3 = Date.now();
await waitFor(A, 'round_selection_started', 10_000, () => true, t3);
await waitFor(J, 'choose_round', 6000, () => true, t3);
J.emit('select_round', { roomCode: CODE, userId: jesterId, type: 'accusation' });
await waitFor(A, 'round_started', 8000, p => p.type === 'accusation', t3);
D.emit('detective_guess', { roomCode: CODE, userId: detId, targetId: sabId });
const verdict = await waitFor(A, 'detective_guess_result', 5000);
if (!verdict.correct) die('detective guessed the actual saboteur but was "wrong"');
await waitFor(A, 'saboteur_caught', 5000);
const sabElim = await waitFor(A, 'player_eliminated', 5000, p => p.playerId === sabId);
if (!sabElim) die('saboteur not eliminated');
ok('saboteur caught → all lives lost → eliminated');

/* ── Sudden Death ───────────────────────────────────────── */
log('— SUDDEN DEATH —');
await waitFor(A, 'sudden_death_started', 15_000);
ok('sudden death triggered (2 players left, 3 rounds played)');

const alive = Object.keys(users).filter(id => id !== sabId);
// Free-for-all: anyone can play a bit now
users[alive[0]].emit('play_bit', { roomCode: CODE, userId: alive[0], mediaType: 'text', textContent: 'sd bit' });
await waitFor(B, 'bit_played', 5000, p => p.textContent === 'sd bit');
ok('sudden death: bits are free-for-all');
// Everyone can use the soundboard now
const sdSound = Date.now();
users[alive[0]].emit('play_soundboard', { roomCode: CODE, userId: alive[0], soundId: 'airhorn' });
await waitFor(B, 'saboteur_sound_played', 5000, p => p.soundId === 'airhorn');
ok('sudden death: soundboard open to everyone');

// A laugh is instant elimination — no immunity
await sleep(3200); // clear laugh cooldown
users[alive[1]].emit('laugh_detected', { roomCode: CODE, userId: alive[1], confidence: 0.99 });
await waitFor(A, 'player_eliminated', 5000, p => p.playerId === alive[1]);
ok('sudden death: one laugh = instant elimination');

const fin = await waitFor(A, 'match_finished', 5000);
if (fin.winnerId !== alive[0]) die(`wrong winner: ${fin.winnerId}`);
if (fin.stats.roles.saboteurPlayerId !== sabId) die('saboteur not revealed in end stats');
if (typeof fin.stats.funniest === 'undefined' || typeof fin.stats.leastLaughed === 'undefined') die('missing end stats');
ok(`match finished — winner=${fin.winnerId}, roles revealed, stats present`);

/* ── Rematch ────────────────────────────────────────────── */
log('— REMATCH —');
const tR = Date.now();
await emitAck(A, 'rematch', { roomCode: CODE, userId: 'u-a' });
await waitFor(A, 'match_started', 5000, p => p.room.players.every(pl => !pl.isEliminated && pl.livesRemaining === 3), tR);
await waitFor(A, 'roles_assigned', 5000, () => true, tR);
ok('rematch: players reset, roles reassigned');
A.disconnect(); B.disconnect(); C.disconnect();

/* ── Casual queue ───────────────────────────────────────── */
log('— CASUAL QUEUE —');
const Q1 = connect('q1'), Q2 = connect('q2'), Q3 = connect('q3');
Q1.emit('join_casual_queue', { userId: 'q-1', username: 'q1' });
Q2.emit('join_casual_queue', { userId: 'q-2', username: 'q2' });
const qu = await waitFor(Q1, 'casual_queue_update', 5000, p => p.size === 2);
ok(`queue updates flowing (size=${qu.size})`);
Q3.emit('join_casual_queue', { userId: 'q-3', username: 'q3' });
const m1 = await waitFor(Q1, 'casual_match_found', 5000);
const m3 = await waitFor(Q3, 'casual_match_found', 5000);
if (m1.roomCode !== m3.roomCode) die('queue players sent to different rooms');
const joined = await emitAck(Q1, 'join_room', { roomCode: m1.roomCode, userId: 'q-1', username: 'q1' });
if (!joined.ok) die('matched room not joinable');
if (m1.hostUserId !== 'q-1') die('first-in-queue should host');
ok(`3 players matched instantly into room ${m1.roomCode}, first player hosts`);
Q1.disconnect(); Q2.disconnect(); Q3.disconnect();

console.log('\n✅ ALL CLASSIC MODE FLOWS PASS');
process.exit(0);
