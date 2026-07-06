/// <reference types="vite/client" />
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLobby } from '../hooks/useLobby';
import type { GameMode } from '../hooks/useLobby';
import { useLiveKit } from '../hooks/useLiveKit';
import { useLocalPreview } from '../hooks/useLocalPreview';
import { PlayerAvatar } from '../components/lobby/PlayerAvatar';
import { BitsInventory } from '../components/lobby/BitsInventory';

const SERVER_URL  = (import.meta.env.VITE_SERVER_URL  as string | undefined) ?? 'http://localhost:3001';
const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? '';

const MODES: { id: GameMode; label: string; desc: string }[] = [
  { id: 'casual',          label: 'Classic',         desc: 'The Spotlight rotates. Make everyone else laugh — laugh yourself and lose a life. Fast turns, constant action.' },
  { id: 'water_hold',      label: 'Water Hold',      desc: 'Fill your mouth with water. Open it — spit, swallow, laugh — and you spill. Refill breaks between turns.' },
  { id: 'guess_the_biter', label: 'Guess the Biter', desc: 'A secret Biter performs each round. Watch reactions, then vote. Catch them and they pay — guess wrong and you do.' },
];

export function LobbyPage() {
  const { code = '' }      = useParams<{ code: string }>();
  const { user, signOut }  = useAuth();
  const navigate           = useNavigate();
  const [startError, setStartError] = useState('');
  const [copied,     setCopied]     = useState(false);

  const username = (user?.user_metadata?.username as string | undefined) ?? user?.email ?? 'Player';
  const userId   = user!.id;

  const { room, error, connecting, setReady, updateSettings, startMatch } = useLobby(
    code.toUpperCase(),
    { id: userId, username },
  );

  // Webcams in the ready-up section: your own local preview plus other
  // players' LiveKit feeds (silently disabled if LiveKit isn't set up).
  const localPreview = useLocalPreview();
  const { remoteParticipants } = useLiveKit({
    roomCode: code.toUpperCase(), userId, username,
    serverUrl:  SERVER_URL,
    livekitUrl: LIVEKIT_URL,
  });

  const selfPlayer = room?.players.find(p => p.userId === userId);
  const isHost     = room?.createdBy === userId;
  const allReady   = room ? room.players.length >= 2 && room.players.every(p => p.isReady) : false;

  function copyCode() {
    navigator.clipboard.writeText(code.toUpperCase());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleStart() {
    setStartError('');
    startMatch(err => setStartError(err ?? 'Could not start'));
  }

  if (connecting) {
    return (
      <div className="auth-loading">
        <span className="auth-loading__spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-error" style={{ fontSize: 16 }}>{error}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>Back</button>
        </div>
      </div>
    );
  }

  const currentMode = MODES.find(m => m.id === (room?.gameMode ?? 'casual'))!;

  return (
    <div className="lobby-page">
      <header className="game-header">
        <div className="lobby-header__left">
          <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back</button>
        </div>
        <div className="lobby-header__code" onClick={copyCode} title="Click to copy">
          <span className="lobby-header__code-label">Room</span>
          <span className="lobby-header__code-value">{code.toUpperCase()}</span>
          <span className="lobby-header__code-copy">{copied ? '✓ Copied' : 'Copy'}</span>
        </div>
        <div className="lobby-header__right">
          <span className="game-header__user">{username}</span>
          <button className="btn btn-ghost game-header__signout" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="lobby-body">
        <section className="lobby-left">
          {/* Players */}
          <div className="lobby-players">
            <h2 className="lobby-section-title">
              Players <span className="lobby-section-count">{room?.players.length ?? 0} / {room?.maxPlayers ?? 6}</span>
            </h2>

            <div className="player-grid">
              {room?.players.map(p => (
                <PlayerAvatar
                  key={p.userId}
                  player={p}
                  isHost={p.userId === room.createdBy}
                  isSelf={p.userId === userId}
                  localStream={localPreview}
                  remoteTrack={remoteParticipants.find(r => r.identity.endsWith(`__${p.userId}`))?.videoTrack ?? null}
                />
              ))}
              {room && Array.from({ length: room.maxPlayers - room.players.length }).map((_, i) => (
                <div key={`empty-${i}`} className="player-avatar player-avatar--empty">
                  <div className="player-avatar__pic player-avatar__pic--empty">?</div>
                  <span className="player-avatar__name">Waiting…</span>
                </div>
              ))}
            </div>

            <div className="lobby-actions">
              <button
                className={`btn ${selfPlayer?.isReady ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => setReady(!selfPlayer?.isReady)}
              >
                {selfPlayer?.isReady ? 'Not ready' : 'Ready up'}
              </button>

              {isHost && (
                <button
                  className="btn btn-primary"
                  onClick={handleStart}
                  disabled={!allReady}
                  title={!allReady ? 'All players must be ready' : ''}
                >
                  Start game
                </button>
              )}
            </div>

            {startError && <p className="auth-error">{startError}</p>}
            {!allReady && room && room.players.length >= 2 && (
              <p className="lobby-hint">Waiting for all players to ready up…</p>
            )}
            {room && room.players.length < 2 && (
              <p className="lobby-hint">Share the room code to invite friends.</p>
            )}
          </div>

          {/* Game Settings */}
          <div className="lobby-settings">
            <h2 className="lobby-section-title">Game Settings</h2>

            <p className="lobby-settings__sublabel">Mode</p>
            <div className="lobby-mode-cards">
              {MODES.map(m => {
                const active = (room?.gameMode ?? 'casual') === m.id;
                return (
                  <button
                    key={m.id}
                    className={`lobby-mode-card ${active ? 'lobby-mode-card--active' : ''}`}
                    onClick={() => isHost && updateSettings({ gameMode: m.id })}
                    disabled={!isHost}
                    title={!isHost ? 'Only the host can change settings' : ''}
                  >
                    <span className="lobby-mode-card__label">{m.label}</span>
                    {active && <span className="lobby-mode-card__desc">{m.desc}</span>}
                  </button>
                );
              })}
            </div>

            <div className="lobby-setting-rows">
              <div className="lobby-setting-row">
                <span className="lobby-setting-row__label">Lives</span>
                <div className="lobby-setting-row__control">
                  {isHost ? (
                    <>
                      <button
                        className="lobby-stepper-btn"
                        onClick={() => room && updateSettings({ livesCount: Math.max(1, room.livesCount - 1) })}
                        disabled={!room || room.livesCount <= 1}
                      >−</button>
                      <span className="lobby-stepper-value">{room?.livesCount ?? 3}</span>
                      <button
                        className="lobby-stepper-btn"
                        onClick={() => room && updateSettings({ livesCount: Math.min(4, room.livesCount + 1) })}
                        disabled={!room || room.livesCount >= 4}
                      >+</button>
                    </>
                  ) : (
                    <span className="lobby-stepper-value">{room?.livesCount ?? 3}</span>
                  )}
                </div>
              </div>

              <div className="lobby-setting-row">
                <span className="lobby-setting-row__label">Turn time</span>
                <div className="lobby-setting-row__control">
                  {isHost ? (
                    <>
                      <button
                        className="lobby-stepper-btn"
                        onClick={() => room && updateSettings({ turnTimeSecs: Math.max(10, room.turnTimeSecs - 5) })}
                        disabled={!room || room.turnTimeSecs <= 10}
                      >−</button>
                      <span className="lobby-stepper-value">{room?.turnTimeSecs ?? 20}s</span>
                      <button
                        className="lobby-stepper-btn"
                        onClick={() => room && updateSettings({ turnTimeSecs: Math.min(30, room.turnTimeSecs + 5) })}
                        disabled={!room || room.turnTimeSecs >= 30}
                      >+</button>
                    </>
                  ) : (
                    <span className="lobby-stepper-value">{room?.turnTimeSecs ?? 20}s</span>
                  )}
                </div>
              </div>
            </div>

            {!isHost && <p className="lobby-hint">Only the host can change settings.</p>}
          </div>
        </section>

        {/* Bits inventory */}
        <BitsInventory userId={userId} />
      </div>
    </div>
  );
}
