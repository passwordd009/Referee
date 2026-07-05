import { useEffect, useRef } from 'react';
import type { RemoteTrack } from 'livekit-client';
import type { LobbyPlayer } from '../../hooks/useLobby';

interface Props {
  player: LobbyPlayer;
  isHost: boolean;
  isSelf: boolean;
  /** Your own camera preview stream (self tile only). */
  localStream?: MediaStream | null;
  /** Another player's LiveKit camera track. */
  remoteTrack?: RemoteTrack | null;
}

/** Renders a MediaStream inside the avatar circle. */
function StreamVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="player-avatar__cam" />;
}

/** Renders a LiveKit track inside the avatar circle. */
function TrackVideo({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className="player-avatar__cam" />;
}

export function PlayerAvatar({ player, isHost, isSelf, localStream, remoteTrack }: Props) {
  const initials = player.username.slice(0, 2).toUpperCase();

  // Prefer live webcam; fall back to avatar image, then initials.
  let content: React.ReactNode;
  if (isSelf && localStream) {
    content = <StreamVideo stream={localStream} />;
  } else if (!isSelf && remoteTrack) {
    content = <TrackVideo track={remoteTrack} />;
  } else if (player.avatarUrl) {
    content = <img src={player.avatarUrl} alt={player.username} />;
  } else {
    content = <span>{initials}</span>;
  }

  return (
    <div
      className={[
        'player-avatar',
        isSelf ? 'player-avatar--self' : '',
        player.isReady ? 'player-avatar--ready' : '',
      ].join(' ')}
    >
      {/* Ready state = green border on the tile */}
      <div className="player-avatar__pic">
        {content}
        {isHost && <span className="player-avatar__host-badge">HOST</span>}
      </div>

      <span className="player-avatar__name">
        {player.username}{isSelf ? ' (you)' : ''}
      </span>

      <div className="player-avatar__lives">
        {Array.from({ length: player.livesRemaining }).map((_, i) => (
          <span key={i} className="life-pip" />
        ))}
      </div>
    </div>
  );
}
