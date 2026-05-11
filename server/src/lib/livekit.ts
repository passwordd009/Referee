import { AccessToken } from 'livekit-server-sdk';

const API_KEY    = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

export async function createLiveKitToken(roomName: string, participantName: string): Promise<string> {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET env vars');
  }

  const token = new AccessToken(API_KEY, API_SECRET, {
    identity: participantName,
    ttl: '2h',
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return token.toJwt();
}
