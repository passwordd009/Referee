/// <reference types="vite/client" />
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { RemoteTrack } from 'livekit-client';
import { useAuth } from '../auth/AuthContext';
import { useGameSocket, type Penalty, type GamePlayer, type ActiveBit } from '../hooks/useGameSocket';
import { useLiveKit } from '../hooks/useLiveKit';
import { useLocalCamera } from '../hooks/useLocalCamera';
import { socket } from '../lib/socket';
import { supabase } from '../lib/supabase';
import { bitThumbnail, youtubeEmbedUrl } from '../lib/bitMedia';
import { playWhistle, getWhistleVolume, setWhistleVolume } from '../lib/whistle';
import { refereeLine } from '../lib/refereeLines';

const SERVER_URL  = (import.meta.env.VITE_SERVER_URL  as string | undefined) ?? 'http://localhost:3001';
const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? '';

/** Starter bits for players whose inventory is empty. */
const FALLBACK_BITS: ActiveBit[] = [
  "I asked my dog what two minus two is. He said nothing.",
  "Why do cows wear bells? Because their horns don't work.",
  "I told my doctor I broke my arm in two places. He told me to stop going to those places.",
  "I used to hate facial hair, but then it grew on me.",
  "I'm on a seafood diet. I see food and I eat it.",
].map(textContent => ({ mediaType: 'text', textContent }));

interface OwnBit {
  id: string;
  title: string | null;
  media_type: string;
  media_url: string | null;
  text_content: string | null;
}

/** The bit currently on stage — text card, image, or YouTube embed. */
function BitStage({ bit }: { bit: ActiveBit }) {
  if (bit.mediaType === 'image' && bit.mediaUrl) {
    return (
      <div className="gp-bit-card gp-bit-card--media">
        {bit.title && <p className="gp-bit-title">{bit.title}</p>}
        <img className="gp-bit-image" src={bit.mediaUrl} alt={bit.title ?? 'bit'} />
      </div>
    );
  }
  if (bit.mediaType === 'youtube' && bit.mediaUrl) {
    const embed = youtubeEmbedUrl(bit.mediaUrl);
    if (embed) {
      return (
        <div className="gp-bit-card gp-bit-card--media">
          {bit.title && <p className="gp-bit-title">{bit.title}</p>}
          <iframe
            className="gp-bit-video"
            src={embed}
            title={bit.title ?? 'bit'}
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        </div>
      );
    }
  }
  if (!bit.textContent) return null;
  return (
    <div className="gp-bit-card">
      <p className="gp-bit-text">"{bit.textContent}"</p>
    </div>
  );
}

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

const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment' },
  { id: 'inappropriate_behavior', label: 'Inappropriate behavior' },
  { id: 'hate_speech', label: 'Hate speech' },
  { id: 'cheating', label: 'Cheating' },
  { id: 'spam', label: 'Spam' },
  { id: 'other', label: 'Other' },
];

