/// <reference types="vite/client" />
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLobby } from '../hooks/useLobby';
import { useChat } from '../hooks/useChat';
import { useLiveKit } from '../hooks/useLiveKit';
import { PlayerAvatar } from '../components/lobby/PlayerAvatar';
import { BitsInventory } from '../components/lobby/BitsInventory';
import { ChatPanel } from '../components/ChatPanel';
import { AudioSink } from '../components/AudioSink';

const SERVER_URL  = (import.meta.env.VITE_SERVER_URL  as string | undefined) ?? 'http://localhost:3001';
const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? '';

export function LobbyPage() {
  const { code = '' }      = useParams<{ code: string }>();
  const { user, signOut }  = useAuth();
  const navigate           = useNavigate();
  const [startError, setStartError] = useState('');
  const [copied,     setCopied]     = useState(false);

  const username = (user?.user_metadata?.username as string | undefined) ?? user?.email ?? 'Player';
  const userId   = user!.id;
  const roomCode = code.toUpperCase();

  const { room, error, connecting, setReady, updateSettings, startMatch } = useLobby(
    roomCode,
    { id: userId, username },
  );

  const chat = useChat(roomCode, userId);

  // Voice chat starts in the lobby — mic on, no camera yet.
  const { remoteParticipants, audioBlocked, enableAudio, micMuted, toggleMic } = useLiveKit({
    roomCode, userId, username,
    serverUrl:  SERVER_URL,
    livekitUrl: LIVEKIT_URL,
    publishVideo: false,
  });

  const selfPlayer = room?.players.find(p => p.userId === userId);
  const isHost     = room?.createdBy === userId;
  const allReady   = room ? room.players.length >= 2 && room.players.every(p => p.isReady) : false;

  function copyCode() {
    navigator.clipboard.writeText(roomCode);
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

  return (
    <div className="lobby-page">
      {/* Lobby voice chat */}
      {remoteParticipants.map(rp => (
        <AudioSink key={rp.identity} track={rp.audioTrack} />
      ))}
      {audioBlocked && (
        <button className="gp-audio-banner" onClick={enableAudio}>
          🔊 Tap to hear the other players
        </button>
      )}

      <header className="game-header">
        <div className="lobby-header__left">
          <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back</button>
        </div>
        <div className="lobby-header__code" onClick={copyCode} title="Click to copy">
          <span className="lobby-header__code-label">Room</span>
          <span className="lobby-header__code-value">{roomCode}</span>
          <span className="lobby-header__code-copy">{copied ? '✓ Copied' : 'Copy'}</span>
        </div>
        <div className="lobby-header__right">
          <button
            className={`gp-mic-btn ${micMuted ? 'gp-mic-btn--muted' : ''}`}
            onClick={toggleMic}
            title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {micMuted ? '🔇' : '🎤'}
          </button>
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
                />
              ))}
              {room && Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }).map((_, i) => (
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

          {/* Game Settings — Classic Mode only */}
          <div className="lobby-settings">
            <h2 className="lobby-section-title">Game Settings</h2>
            <p className="lobby-settings__mode-note">
              🎪 Classic Mode — rotating rounds, secret roles, sudden death finale.
            </p>

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
                <span className="lobby-setting-row__label">Show cameras</span>
                <div className="lobby-setting-row__control">
                  <button
                    className={`lobby-toggle ${room?.showCameras ? 'lobby-toggle--on' : ''}`}
                    onClick={() => isHost && room && updateSettings({ showCameras: !room.showCameras })}
                    disabled={!isHost}
                    title={!isHost ? 'Only the host can change settings' : ''}
                  >
                    {room?.showCameras ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              <div className="lobby-setting-row">
                <span className="lobby-setting-row__label">Camera layout</span>
                <div className="lobby-setting-row__control">
                  {(['grid', 'spotlight'] as const).map(layout => (
                    <button
                      key={layout}
                      className={`lobby-seg ${room?.cameraLayout === layout ? 'lobby-seg--active' : ''}`}
                      onClick={() => isHost && updateSettings({ cameraLayout: layout })}
                      disabled={!isHost || !room?.showCameras}
                    >
                      {layout === 'grid' ? 'Grid' : 'Spotlight'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {!room?.showCameras && (
              <p className="lobby-hint">Cameras hidden — laugh detection still runs locally on every player.</p>
            )}
            {!isHost && <p className="lobby-hint">Only the host can change settings.</p>}
          </div>

          {/* Bits inventory */}
          <BitsInventory userId={userId} />
        </section>

        {/* Lobby chat */}
        <aside className="lobby-chat">
          <ChatPanel messages={chat.messages} onSend={chat.send} selfUserId={userId} />
        </aside>
      </div>
    </div>
  );
}
