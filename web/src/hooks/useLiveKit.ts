/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';

export interface RemoteParticipantState {
  identity: string;
  displayName: string;
  videoTrack: RemoteTrack | null;
}

interface UseLiveKitOptions {
  roomCode: string;
  userId: string;
  username: string;
  serverUrl: string;
  livekitUrl: string;
}

function parseDisplayName(identity: string): string {
  return identity.split('__')[0] ?? identity;
}

export function useLiveKit({
  roomCode,
  userId,
  username,
  serverUrl,
  livekitUrl,
}: UseLiveKitOptions) {
  const [connected, setConnected]               = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipantState[]>([]);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    // Silent no-op if LiveKit isn't configured
    if (!roomCode || !userId || !username || !livekitUrl) return;

    let cancelled = false;
    const room = new Room();
    roomRef.current = room;

    function syncParticipants() {
      if (cancelled) return;
      const participants: RemoteParticipantState[] = [];
      room.remoteParticipants.forEach((p) => {
        let videoTrack: RemoteTrack | null = null;
        p.trackPublications.forEach((pub) => {
          if (pub.kind === Track.Kind.Video && pub.isSubscribed && pub.track) {
            videoTrack = pub.track as RemoteTrack;
          }
        });
        participants.push({
          identity:    p.identity,
          displayName: parseDisplayName(p.identity),
          videoTrack,
        });
      });
      setRemoteParticipants(participants);
    }

    // Register events BEFORE connecting to avoid race
    room
      .on(RoomEvent.Connected,              () => { if (!cancelled) { setConnected(true); syncParticipants(); } })
      .on(RoomEvent.Disconnected,           () => { if (!cancelled) setConnected(false); })
      .on(RoomEvent.ParticipantConnected,   syncParticipants)
      .on(RoomEvent.ParticipantDisconnected,syncParticipants)
      .on(RoomEvent.TrackSubscribed,        syncParticipants)
      .on(RoomEvent.TrackUnsubscribed,      syncParticipants);

    async function connect() {
      try {
        const res = await fetch(`${serverUrl}/api/rooms/${roomCode}/livekit-token`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userId, username }),
        });
        if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
        const { token } = await res.json() as { token: string };

        if (cancelled) return;

        await room.connect(livekitUrl, token);
        if (cancelled) { await room.disconnect(); return; }

        // Publish camera only — no audio for MVP
        await room.localParticipant.setCameraEnabled(true);
      } catch (err) {
        if (!cancelled) {
          console.error('[useLiveKit]', err);
          setError(String(err));
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      void room.disconnect();
      roomRef.current = null;
    };
  }, [roomCode, userId, username, serverUrl, livekitUrl]);

  return { remoteParticipants, connected, error };
}
