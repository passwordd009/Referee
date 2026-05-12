import { useEffect, useReducer, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../lib/socket';

export interface LobbyPlayer {
  userId: string;
  username: string;
  avatarUrl?: string;
  isReady: boolean;
  livesRemaining: number;
  isEliminated: boolean;
}

export interface LobbyRoom {
  id: string;
  roomCode: string;
  roomType: string;
  maxPlayers: number;
  livesCount: number;
  status: 'lobby' | 'in_game' | 'finished';
  createdBy: string;
  players: LobbyPlayer[];
  currentTurnUserId: string | null;
}

interface State {
  room: LobbyRoom | null;
  error: string;
  connecting: boolean;
}

type Action =
  | { type: 'ROOM_UPDATE'; room: LobbyRoom }
  | { type: 'ERROR'; error: string }
  | { type: 'CONNECTED' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ROOM_UPDATE': return { ...state, room: action.room, connecting: false, error: '' };
    case 'ERROR':       return { ...state, error: action.error, connecting: false };
    case 'CONNECTED':   return { ...state, connecting: false };
    default:            return state;
  }
}

export function useLobby(
  roomCode: string,
  user: { id: string; username: string; avatarUrl?: string },
) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, { room: null, error: '', connecting: true });

  useEffect(() => {
    socket.connect();

    socket.emit('join_room', {
      roomCode,
      userId:   user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
    }, (res: { ok: boolean; room?: LobbyRoom; error?: string }) => {
      if (!res.ok) { dispatch({ type: 'ERROR', error: res.error ?? 'Failed to join room' }); return; }
      dispatch({ type: 'ROOM_UPDATE', room: res.room! });
    });

    socket.on('room_updated',   ({ room }: { room: LobbyRoom }) => dispatch({ type: 'ROOM_UPDATE', room }));
    socket.on('player_joined',  ({ room }: { room: LobbyRoom }) => dispatch({ type: 'ROOM_UPDATE', room }));
    socket.on('player_left',    ({ room }: { room: LobbyRoom }) => dispatch({ type: 'ROOM_UPDATE', room }));
    socket.on('match_started',  () => navigate(`/game/${roomCode}`));

    return () => {
      socket.emit('leave_room', { roomCode, userId: user.id });
      socket.off('room_updated');
      socket.off('player_joined');
      socket.off('player_left');
      socket.off('match_started');
      socket.disconnect();
    };
  }, [roomCode]);

  const setReady = useCallback((ready: boolean) => {
    socket.emit('player_ready', { roomCode, userId: user.id, ready });
  }, [roomCode, user.id]);

  const startMatch = useCallback((cb: (err?: string) => void) => {
    socket.emit('start_match', { roomCode, userId: user.id }, (res: { ok: boolean; error?: string }) => {
      if (!res.ok) cb(res.error);
    });
  }, [roomCode, user.id]);

  return { ...state, setReady, startMatch };
}
