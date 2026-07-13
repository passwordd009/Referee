/**
 * End-to-end test of spectator mode over real sockets.
 * Start the server first, then: node server/test/spectator-flow.e2e.mjs
 */
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const log = (msg) => console.log(`${new Date().toISOString().slice(17, 23)} ${msg}`);
const ok  = (msg) => log(`  ✓ ${msg}`);
const die = (msg) => { console.error(`  ✗ FAIL: ${msg}`); process.exit(1); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function connect(name) {
  const s = io(URL, { transports: ['websocket'] });
  s.data = { name, events: [] };
  s.onAny((ev, payload) => s.data.events.push({ ev, payload, at: Date.now() }));
  return s;
}
function waitFor(sock, ev, timeoutMs = 30_000, pred = () => true, since = 0) {
  const seen = sock.data.events.find(e => e.ev === ev && e.at >= since && pred(e.payload));
  if (seen) return Promise.resolve(seen.payload);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${ev} on ${sock.data.name}`)), timeoutMs);
    const handler = (event, payload) => {
      if (event === ev && pred(payload)) {
        clearTimeout(timer); sock.offAny(handler); resolve(payload);
      }
    };
    sock.onAny(handler);
  });
}
const emitAck = (sock, ev, payload) => new Promise((resolve) => sock.emit(ev, payload, resolve));

const A = connect('alice'), B = connect('bob'), C = connect('carol'), S = connect('sam');
const players = { 'u-a': A, 'u-b': B, 'u-c': C };

log('— SPECTATOR: joining —');
const created = await emitAck(A, 'create_room', { userId: 'u-a', username: 'alice' });
const CODE = created.room.roomCode;
if (created.room.allowSpectators !== true) die('allowSpectators should default true');
await emitAck(B, 'join_room', { roomCode: CODE, userId: 'u-b', username: 'bob' });
await emitAck(C, 'join_room', { roomCode: CODE, userId: 'u-c', username: 'carol' });

const sj = await emitAck(S, 'join_room', { roomCode: CODE, userId: 'u-s', username: 'sam', asSpectator: true });
if (!sj.ok || sj.asSpectator !== true) die('spectator join failed');
const sp = sj.room.players.find(p => p.userId === 'u-s');
if (!sp?.isSpectator) die('isSpectator not serialized');
await waitFor(A, 'system_message', 5000, p => p.text.includes('sam is watching'));
ok('sam joined as spectator — serialized + announced');

log('— SPECTATOR: setting gate —');
await emitAck(A, 'update_room_settings', { roomCode: CODE, userId: 'u-a', allowSpectators: false });
const S2 = connect('extra');
const rejected = await emitAck(S2, 'join_room', { roomCode: CODE, userId: 'u-x', username: 'extra', asSpectator: true });
if (rejected.ok) die('spectator joined while allowSpectators=false');
ok(`spectators OFF blocks new spectators ("${rejected.error}")`);
S2.disconnect();
await emitAck(A, 'update_room_settings', { roomCode: CODE, userId: 'u-a', allowSpectators: true });

log('— SPECTATOR: player↔spectator toggle —');
const t1 = await emitAck(B, 'set_spectator', { roomCode: CODE, userId: 'u-b', spectator: true });
if (!t1.ok) die('set_spectator failed');
const upd = await waitFor(A, 'room_updated', 5000, p => p.room.players.find(x => x.userId === 'u-b')?.isSpectator === true);
ok('bob switched to spectator');
await emitAck(B, 'set_spectator', { roomCode: CODE, userId: 'u-b', spectator: false });
await waitFor(A, 'room_updated', 5000, p => p.room.players.find(x => x.userId === 'u-b')?.isSpectator === false);
ok('bob switched back to player');

log('— START: spectator does not block, gets no role —');
for (const [uid, s] of Object.entries(players)) s.emit('player_ready', { roomCode: CODE, userId: uid, ready: true });
await sleep(300);
// sam (spectator) is NOT ready — start must still succeed
const started = await emitAck(A, 'start_match', { roomCode: CODE, userId: 'u-a' });
if (!started.ok) die(`start blocked by spectator: ${started.error}`);
const ms = await waitFor(S, 'match_started', 5000);
if (ms.turnOrder.includes('u-s')) die('spectator in turnOrder!');
if (ms.turnOrder.length !== 3) die(`turnOrder wrong: ${JSON.stringify(ms.turnOrder)}`);
const samRole = await waitFor(S, 'role_revealed_to_player', 5000);
if (samRole.role !== 'regular') die(`spectator got role ${samRole.role}`);
const rolesPub = await waitFor(A, 'roles_assigned', 5000);
if (rolesPub.jesterPlayerId === 'u-s' || rolesPub.detectivePlayerId === 'u-s') die('spectator got a public role');
ok('match started: 3 in turn order, spectator not ready, no role for spectator');

log('— SPECTATOR: immune + inert in rounds —');
const jesterSock = players[rolesPub.jesterPlayerId];
await waitFor(jesterSock, 'choose_round', 15_000);
jesterSock.emit('select_round', { roomCode: CODE, userId: rolesPub.jesterPlayerId, type: 'guess_the_item' });
await waitFor(A, 'round_started', 5000, p => p.type === 'guess_the_item');

// Spectator "laughs" → must be ignored
const laughSince = Date.now();
S.emit('laugh_detected', { roomCode: CODE, userId: 'u-s', confidence: 0.99 });
await sleep(1200);
if (S.data.events.some(e => e.ev === 'life_removed' && e.at >= laughSince)) die('spectator lost a life!');
ok('spectator laugh is ignored — no penalty');

// Spectator guess ignored; 3 player guesses trigger early reveal
S.emit('submit_item_guess', { roomCode: CODE, userId: 'u-s', guess: 'i should not count' });
for (const [uid, s] of Object.entries(players)) {
  s.emit('submit_item_guess', { roomCode: CODE, userId: uid, guess: `guess-${uid}` });
}
const reveal = await waitFor(A, 'item_guesses_revealed', 8000);
if (reveal.guesses.length !== 3) die(`expected 3 guesses, got ${reveal.guesses.length}`);
if (reveal.guesses.some(g => g.userId === 'u-s')) die('spectator guess counted');
ok('spectator guess excluded; early reveal at 3/3 players');

log('— SPECTATOR: can join mid-match —');
const LATE = connect('late');
const lj = await emitAck(LATE, 'join_room', { roomCode: CODE, userId: 'u-late', username: 'late' });
if (!lj.ok || lj.asSpectator !== true) die(`late joiner should be forced to spectate: ${JSON.stringify(lj)}`);
ok('mid-match joiner becomes a spectator automatically');

A.disconnect(); B.disconnect(); C.disconnect(); S.disconnect(); LATE.disconnect();
console.log('\n✅ ALL SPECTATOR FLOWS PASS');
process.exit(0);
