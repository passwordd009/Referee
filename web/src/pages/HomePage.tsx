import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../lib/socket';
import { useAuth } from '../auth/AuthContext';

export function HomePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState<'create' | 'join' | null>(null);

  const username = (user?.user_metadata?.username as string | undefined) ?? user?.email ?? 'Player';
  const userId   = user!.id;

  function createRoom() {
    setError('');
    setLoading('create');
    socket.connect();
    socket.timeout(8000).emit(
      'create_room',
      { userId, username },
      (err: Error | null, res: { ok: boolean; room?: { roomCode: string }; error?: string }) => {
        setLoading(null);
        if (err) { setError('Connection timed out. Check your connection and try again.'); return; }
        if (!res.ok) { setError(res.error ?? 'Failed to create room'); return; }
        navigate(`/lobby/${res.room!.roomCode}`);
      },
    );
  }

  function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) { setError('Enter a valid room code'); return; }
    setError('');
    setLoading('join');
    navigate(`/lobby/${code}`);
  }

  return (
    <div className="home-page">
      <header className="game-header">
        <span className="game-header__user">{username}</span>
        <button className="btn btn-ghost game-header__signout" onClick={signOut}>Sign out</button>
      </header>

      <div className="home-content">
        <h1 className="home-title">Laugh Table</h1>
        <p className="home-subtitle">Keep a straight face. Don't get caught.</p>

        <div className="home-actions">
          <button
            className="btn btn-primary home-actions__create"
            onClick={createRoom}
            disabled={loading !== null}
          >
            {loading === 'create' ? 'Creating…' : 'Create Room'}
          </button>

          <div className="home-actions__divider">or</div>

          <div className="home-actions__join">
            <input
              className="auth-input home-actions__code-input"
              placeholder="Room code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={8}
              onKeyDown={e => e.key === 'Enter' && joinRoom()}
            />
            <button
              className="btn btn-secondary"
              onClick={joinRoom}
              disabled={loading !== null}
            >
              {loading === 'join' ? 'Joining…' : 'Join'}
            </button>
          </div>

          {error && <p className="auth-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
