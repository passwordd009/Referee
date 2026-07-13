/// <reference types="vite/client" />
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLobby } from '../hooks/useLobby';
import { useChat } from '../hooks/useChat';
import { useLiveKit } from '../hooks/useLiveKit';
import { useLocalCamera } from '../hooks/useLocalCamera';
import { BitsInventory } from '../components/lobby/BitsInventory';
import { ChatPanel } from '../components/ChatPanel';
import { AudioSink } from '../components/AudioSink';
import { LocalVideo, RemoteVideo, AiStatus } from '../components/VideoTiles';

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

  const { room, error, connecting, setReady, updateSettings, setSpectator, startMatch } = useLobby(
    roomCode,
    { id: userId, username },
  );

  const chat = useChat(roomCode, userId);

  // Camera + mic are live in the lobby: you can see and hear everyone
  // before the match starts.
  const { remoteParticipants, audioBlocked, enableAudio, micMuted, toggleMic } = useLiveKit({
    roomCode, userId, username,
    serverUrl:  SERVER_URL,
    livekitUrl: LIVEKIT_URL,
  });

  // Local preview + laugh-detector preflight (no penalties in lobby —
  // the meter just proves detection works before you play).
  const { stream: localStream, error: camError, aiReady, faceOk, smileScore } = useLocalCamera();

  const selfPlayer  = room?.players.find(p => p.userId === userId);
  const isHost      = room?.createdBy === userId;
  const activePlayers = room?.players.filter(p => !p.isSpectator) ?? [];
  const spectators    = room?.players.filter(p => p.isSpectator) ?? [];
  const allReady    = activePlayers.length >= 2 && activePlayers.every(p => p.isReady);

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

  function renderTile(p: NonNullable<typeof room>['players'][number]) {
    const isSelf   = p.userId === userId;
    const remotePt = remoteParticipants.find(r => r.identity.endsWith(`__${p.userId}`));
    return (
      <div key={p.userId} className={`gp-tile lobby-tile ${isSelf ? 'gp-tile--self' : ''}`}>
        <div className="gp-tile__screen">
          {isSelf
            ? <LocalVideo stream={localStream} />
            : <RemoteVideo track={remotePt?.videoTrack ?? null} />}
          {!isSelf && !remotePt?.videoTrack && (
            <div className="gp-tile__nocam"><span className="gp-tile__nocam-face">📷</span></div>
          )}
        </div>
        <div className="gp-tile__label">
          <span className="gp-tile__name">
            {p.userId === room?.createdBy && '👑 '}
            {p.username}{isSelf ? ' (you)' : ''}
          </span>
          {p.isSpectator
            ? <span className="lobby-tile__spec">👁 SPEC</span>
            : <span className={`lobby-tile__ready ${p.isReady ? 'lobby-tile__ready--on' : ''}`}>
                {p.isReady ? '✓ ready' : 'not ready'}
              </span>}
        </div>
        {isSelf && (
          <AiStatus error={camError} aiReady={aiReady} faceOk={faceOk} smileScore={smileScore} />
        )}
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
          {/* Players — live cameras */}
          <div className="lobby-players">
            <h2 className="lobby-section-title">
              Players <span className="lobby-section-count">{activePlayers.length} / {room?.maxPlayers ?? 6}</span>
            </h2>

            <div className="lobby-camgrid">
              {activePlayers.map(renderTile)}
            </div>

            {spectators.length > 0 && (
              <>
                <h2 className="lobby-section-title" style={{ marginTop: 16 }}>
                  Spectators <span className="lobby-section-count">{spectators.length}</span>
                </h2>
                <div className="lobby-camgrid lobby-camgrid--spec">
                  {spectators.map(renderTile)}
                </div>
              </>
            )}

            <div className="lobby-actions">
              {selfPlayer?.isSpectator ? (
                <button className="btn btn-primary" onClick={() => setSpectator(false, e => setStartError(e ?? ''))}>
                  Switch to player
                </button>
              ) : (
                <>
                  <button
                    className={`btn ${selfPlayer?.isReady ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={() => setReady(!selfPlayer?.isReady)}
                  >
                    {selfPlayer?.isReady ? 'Not ready' : 'Ready up'}
                  </button>
                  {room?.allowSpectators && (
                    <button className="btn btn-ghost" onClick={() => setSpectator(true, e => setStartError(e ?? ''))}>
                      👁 Watch as spectator
                    </button>
                  )}
                </>
              )}

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
            {!allReady && activePlayers.length >= 2 && (
              <p className="lobby-hint">Waiting for all players to ready up…</p>
            )}
            {activePlayers.length < 2 && (
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

              <div className="lobby-setting-row">
                <span className="lobby-setting-row__label">Spectators</span>
                <div className="lobby-setting-row__control">
                  <button
                    className={`lobby-toggle ${room?.allowSpectators ? 'lobby-toggle--on' : ''}`}
                    onClick={() => isHost && room && updateSettings({ allowSpectators: !room.allowSpectators })}
                    disabled={!isHost}
                    title={!isHost ? 'Only the host can change settings' : ''}
                  >
                    {room?.allowSpectators ? 'ALLOWED' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>

            {!room?.showCameras && (
              <p className="lobby-hint">Cameras hidden in-game — laugh detection still runs locally on every player.</p>
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
