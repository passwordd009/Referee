import { useEffect, useRef } from 'react';
import type { RemoteTrack } from 'livekit-client';

/** Plays a remote player's voice. Invisible — audio only. */
export function AudioSink({ track }: { track: RemoteTrack | null }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);

  return <audio ref={ref} autoPlay />;
}
