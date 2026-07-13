/// <reference types="vite/client" />
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useGameSocket, type RoundType } from '../hooks/useGameSocket';
import { useLiveKit } from '../hooks/useLiveKit';
import { useLocalCamera } from '../hooks/useLocalCamera';
import { useChat } from '../hooks/useChat';
import { ChatPanel } from '../components/ChatPanel';
import { AudioSink } from '../components/AudioSink';
import { socket } from '../lib/socket';
import { SOUND_IDS, SOUND_LABELS, playSound } from '../lib/soundboard';
import { LocalVideo, RemoteVideo, AiStatus } from '../components/VideoTiles';

const SERVER_URL  = (import.meta.env.VITE_SERVER_URL  as string | undefined) ?? 'http://localhost:3001';
const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? '';

const PLAYER_BITS = [
  "I asked my dog what two minus two is. He said nothing.",
  "Why do cows wear bells? Because their horns don't work.",
  "I told my doctor I broke my arm in two places. He told me to stop going to those places.",
  "I used to hate facial hair, but then it grew on me.",
  "I'm on a seafood diet. I see food and I eat it.",
];

const ROUND_LABELS: Record<RoundType, string> = {
  match_the_sound: '🔊 Match the Sound',
  guess_the_item:  '🔍 Guess the Item',
  fill_blank:      '💬 Fill in the Blank',
  accusation:      '🕵️ Accusation Round',
};

const ROLE_LABELS: Record<string, { title: string; desc: string }> = {
  jester:    { title: '🃏 JESTER',    desc: 'You pick the rounds. Make them laugh when you perform — or lose a life.' },
  saboteur:  { title: '🤫 SABOTEUR', desc: 'Secret role. Fire soundboard sounds any time. Don\'t get caught.' },
  detective: { title: '🕵️ DETECTIVE', desc: 'Call up to 3 discussions. Unmask the Saboteur in Accusation Rounds.' },
  regular:   { title: '🙂 PLAYER',   desc: 'Keep a straight face. Survive.' },
};

function Lives({ count, max }: { count: number; max: number }) {
  return (
    <div className="gp-lives">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`gp-life ${i < count ? 'gp-life--on' : 'gp-life--off'}`}>♥</span>
      ))}
    </div>
  );
}

