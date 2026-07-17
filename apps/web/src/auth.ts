/**
 * Client-side auth: talks to the server's REST auth endpoints and remembers the
 * session token in localStorage. The token is later handed to the WebSocket
 * `join` so the server binds this browser to the account's empire. Passwords
 * never touch storage — only the signed token does.
 */
export interface Session {
  token: string;
  username: string;
  accountId: string;
  empireId: string | null;
}

interface AuthResponse {
  ok: boolean;
  token?: string;
  error?: string;
  account?: { id: string; username: string; empireId: string | null };
}

export interface AuthOutcome {
  ok: boolean;
  session?: Session;
  error?: string;
}

const STORAGE_KEY = 'pg.session';

/** ws://host:port → http://host:port (and wss → https). */
export function restBase(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http');
}

async function authRequest(wsUrl: string, path: string, username: string, password: string): Promise<AuthOutcome> {
  let res: Response;
  try {
    res = await fetch(`${restBase(wsUrl)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    return { ok: false, error: 'cannot reach server' };
  }
  let body: AuthResponse;
  try {
    body = (await res.json()) as AuthResponse;
  } catch {
    return { ok: false, error: `server error (${res.status})` };
  }
  if (!res.ok || !body.ok || !body.token || !body.account) {
    return { ok: false, error: body.error ?? `request failed (${res.status})` };
  }
  return {
    ok: true,
    session: { token: body.token, username: body.account.username, accountId: body.account.id, empireId: body.account.empireId },
  };
}

export function register(wsUrl: string, username: string, password: string): Promise<AuthOutcome> {
  return authRequest(wsUrl, '/auth/register', username, password);
}
export function login(wsUrl: string, username: string, password: string): Promise<AuthOutcome> {
  return authRequest(wsUrl, '/auth/login', username, password);
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(session: Session): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — session lives for this page load only */
  }
}
export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
