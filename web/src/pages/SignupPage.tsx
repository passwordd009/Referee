import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function SignupPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (username.trim().length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }

    setLoading(true);

    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: username.trim() } },
    });

    setLoading(false);
    if (err) { setError(err.message); return; }
    navigate('/', { replace: true });
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Laugh Table</h1>
        <p className="auth-subtitle">Create your account</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">
            Username
            <input
              className="auth-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={20}
            />
          </label>

          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have one? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