export function GamePage() {
  const { code = '' }    = useParams<{ code: string }>();
  const { user }         = useAuth();
  const navigate         = useNavigate();

  const userId   = user!.id;
  const username = (user?.user_metadata?.username as string | undefined) ?? user?.email ?? 'Player';
  const roomCode = code.toUpperCase();

  const game = useGameSocket(roomCode, userId);
  const {
    phase, players, myRole, discussionsRemaining, jesterPlayerId, detectivePlayerId,
    round, roundIndex, roundOptions, guessProgress, guessesRevealed, accusationResult,
    suddenDeath, activeBit, timeLeft, durationMs, result, laughFlash,
    showCameras, cameraLayout,
  } = game;

  const chat = useChat(roomCode, userId);

  const { remoteParticipants, audioBlocked, enableAudio, micMuted, toggleMic } = useLiveKit({
    roomCode, userId, username,
    serverUrl:  SERVER_URL,
    livekitUrl: LIVEKIT_URL,
  });

  const selfIsSpectator = players.find(p => p.userId === userId)?.isSpectator ?? false;

  // Laugh detection runs for everyone (spectators can check their camera
  // too) but only players report laughs — spectators have no lives.
  const { stream: localStream, error: camError, aiReady, faceOk, smileScore } = useLocalCamera({
    onLaugh: (confidence) => {
      if (selfIsSpectator) return;
      socket.emit('laugh_detected', { roomCode, userId, confidence });
    },
  });

  const [itemGuess, setItemGuess] = useState('');
  const [guessSent, setGuessSent] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [soundCooldownUntil, setSoundCooldownUntil] = useState(0);

  // Reset per-round input state
  useEffect(() => { setItemGuess(''); setGuessSent(false); }, [round?.type, roundIndex]);

  const activePlayers = players.filter(p => !p.isSpectator);
  const spectators = players.filter(p => p.isSpectator);
  const maxLives = Math.max(...activePlayers.map(p => p.livesRemaining), 3);
  const timerPct = durationMs > 0 ? timeLeft / (durationMs / 1000) : 0;
  const self     = players.find(p => p.userId === userId);
  const iAmPerformer = round?.performerId === userId;
  const performer = players.find(p => p.userId === round?.performerId);
  const canUseSoundboard = (myRole === 'saboteur' || suddenDeath) && !self?.isEliminated && !selfIsSpectator;
  const soundReady = Date.now() >= soundCooldownUntil;

  function fireSound(id: string) {
    if (!soundReady) return;
    game.playSoundboard(id);
    setSoundCooldownUntil(Date.now() + 8_000);
    setTimeout(() => setSoundCooldownUntil(c => c), 8_100); // re-render for enable
  }

  function sendItemGuess() {
    if (!itemGuess.trim() || guessSent) return;
    game.submitItemGuess(itemGuess);
    setGuessSent(true);
  }

  if (phase === 'loading') {
    return <div className="auth-loading"><span className="auth-loading__spinner" /></div>;
  }

  /* ── End screen ─────────────────────────────────────────── */
  if (phase === 'finished' && result) {
    const { stats } = result;
    const nameOf = (id: string | null) =>
      stats.players.find(p => p.userId === id)?.username
      ?? players.find(p => p.userId === id)?.username ?? '—';
    const iWon = result.winnerId === userId;
    const saboteur = stats.roles.saboteurPlayerId;

    return (
      <div className="gp-page gp-page--over">
        <div className="gp-over-card">
          <div className={`gp-over-result ${iWon ? 'result-win' : 'result-loss'}`}>
            {iWon ? 'YOU WIN' : 'GAME OVER'}
          </div>
          <p className="gp-over-sub">
            {result.winnerId ? `🏆 ${nameOf(result.winnerId)} survived` : 'No survivors'}
          </p>

          <div className="gp-over-stats">
            <div className="stat">
              <span className="stat-label">Most laughs caused</span>
              <span className="stat-value">{nameOf(stats.funniest)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Laughed the most</span>
              <span className="stat-value">{nameOf(stats.mostLaughed)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Laughed the least</span>
              <span className="stat-value">{nameOf(stats.leastLaughed)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Laughs total</span>
              <span className="stat-value">{stats.totalLaughs}</span>
            </div>
          </div>

          <div className="gp-over-roles">
            <p className="gp-over-roles__title">The roles were…</p>
            <p>🃏 Jester: <b>{nameOf(stats.roles.jesterPlayerId)}</b></p>
            {stats.roles.detectivePlayerId && <p>🕵️ Detective: <b>{nameOf(stats.roles.detectivePlayerId)}</b></p>}
            {saboteur && <p>🤫 Saboteur: <b>{nameOf(saboteur)}</b></p>}
          </div>

          <div className="gp-over-actions">
            {/* Server only honors the host's rematch request */}
            <button className="btn btn-primary" onClick={game.rematch}>Rematch</button>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Live match ─────────────────────────────────────────── */
  const spotlightId = round?.performerId ?? null;
  const useSpotlight = cameraLayout === 'spotlight' && spotlightId && showCameras;

  return (
    <div className={`gp-page ${suddenDeath ? 'gp-page--sd' : ''}`}>
      {/* Remote voices — always on */}
      {remoteParticipants.map(rp => (
        <AudioSink key={rp.identity} track={rp.audioTrack} />
      ))}
      {audioBlocked && (
        <button className="gp-audio-banner" onClick={enableAudio}>
          🔊 Tap to hear the other players
        </button>
      )}

      {/* Role banner */}
      <div className="gp-topbar">
        {selfIsSpectator ? (
          <div className="gp-role-chip">👁 SPECTATING</div>
        ) : (
          <div className={`gp-role-chip gp-role-chip--${myRole}`}>
            {ROLE_LABELS[myRole].title}
          </div>
        )}
        {suddenDeath && <div className="gp-sd-banner">💀 SUDDEN DEATH — one laugh and you're out</div>}
        {!suddenDeath && round && (
          <div className="gp-round-chip">Round {roundIndex}: {ROUND_LABELS[round.type]}</div>
        )}
        <div className="gp-topbar__right">
          <button
            className={`gp-mic-btn ${micMuted ? 'gp-mic-btn--muted' : ''}`}
            onClick={toggleMic}
            title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {micMuted ? '🔇' : '🎤'}
          </button>
        </div>
      </div>

      {/* Player tiles */}
      <div className={`gp-tiles ${useSpotlight ? 'gp-tiles--spotlight' : ''}`}>
        {activePlayers.map(p => {
          const isSelf   = p.userId === userId;
          const remotePt = remoteParticipants.find(r => r.identity.endsWith(`__${p.userId}`));
          const isSpot   = p.userId === spotlightId;

          return (
            <div
              key={p.userId}
              className={[
                'gp-tile',
                p.isEliminated ? 'gp-tile--eliminated' : '',
                laughFlash?.playerId === p.userId ? 'gp-tile--laugh' : '',
                isSelf ? 'gp-tile--self' : '',
                isSpot ? 'gp-tile--spotlight' : '',
              ].join(' ')}
            >
              <div className="gp-tile__screen">
                {showCameras ? (
                  isSelf
                    ? <LocalVideo stream={localStream} />
                    : <RemoteVideo track={remotePt?.videoTrack ?? null} />
                ) : (
                  <div className="gp-tile__nocam">
                    <span className="gp-tile__nocam-face">🎭</span>
                  </div>
                )}
              </div>

              <div className="gp-tile__label">
                <span className="gp-tile__name">
                  {p.userId === jesterPlayerId && '🃏 '}
                  {p.userId === detectivePlayerId && '🕵️ '}
                  {p.username}{isSelf ? ' (you)' : ''}
                </span>
                <Lives count={p.livesRemaining} max={maxLives} />
              </div>
              {p.isEliminated && <div className="gp-tile__out">OUT</div>}
              {isSpot && <div className="gp-tile__badge">ON STAGE</div>}
              {isSelf && !p.isEliminated && (
                <AiStatus error={camError} aiReady={aiReady} faceOk={faceOk} smileScore={smileScore} />
              )}
            </div>
          );
        })}
      </div>

      {/* Spectators (watching + voice, no lives) */}
      {spectators.length > 0 && (
        <div className="gp-spectators">
          👁 {spectators.map(sp => sp.username + (sp.userId === userId ? ' (you)' : '')).join(', ')}
        </div>
      )}

      {/* Main stage */}
      <div className="gp-main">
        {phase === 'role_reveal' && (
          <div className="gp-role-card">
            <p className="gp-role-card__title">{ROLE_LABELS[myRole].title}</p>
            <p className="gp-role-card__desc">{ROLE_LABELS[myRole].desc}</p>
          </div>
        )}

        {phase === 'selecting' && (
          roundOptions ? (
            <div className="gp-choices">
              <p className="gp-choices__label">🃏 You're the Jester — pick the next round</p>
              <div className="gp-round-options">
                {roundOptions.map(t => (
                  <button key={t} className="gp-round-option" onClick={() => game.selectRound(t)}>
                    {ROUND_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="gp-status">
              🃏 {players.find(p => p.userId === jesterPlayerId)?.username ?? 'The Jester'} is picking the next round…
            </p>
          )
        )}

        {phase === 'discussion' && (
          <div className="gp-discussion">
            <p className="gp-discussion__title">🕵️ DISCUSSION</p>
            <p className="gp-discussion__sub">Talk it out — who is the Saboteur?</p>
          </div>
        )}

        {phase === 'round_active' && round?.type === 'match_the_sound' && (
          <div className="gp-round-stage">
            <p className="gp-status">
              {iAmPerformer
                ? <>— YOUR TURN: imitate <b>{round.soundLabel}</b> with your voice! —</>
                : <>— {performer?.username} must imitate <b>{round.soundLabel}</b> —</>}
            </p>
            <button className="btn btn-ghost" onClick={() => round.soundId && playSound(round.soundId)}>
              🔁 Replay sound
            </button>
            {iAmPerformer && (
              <button className="btn btn-ghost" onClick={game.skipTurn}>Done / skip</button>
            )}
          </div>
        )}

        {phase === 'round_active' && round?.type === 'fill_blank' && (
          <div className="gp-round-stage">
            <div className="gp-bit-card">
              <p className="gp-bit-text">"{round.sentence}"</p>
              <p className="gp-voice-tag">🎭 performed as: <b>{round.voice}</b></p>
            </div>
            <p className="gp-status">
              {iAmPerformer
                ? '— YOUR TURN: complete the sentence out loud, in character! —'
                : `— ${performer?.username} is performing —`}
            </p>
            {iAmPerformer && (
              <button className="btn btn-ghost" onClick={game.skipTurn}>Done / skip</button>
            )}
          </div>
        )}

        {phase === 'round_active' && round?.type === 'guess_the_item' && (
          <div className="gp-round-stage">
            <div className="gp-bit-card">
              <p className="gp-bit-label">HINT</p>
              <p className="gp-bit-text">{round.hint}</p>
            </div>
            {!self?.isEliminated && !selfIsSpectator && (
              guessSent ? (
                <p className="gp-status">✓ Guess locked in. {guessProgress && `${guessProgress.submitted}/${guessProgress.total} submitted`}</p>
              ) : (
                <div className="gp-guess-row">
                  <input
                    className="auth-input"
                    placeholder="What is it?"
                    value={itemGuess}
                    maxLength={100}
                    onChange={e => setItemGuess(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendItemGuess()}
                  />
                  <button className="btn btn-primary" onClick={sendItemGuess} disabled={!itemGuess.trim()}>
                    Submit
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {phase === 'round_active' && round?.type === 'accusation' && (
          <div className="gp-round-stage">
            {accusationResult ? (
              <p className={`gp-status ${accusationResult.correct ? 'gp-status--good' : ''}`}>
                {!accusationResult.guessed
                  ? 'The Detective stayed silent.'
                  : accusationResult.correct
                    ? `🕵️ CAUGHT! ${players.find(p => p.userId === accusationResult.targetId)?.username} was the Saboteur!`
                    : `Wrong! ${players.find(p => p.userId === accusationResult.targetId)?.username} is innocent.`}
              </p>
            ) : myRole === 'detective' && !self?.isEliminated ? (
              <div className="gp-choices">
                <p className="gp-choices__label">🕵️ Who is the Saboteur?</p>
                <div className="gp-round-options">
                  {players.filter(p => p.userId !== userId && !p.isEliminated).map(p => (
                    <button key={p.userId} className="gp-round-option" onClick={() => game.detectiveGuess(p.userId)}>
                      {p.username}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="gp-status">🕵️ The Detective is deciding who the Saboteur is…</p>
            )}
          </div>
        )}

        {phase === 'sudden_death' && (
          <div className="gp-round-stage">
            <p className="gp-status gp-status--sd">
              Make them laugh — soundboard, bits, anything goes. No immunity!
            </p>
            {!self?.isEliminated && !selfIsSpectator && (
              <div className="gp-choices__list gp-choices__list--sd">
                {PLAYER_BITS.map((bit, i) => (
                  <button key={i} className="gp-choice" onClick={() => game.playBit(bit)}>
                    {bit}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Guess reveal (shown during the break after guess_the_item) */}
        {guessesRevealed && phase !== 'round_active' && (
          <div className="gp-reveal-list">
            <p className="gp-reveal__label">The item was…</p>
            <p className="gp-reveal__name">{guessesRevealed.item}</p>
            <div className="gp-reveal-guesses">
              {guessesRevealed.guesses.map(g => (
                <p key={g.userId}><b>{g.username}:</b> {g.guess || '—'}</p>
              ))}
            </div>
          </div>
        )}

        {/* A bit on stage (performer or sudden-death chaos) */}
        {activeBit?.textContent && (phase === 'round_active' || phase === 'sudden_death') && (
          <div className="gp-bit-card gp-bit-card--floating">
            <p className="gp-bit-text">"{activeBit.textContent}"</p>
          </div>
        )}
      </div>

      {/* Timer bar */}
      {(phase === 'round_active' || phase === 'selecting' || phase === 'discussion') && (
        <div className="gp-timer">
          <div className="gp-timer__bar">
            <div className="gp-timer__fill" style={{ width: `${Math.max(0, timerPct) * 100}%` }} />
          </div>
          <span className="gp-timer__label">{timeLeft}s</span>
        </div>
      )}

      {/* Detective: discussion button */}
      {myRole === 'detective' && !self?.isEliminated && phase !== 'discussion' && (
        <button
          className="gp-detective-btn"
          onClick={game.activateDiscussion}
          disabled={discussionsRemaining <= 0}
          title="Pause the game to discuss"
        >
          🕵️ Discussion ({discussionsRemaining})
        </button>
      )}

      {/* Soundboard: saboteur always, everyone in sudden death */}
      {canUseSoundboard && (
        <div className="gp-soundboard-wrap">
          {soundboardOpen && (
            <div className="gp-soundboard">
              {SOUND_IDS.map(id => (
                <button
                  key={id}
                  className="gp-sound-tile"
                  disabled={!soundReady}
                  onClick={() => fireSound(id)}
                >
                  {SOUND_LABELS[id]}
                </button>
              ))}
              {!soundReady && <p className="gp-soundboard__cd">cooling down…</p>}
            </div>
          )}
          <button
            className="gp-soundboard-fab"
            onClick={() => setSoundboardOpen(o => !o)}
            title="Soundboard"
          >
            {suddenDeath ? '📢' : '🤫'}
          </button>
        </div>
      )}

      {/* Chat overlay */}
      <ChatPanel
        messages={chat.messages}
        onSend={chat.send}
        selfUserId={userId}
        collapsible
        unread={chat.unread}
        onOpenChange={chat.setOpen}
      />
    </div>
  );
}
