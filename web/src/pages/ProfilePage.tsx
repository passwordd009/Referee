import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface ProfileRow {
  username: string;
  avatar_url: string | null;
  level: number;
  xp: number;
  tickets: number;
  crowns: number;
  created_at: string;
}

interface MatchRow {
  laughs_caused: number;
  laughs_received: number;
  matches: { winner_id: string | null; finished_at: string | null };
}

/** XP needed to reach a given level (level = floor(sqrt(xp/100)) + 1). */
const xpForLevel = (level: number) => 100 * (level - 1) * (level - 1);

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const userId = user!.id;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Settings form
  const [editName, setEditName] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [profileRes, matchRes] = await Promise.all([
        supabase.from('profiles').select('username, avatar_url, level, xp, tickets, crowns, created_at').eq('id', userId).maybeSingle(),
        supabase
          .from('match_players')
          .select('laughs_caused, laughs_received, matches!inner(winner_id, finished_at)')
          .eq('player_id', userId)
          .limit(200),
      ]);
      if (cancelled) return;

      if (profileRes.error || !profileRes.data) {
        setLoadError('Could not load your profile');
      } else {
        setProfile(profileRes.data as ProfileRow);
        setEditName((profileRes.data as ProfileRow).username);
      }
      if (!matchRes.error && matchRes.data) {
        setRows((matchRes.data as unknown as MatchRow[]).filter(r => r.matches.finished_at));
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSaveMsg('');
    const trimmed = editName.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      setSaveMsg('Username must be 2-20 characters');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ username: trimmed }).eq('id', userId);
    if (!error) {
      // Keep auth metadata in sync so the rest of the app shows the new name.
      await supabase.auth.updateUser({ data: { username: trimmed } });
    }
    setSaving(false);
    if (error) {
      setSaveMsg(error.code === '23505' ? 'Username already taken' : 'Could not save');
      return;
    }
    setProfile(p => (p ? { ...p, username: trimmed } : p));
    setSaveMsg('Saved ✓');
  }

  if (loading) {
    return <div className="auth-loading"><span className="auth-loading__spinner" /></div>;
  }

  if (loadError || !profile) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-error" style={{ fontSize: 16 }}>{loadError || 'Profile unavailable'}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>Back</button>
        </div>
      </div>
    );
  }

  const wins = rows.filter(r => r.matches.winner_id === userId).length;
  const played = rows.length;
  const laughsReceived = rows.reduce((s, r) => s + r.laughs_received, 0);
  const laughsCaused = rows.reduce((s, r) => s + r.laughs_caused, 0);

  const levelStart = xpForLevel(profile.level);
  const levelEnd = xpForLevel(profile.level + 1);
  const levelPct = Math.min(100, Math.round(((profile.xp - levelStart) / (levelEnd - levelStart)) * 100));

  const initials = profile.username.slice(0, 2).toUpperCase();

  return (
    <div className="profile-page">
      <header className="game-header">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back</button>
        <span className="game-header__user">{profile.username}</span>
        <button className="btn btn-ghost game-header__signout" onClick={signOut}>Sign out</button>
      </header>

      <div className="profile-body">
        {/* Identity + level */}
        <section className="profile-card profile-card--identity">
          <div className="profile-avatar">
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt={profile.username} />
              : <span>{initials}</span>}
          </div>
          <div className="profile-identity">
            <h1 className="profile-name">{profile.username}</h1>
            <div className="profile-level-row">
              <span className="profile-level-badge">LVL {profile.level}</span>
              <div className="profile-xp-bar">
                <div className="profile-xp-bar__fill" style={{ width: `${levelPct}%` }} />
              </div>
              <span className="profile-xp-label">{profile.xp - levelStart} / {levelEnd - levelStart} XP</span>
            </div>
            <div className="profile-currencies">
              <span className="profile-currency" title="Tickets — earn by playing, spend on cosmetics">
                🎟 {profile.tickets}
              </span>
              <span className="profile-currency" title="Crowns">
                👑 {profile.crowns}
              </span>
            </div>
          </div>
        </section>

        {/* Match history stats */}
        <section className="profile-card">
          <h2 className="lobby-section-title">Match History</h2>
          {played === 0 ? (
            <p className="lobby-hint">No finished matches yet. Go make someone laugh.</p>
          ) : (
            <div className="profile-stats-grid">
              <div className="stat">
                <span className="stat-value">{played}</span>
                <span className="stat-label">Matches</span>
              </div>
              <div className="stat">
                <span className="stat-value">{wins}</span>
                <span className="stat-label">Wins</span>
              </div>
              <div className="stat">
                <span className="stat-value">{Math.round((wins / played) * 100)}%</span>
                <span className="stat-label">Win rate</span>
              </div>
              <div className="stat">
                <span className="stat-value">{(laughsReceived / played).toFixed(1)}</span>
                <span className="stat-label">Laughs / match</span>
              </div>
              <div className="stat">
                <span className="stat-value">{laughsCaused}</span>
                <span className="stat-label">Laughs caused</span>
              </div>
            </div>
          )}
        </section>

        {/* Settings */}
        <section className="profile-card">
          <h2 className="lobby-section-title">Settings</h2>
          <form onSubmit={saveSettings} className="profile-settings">
            <label className="auth-label">
              Username
              <input
                className="auth-input"
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                minLength={2}
                maxLength={20}
                required
              />
            </label>
            <div className="profile-settings__row">
              <button className="btn btn-primary" type="submit" disabled={saving || editName.trim() === profile.username}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saveMsg && <span className={saveMsg.startsWith('Saved') ? 'profile-save-ok' : 'auth-error'}>{saveMsg}</span>}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
