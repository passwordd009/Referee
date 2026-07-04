/// <reference types="vite/client" />
import { useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { RemoteTrack } from 'livekit-client';
import { useAuth } from '../auth/AuthContext';
import { useGameSocket, type Penalty, type GamePlayer } from '../hooks/useGameSocket';
import { useLiveKit } from '../hooks/useLiveKit';
import { useLocalCamera } from '../hooks/useLocalCamera';
import { socket } from '../lib/socket';
import { playWhistle } from '../lib/whistle';
import { refereeLine } from '../lib/refereeLines';

const SERVER_URL  = (import.meta.env.VITE_SERVER_URL  as string | undefined) ?? 'http://localhost:3001';
const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? '';

/** Fallback bits for players with an empty inventory. */
const PLAYER_BITS = [
  "I asked my dog what two minus two is. He said nothing.",
  "Why do cows wear bells? Because their horns don't work.",
  "I told my doctor I broke my arm in two places. He told me to stop going to those places.",
  "I used to hate facial hair, but then it grew on me.",
  "I'm on a seafood diet. I see food and I eat it.",
];

/** Row of hearts showing a player's remaining lives. */
function Lives({ count, max }: { count: number; max: number }) {
  return (
    <div className="gp-lives">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`gp-life ${i < count ? 'gp-life--on' : 'gp-life--off'}`}>♥</span>
      ))}
    </div>
  );
}

/** Another player's LiveKit camera feed. */
function RemoteVideo({ track }: { track: RemoteTrack | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);

  return <video ref={videoRef} autoPlay playsInline muted className="gp-tile__video" />;
}

