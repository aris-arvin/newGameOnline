import { useState } from 'react';
import { login, register } from '../auth';
import type { Session } from '../auth';

/**
 * The Live-mode gate: a player must register or log in before the server will
 * bind them to an empire. On success we hand the session (token) up to App,
 * which stores it and connects the WebSocket with the token.
 */
export function AuthPanel({ wsUrl, onAuthed }: { wsUrl: string; onAuthed: (s: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    const fn = mode === 'login' ? login : register;
    const result = await fn(wsUrl, username, password);
    setBusy(false);
    if (result.ok && result.session) onAuthed(result.session);
    else setError(result.error ?? 'authentication failed');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && username && password && !busy) submit();
  };

  return (
    <div className="auth-gate">
      <div className="panel auth-card">
        <h3>{mode === 'login' ? 'Log in to play' : 'Create an account'}</h3>
        <p className="muted auth-lead">
          Your empire is bound to your account — log in and it&apos;s yours on every device, every season.
        </p>

        <label className="auth-label">Username</label>
        <input
          className="auth-input"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={onKey}
          placeholder="3–20 letters, digits, underscore"
        />

        <label className="auth-label">Password</label>
        <input
          className="auth-input"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onKey}
          placeholder="at least 8 characters"
        />

        {error && <p className="auth-error bad">{error}</p>}

        <button className="btn primary auth-submit" disabled={busy || !username || !password} onClick={submit}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Register'}
        </button>

        <p className="muted auth-switch">
          {mode === 'login' ? "Don't have an account? " : 'Already have one? '}
          <button
            className="linkish"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? 'Register' : 'Log in'}
          </button>
        </p>
        <p className="muted auth-server">server: {wsUrl}</p>
      </div>
    </div>
  );
}
