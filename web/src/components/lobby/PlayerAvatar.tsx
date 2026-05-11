import type { LobbyPlayer } from '../../hooks/useLobby';

interface Props {
  player: LobbyPlayer;
  isHost: boolean;
  isSelf: boolean;
}

export function PlayerAvatar({ player, isHost, isSelf }: Props) {
  const initials = player.username.slice(0, 2).toUpperCase();

  return (
    <div className={`player-avatar ${isSelf ? 'player-avatar--self' : ''}`}>
      <div className="player-avatar__pic">
        {player.avatarUrl
          ? <img src={player.avatarUrl} alt={player.username} />
          : <span>{initials}</span>
        }
        {isHost && <span className="player-avatar__host-badge">HOST</span>}
        {player.isReady && <span className="player-avatar__ready-dot" />}
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
