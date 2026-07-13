import { useEffect, useRef } from 'react';
import type { RemoteTrack } from 'livekit-client';

/** Attaches a LiveKit remote track to a <video> element imperatively. */
export function RemoteVideo({ track }: { track: RemoteTrack | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={videoRef} autoPlay playsInline muted className="gp-tile__video" />;
}

/** Self-view: attaches the local camera stream to a <video> element. */
export function LocalVideo({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline muted className="gp-tile__video" />;
}

/**
 * Live laugh-detector status for your own tile: proves the AI is
 * actually watching. Green dot + smile meter when a face is tracked.
 */
export function AiStatus({ error, aiReady, faceOk, smileScore }: {
  error: string | null;
  aiReady: boolean;
  faceOk: boolean;
  smileScore: number;
}) {
  if (error) return <div className="ai-status ai-status--off">AI off — {error}</div>;
  if (!aiReady) return <div className="ai-status">loading AI…</div>;
  if (!faceOk) return <div className="ai-status ai-status--warn">face? get in frame</div>;
  return (
    <div className="ai-status ai-status--on">
      <span className="ai-status__dot" />
      <span className="ai-status__meter">
        <span className="ai-status__fill" style={{ width: `${Math.min(100, smileScore * 100)}%` }} />
      </span>
    </div>
  );
}
