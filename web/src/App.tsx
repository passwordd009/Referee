import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage }   from './pages/LoginPage';
import { SignupPage }  from './pages/SignupPage';
import { HomePage }   from './pages/HomePage';
import { LobbyPage }  from './pages/LobbyPage';
import { GamePage }   from './pages/GamePage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { supabaseConfigured } from './lib/supabase';

function MissingConfig() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Setup needed</h1>
        <p className="auth-subtitle" style={{ opacity: 1, color: '#f87171' }}>
          Missing Supabase environment variables.
        </p>
        <p style={{ fontSize: 13, opacity: 0.6, lineHeight: 1.7, textAlign: 'center' }}>
          Create <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4 }}>web/.env</code> with:
          <br /><br />
          <code style={{ display: 'block', background: 'rgba(255,255,255,0.07)', padding: '12px', borderRadius: 6, textAlign: 'left', whiteSpace: 'pre' }}>
{`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`}
          </code>
          <br />
          Then restart the dev server.
        </p>
      </div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

export function App() {
  if (!supabaseConfigured) return <MissingConfig />;

  return (
    <Routes>
      <Route path="/login"        element={<LoginPage />} />
      <Route path="/signup"       element={<SignupPage />} />
      <Route path="/"             element={<Protected><HomePage /></Protected>} />
      <Route path="/lobby/:code"  element={<Protected><LobbyPage /></Protected>} />
      <Route path="/game/:code"   element={<Protected><GamePage /></Protected>} />
      <Route path="*"             element={<Navigate to="/" replace />} />
    </Routes>
  );
}
