import { useEffect, useRef } from 'react';
import type { RemoteParticipantState } from '../../hooks/useLiveKit';

function RemoteVideoTile({ participant }: { participant: RemoteParticipantState }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    const track   = participant.videoTrack;
    if (!videoEl || !track) return;

    track.attach(videoEl);
    return () => { track.detach(videoEl); };
  }, [participant.videoTrack]);

  return (
    <div className="remote-video-tile">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="remote-video-tile__video"
      />
      <span className="remote-video-tile__label">{participant.displayName}</span>
    </div>
  );
}

export function RemoteVideoGrid({ participants }: { participants: RemoteParticipantState[] }) {
  if (participants.length === 0) return null;

  return (
    <div className="remote-video-grid">
      {participants.map((p) => (
        <RemoteVideoTile key={p.identity} participant={p} />
      ))}
    </div>
  );
}
