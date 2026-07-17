import { useState } from 'react';
import { login, register } from '../auth';
import type { Account } from '../auth';

/**
 * The Live-mode gate: a player registers or logs in before the server will bind
 * them to an empire. On success the server sets an HTTP-only refresh cookie and
 * returns a short-lived access token, which we hand up to App (kept in memory,
 * never stored) to open the authenticated WebSocket.
 */
export function AuthPanel({ onAuthed }: { onAuthed: (r: { accessToken: string; account: Account }) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    const result = await (mode === 'login' ? login : register)(username, password);
    setBusy(false);
    if (result.ok) onAuthed({ accessToken: result.accessToken, account: result.account });
    else setError(result.error);
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
      </div>
    </div>
  );
}