/** In-game menu: audio settings, report a player, leave the match. */
function GameMenu({ players, selfId, onLeave, onClose }: {
  players: GamePlayer[];
  selfId: string;
  onLeave: () => void;
  onClose: () => void;
}) {
  const [volume, setVolume] = useState(() => Math.round(getWhistleVolume() * 100));
  const [reportTarget, setReportTarget] = useState<GamePlayer | null>(null);
  const [reportMsg, setReportMsg] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);

  const others = players.filter(p => p.userId !== selfId && !p.isBot);

  function changeVolume(v: number) {
    setVolume(v);
    setWhistleVolume(v / 100);
  }

  async function submitReport(reason: string) {
    if (!reportTarget) return;
    setReportMsg('Sending…');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not signed in');

      const res = await fetch(`${SERVER_URL}/api/players/${reportTarget.userId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) { setReportMsg('You already reported this player'); return; }
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      setReportMsg(`Report sent. Thanks for keeping the table safe.`);
      setReportTarget(null);
    } catch (err) {
      setReportMsg(`Could not send report: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return (
    <div className="gp-menu-overlay" onClick={onClose}>
      <div className="gp-menu" onClick={e => e.stopPropagation()}>
        <div className="gp-menu__head">
          <span className="gp-menu__title">MENU</span>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        {/* Audio */}
        <section className="gp-menu__section">
          <p className="gp-menu__label">Whistle volume</p>
          <div className="gp-menu__volume">
            <input
              type="range" min={0} max={100} value={volume}
              onChange={e => changeVolume(Number(e.target.value))}
            />
            <span className="gp-menu__volume-value">{volume === 0 ? 'Muted' : `${volume}%`}</span>
            <button className="btn btn-secondary" onClick={() => playWhistle()} disabled={volume === 0}>
              Test
            </button>
          </div>
        </section>

        {/* Report */}
        <section className="gp-menu__section">
          <p className="gp-menu__label">Report a player</p>
          {others.length === 0 && <p className="lobby-hint">No other players to report.</p>}
          {others.length > 0 && !reportTarget && (
            <div className="gp-menu__report-list">
              {others.map(p => (
                <button key={p.userId} className="gp-choice" onClick={() => { setReportTarget(p); setReportMsg(''); }}>
                  {p.username}
                </button>
              ))}
            </div>
          )}
          {reportTarget && (
            <div className="gp-menu__report-list">
              <p className="lobby-hint">Why are you reporting {reportTarget.username}?</p>
              {REPORT_REASONS.map(r => (
                <button key={r.id} className="gp-choice" onClick={() => void submitReport(r.id)}>
                  {r.label}
                </button>
              ))}
              <button className="btn btn-ghost" onClick={() => setReportTarget(null)}>Cancel</button>
            </div>
          )}
          {reportMsg && <p className="gp-menu__report-msg">{reportMsg}</p>}
        </section>

        {/* Leave */}
        <section className="gp-menu__section">
          {!confirmLeave ? (
            <button className="btn btn-danger" onClick={() => setConfirmLeave(true)}>
              Leave match
            </button>
          ) : (
            <div className="gp-menu__confirm">
              <p className="lobby-hint">Leaving forfeits the match. Sure?</p>
              <div className="gp-menu__confirm-row">
                <button className="btn btn-danger" onClick={onLeave}>Yes, leave</button>
                <button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>Stay</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Compact global leaderboard slide for the end-of-match carousel. */
function MiniLeaderboard({ selfId }: { selfId: string }) {
  const [rows, setRows] = useState<{ id: string; username: string; level: number; total_wins: number; total_matches: number }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('id, username, level, total_wins, total_matches')
      .order('total_wins', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (!cancelled) setRows(data ?? []); });
    return () => { cancelled = true; };
  }, []);

  if (rows === null) return <div className="auth-loading" style={{ padding: 24 }}><span className="auth-loading__spinner" /></div>;
  if (rows.length === 0) return <p className="lobby-hint">No ranked players yet.</p>;

  return (
    <ol className="lb-list lb-list--compact">
      {rows.map((row, i) => (
        <li key={row.id} className={`lb-row ${row.id === selfId ? 'lb-row--self' : ''} ${i < 3 ? 'lb-row--top' : ''}`}>
          <span className="lb-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
          <span className="lb-name">{row.username}{row.id === selfId ? ' (you)' : ''}</span>
          <span className="lb-level">LVL {row.level}</span>
          <span className="lb-stat">{row.total_wins} W</span>
        </li>
      ))}
    </ol>
  );
}

interface SummaryPlayer {
  userId: string;
  laughsCaused: number;
  laughsReceived: number;
  isEliminated: boolean;
}

/**
 * End-of-match carousel: result → match summary → global leaderboard.
 * Swipe through with the arrows or the dots.
 */
function MatchEndCarousel({ players, result, selfId, onHome }: {
  players: GamePlayer[];
  result: { winnerId: string | null; stats: Record<string, unknown> };
  selfId: string;
  onHome: () => void;
}) {
  const [slide, setSlide] = useState(0);

  const winner = players.find(p => p.userId === result.winnerId);
  const iWon = result.winnerId === selfId;
  const nameOf = (id: string | null | undefined) =>
    players.find(p => p.userId === id)?.username ?? '—';

  const summaryPlayers = ((result.stats.players as SummaryPlayer[]) ?? [])
    .slice()
    .sort((a, b) => b.laughsCaused - a.laughsCaused);

  const slides = [
    {
      title: 'RESULT',
      body: (
        <div className="gp-slide-result">
          <div className={`gp-over-result ${iWon ? 'result-win' : 'result-loss'}`}>
            {iWon ? 'YOU WIN' : 'GAME OVER'}
          </div>
          <p className="gp-over-sub">{winner ? `${winner.username} survived` : 'No survivors'}</p>
          <div className="gp-over-stats">
            {(result.stats.funniest as string | null) && (
              <div className="stat">
                <span className="stat-label">Funniest</span>
                <span className="stat-value">{nameOf(result.stats.funniest as string)}</span>
              </div>
            )}
            <div className="stat">
              <span className="stat-label">Laughs total</span>
              <span className="stat-value">{result.stats.totalLaughs as number}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'MATCH SUMMARY',
      body: (
        <div className="gp-summary">
          {summaryPlayers.map(sp => (
            <div key={sp.userId} className={`gp-summary-row ${sp.userId === result.winnerId ? 'gp-summary-row--winner' : ''}`}>
              <span className="gp-summary-name">
                {sp.userId === result.winnerId ? '👑 ' : ''}{nameOf(sp.userId)}{sp.userId === selfId ? ' (you)' : ''}
              </span>
              <span className="gp-summary-stat" title="Laughs caused">😂 {sp.laughsCaused}</span>
              <span className="gp-summary-stat" title="Times caught laughing">💔 {sp.laughsReceived}</span>
              <span className={`gp-summary-badge ${sp.isEliminated ? '' : 'gp-summary-badge--alive'}`}>
                {sp.isEliminated ? 'OUT' : 'SURVIVED'}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'LEADERBOARD',
      body: <MiniLeaderboard selfId={selfId} />,
    },
  ];

  return (
    <div className="gp-over-card gp-over-card--carousel">
      <div className="gp-carousel">
        <button
          className="gp-carousel__arrow"
          onClick={() => setSlide(s => Math.max(0, s - 1))}
          disabled={slide === 0}
          aria-label="Previous"
        >‹</button>

        <div className="gp-carousel__slide">
          <p className="gp-carousel__title">{slides[slide].title}</p>
          {slides[slide].body}
        </div>

        <button
          className="gp-carousel__arrow"
          onClick={() => setSlide(s => Math.min(slides.length - 1, s + 1))}
          disabled={slide === slides.length - 1}
          aria-label="Next"
        >›</button>
      </div>

      <div className="gp-carousel__dots">
        {slides.map((s, i) => (
          <button
            key={s.title}
            className={`gp-carousel__dot ${i === slide ? 'gp-carousel__dot--on' : ''}`}
            onClick={() => setSlide(i)}
            aria-label={s.title}
          />
        ))}
      </div>

      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onHome}>
        Home
      </button>
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

  const [menuOpen, setMenuOpen] = useState(false);

  // Your uploaded bits — the real inventory you pick from on your turn.
  const [ownBits, setOwnBits] = useState<OwnBit[]>([]);
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('bits')
      .select('id, title, media_type, media_url, text_content')
      .eq('creator_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (!cancelled) setOwnBits((data as OwnBit[]) ?? []); });
    return () => { cancelled = true; };
  }, [userId]);

  function leaveMatch() {
    socket.emit('leave_match', { roomCode, userId });
    navigate('/');
  }

  const maxLives = Math.max(...players.map(p => p.livesRemaining), 3);
  const timerPct = turnDurationMs > 0 ? timeLeft / (turnDurationMs / 1000) : 0;

  if (phase === 'loading') {
    return <div className="auth-loading"><span className="auth-loading__spinner" /></div>;
  }

  if (phase === 'finished' && result) {
    return (
      <div className="gp-page gp-page--over">
        <MatchEndCarousel
          players={players}
          result={result}
          selfId={userId}
          onHome={() => navigate('/')}
        />
      </div>
    );
  }

  return (
    <div className="gp-page">
      {/* Whistle moment — sound + banner when anyone loses a life */}
      {penalty && <WhistleBanner penalty={penalty} players={players} />}

      {/* In-game menu: audio, report, leave */}
      <button className="gp-menu-btn" onClick={() => setMenuOpen(true)} title="Menu">☰</button>
      {menuOpen && (
        <GameMenu
          players={players}
          selfId={userId}
          onLeave={leaveMatch}
          onClose={() => setMenuOpen(false)}
        />
      )}

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

            {activeBit && <BitStage bit={activeBit} />}

            {myTurn && !activeBit && (
              <div className="gp-choices">
                <p className="gp-choices__label">
                  {ownBits.length > 0 ? 'Pick one of your bits' : 'Pick a bit to perform'}
                </p>
                <div className="gp-choices__list">
                  {ownBits.length > 0
                    ? ownBits.map(bit => {
                        const thumb = bitThumbnail(bit.media_type, bit.media_url);
                        const label = bit.title ?? bit.text_content ?? bit.media_url ?? 'Untitled bit';
                        return (
                          <button
                            key={bit.id}
                            className="gp-choice gp-choice--bit"
                            onClick={() => playBit({
                              mediaType:   bit.media_type,
                              mediaUrl:    bit.media_url ?? undefined,
                              textContent: bit.text_content ?? undefined,
                              title:       bit.title ?? undefined,
                            })}
                          >
                            {thumb
                              ? <img className="gp-choice__thumb" src={thumb} alt="" loading="lazy" />
                              : <span className="gp-choice__icon">💬</span>}
                            <span className="gp-choice__label">{label}</span>
                          </button>
                        );
                      })
                    : FALLBACK_BITS.map((bit, i) => (
                        <button key={i} className="gp-choice" onClick={() => playBit(bit)}>
                          {bit.textContent}
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
