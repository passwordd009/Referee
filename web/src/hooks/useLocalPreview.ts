import { useEffect, useState } from 'react';

/**
 * Simple local webcam preview for the lobby — just the stream, no laugh
 * detection and no publishing. The full vision pipeline only runs once
 * the match starts (useLocalCamera).
 */
export function useLocalPreview() {
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    let active: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        active = s;
        setStream(s);
      })
      .catch(() => { /* no camera / denied — avatar falls back to initials */ });

    return () => {
      cancelled = true;
      active?.getTracks().forEach(t => t.stop());
      setStream(null);
    };
  }, []);

  return stream;
}