/** Your own camera feed (the same stream the laugh detector watches). */
function LocalVideo({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline muted className="gp-tile__video" />;
}

/**
 * Full-screen whistle moment: blows the whistle sound and announces
 * who lost a life. Rendered while a penalty is active (~3s).
 */
function WhistleBanner({ penalty, players }: { penalty: Penalty; players: GamePlayer[] }) {
  const name = players.find(p => p.userId === penalty.playerId)?.username ?? 'Someone';

  // One whistle per penalty — keyed so back-to-back penalties re-blow.
  useEffect(() => { playWhistle(); }, [penalty.key]);

  // Pick the referee line once per penalty, not on every re-render.
  const line = useMemo(() => refereeLine(penalty.reason, name), [penalty.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gp-whistle" key={penalty.key}>
      <svg className="gp-whistle__icon" viewBox="0 0 64 64" aria-label="referee whistle" role="img">
        {/* Simple referee whistle: mouthpiece + round chamber */}
        <rect x="4" y="22" width="34" height="12" rx="4" fill="currentColor" />
        <circle cx="42" cy="38" r="16" fill="currentColor" />
        <circle cx="42" cy="38" r="6" fill="#0a0a0a" />
        {/* Sound lines */}
        <path d="M56 14 L62 8 M58 22 L64 20 M50 10 L52 3" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
      </svg>
      <div className="gp-whistle__text">
        <span className="gp-whistle__title">TWEEET!</span>
        <span className="gp-whistle__line">{line}</span>
      </div>
    </div>
  );
}

export function GamePage() {
  const { code = '' } = useParams<{ code: string }>();
  const { user }      = useAuth();
  const navigate      = useNavigate();

  const userId   = user!.id;
  const username = (user?.user_metadata?.username as string | undefined) ?? user?.email ?? 'Player';
  const roomCode = code.toUpperCase();

  const {
    phase, players, myTurn, activeBit, revealedPlayer,
    timeLeft, turnDurationMs, result, penalty, playBit, skipTurn,
  } = useGameSocket(roomCode, userId);

  // Player-to-player video (silently disabled when LiveKit isn't configured).
  const { remoteParticipants } = useLiveKit({
    roomCode, userId, username,
    serverUrl:  SERVER_URL,
    livekitUrl: LIVEKIT_URL,
  });

  // Local AI laugh detection: face-api.js watches the webcam, and a
  // sustained smile above the threshold is reported to the server.
  // The server applies its own cooldown and active-player immunity.
  const { stream: localStream, status: cameraStatus, error: cameraError, faceState } = useLocalCamera({
    onLaugh: (confidence) => {
      socket.emit('laugh_detected', { roomCode, userId, confidence });
    },
  });

  const maxLives = Math.max(...players.map(p => p.livesRemaining), 3);
  const timerPct = turnDurationMs > 0 ? timeLeft / (turnDurationMs / 1000) : 0;

  if (phase === 'loading') {
    return <div className="auth-loading"><span className="auth-loading__spinner" /></div>;
  }

  if (phase === 'finished' && result) {
    const winner = players.find(p => p.userId === result.winnerId);
    const iWon   = result.winnerId === userId;
    return (
      <div className="gp-page gp-page--over">
        <div className="gp-over-card">
          <div className={`gp-over-result ${iWon ? 'result-win' : 'result-loss'}`}>
            {iWon ? 'YOU WIN' : 'GAME OVER'}
          </div>
          <p className="gp-over-sub">
            {winner ? `${winner.username} survived` : 'No survivors'}
          </p>
          <div className="gp-over-stats">
            {(result.stats.funniest as string | null) && (
              <div className="stat">
                <span className="stat-label">Funniest</span>
                <span className="stat-value">
                  {players.find(p => p.userId === result.stats.funniest)?.username ?? '—'}
                </span>
              </div>
            )}
            <div className="stat">
              <span className="stat-label">Laughs total</span>
              <span className="stat-value">{result.stats.totalLaughs as number}</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate('/')}>
            Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gp-page">
      {/* Whistle moment — sound + banner when anyone loses a life */}
      {penalty && <WhistleBanner penalty={penalty} players={players} />}

      {/* Player tiles — one per player with live video */}
      <div className="gp-tiles">
        {players.map(p => {
          const isSelf = p.userId === userId;
          // LiveKit identities are "username__userId" — match on the userId suffix.
          const remotePt = remoteParticipants.find(r => r.identity.endsWith(`__${p.userId}`));

          return (
            <div
              key={p.userId}
              className={[
                'gp-tile',
                p.isEliminated ? 'gp-tile--eliminated' : '',
                penalty?.playerId === p.userId ? 'gp-tile--laugh' : '',
                isSelf ? 'gp-tile--self' : '',
              ].join(' ')}
            >
              <div className="gp-tile__screen">
                {isSelf ? (
                  <>
                    <LocalVideo stream={localStream} />
                    {/* Live AI status — proof the laugh detector is watching */}
                    <div className="gp-ai">
                      {cameraStatus === 'starting' && (
                        <span className="gp-ai__label">AI starting…</span>
                      )}
                      {cameraStatus === 'error' && (
                        <span className="gp-ai__label gp-ai__label--err">AI off</span>
                      )}
                      {cameraStatus === 'active' && faceState && !faceState.faceDetected && (
                        <span className="gp-ai__label gp-ai__label--warn">face?</span>
                      )}
                      {cameraStatus === 'active' && faceState?.faceDetected && (
                        <>
                          <span className="gp-ai__dot" />
                          {faceState.lowLight && (
                            <span className="gp-ai__label" title="Low light — video boosted for the AI">🌙</span>
                          )}
                          <div className="gp-ai__meter">
                            <div
                              className={`gp-ai__meter-fill ${faceState.smileScore >= 0.5 ? 'gp-ai__meter-fill--hot' : ''}`}
                              style={{ width: `${Math.round(faceState.smileScore * 100)}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <RemoteVideo track={remotePt?.videoTrack ?? null} />
                )}
              </div>

              <div className="gp-tile__label">
                <span className="gp-tile__name">{p.username}{isSelf ? ' (you)' : ''}</span>
                <Lives count={p.livesRemaining} max={maxLives} />
              </div>
              {p.isEliminated && <div className="gp-tile__out">OUT</div>}
            </div>
          );
        })}
      </div>

      {/* Camera problems block laugh detection — tell the player loudly */}
      {cameraError && (
        <p className="gp-camera-error">⚠ {cameraError} — laugh detection is off</p>
      )}

      {/* Main content */}
      <div className="gp-main">
        {phase === 'turn_active' && (
          <>
            <p className="gp-status">
              {myTurn ? '— YOUR TURN —' : '— Someone is performing… —'}
            </p>

            {activeBit?.textContent && (
              <div className="gp-bit-card">
                <p className="gp-bit-text">"{activeBit.textContent}"</p>
              </div>
            )}

            {myTurn && !activeBit && (
              <div className="gp-choices">
                <p className="gp-choices__label">Pick a bit to perform</p>
                <div className="gp-choices__list">
                  {PLAYER_BITS.map((bit, i) => (
                    <button key={i} className="gp-choice" onClick={() => playBit(bit)}>
                      {bit}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={skipTurn}>
                  Skip turn
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'turn_reveal' && revealedPlayer && (
          <div className="gp-reveal">
            <p className="gp-reveal__label">It was…</p>
            <p className="gp-reveal__name">{revealedPlayer.username}</p>
          </div>
        )}
      </div>

      {/* Turn timer */}
      {phase === 'turn_active' && (
        <div className="gp-timer">
          <div className="gp-timer__bar">
            <div className="gp-timer__fill" style={{ width: `${Math.max(0, timerPct) * 100}%` }} />
          </div>
          <span className="gp-timer__label">{timeLeft}s</span>
        </div>
      )}
    </div>
  );
}
