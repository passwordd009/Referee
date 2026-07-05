import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface LeaderRow {
  id: string;
  username: string;
  avatar_url: string | null;
  level: number;
  total_wins: number;
  total_matches: number;
}

export function LeaderboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, level, total_wins, total_matches')
        .order('total_wins', { ascending: false })
        .order('total_matches', { ascending: true }) // fewer matches ranks higher on ties
        .limit(25);
      if (cancelled) return;
      if (err) setError('Could not load the leaderboard');
      else setRows((data as LeaderRow[]) ?? []);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="profile-page">
      <header className="game-header">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back</button>
        <span className="game-header__user">Leaderboard</span>
        <span />
      </header>

      <div className="profile-body">
        <section className="profile-card">
          <h2 className="lobby-section-title">Top Tables</h2>

          {loading && <div className="auth-loading" style={{ padding: 32 }}><span className="auth-loading__spinner" /></div>}
          {error && <p className="auth-error">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="lobby-hint">No players yet. Be the first on the board.</p>
          )}

          {rows.length > 0 && (
            <ol className="lb-list">
              {rows.map((row, i) => {
                const isSelf = row.id === user?.id;
                const winRate = row.total_matches ? Math.round((row.total_wins / row.total_matches) * 100) : 0;
                return (
                  <li key={row.id} className={`lb-row ${isSelf ? 'lb-row--self' : ''} ${i < 3 ? 'lb-row--top' : ''}`}>
                    <span className="lb-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                    <span className="lb-avatar">
                      {row.avatar_url
                        ? <img src={row.avatar_url} alt={row.username} />
                        : row.username.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="lb-name">{row.username}{isSelf ? ' (you)' : ''}</span>
                    <span className="lb-level">LVL {row.level}</span>
                    <span className="lb-stat">{row.total_wins} W</span>
                    <span className="lb-stat lb-stat--dim">{winRate}%</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
