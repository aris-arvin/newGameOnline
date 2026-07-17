/**
 * Client-side auth (production model): the browser never stores a long-lived
 * secret. The server keeps the refresh token in an HTTP-only cookie that JS
 * cannot read (XSS-safe); this module only ever holds the short-lived **access
 * token in memory**, handed to the WebSocket `join`. On load we silently
 * `refresh()` — if the cookie is still valid the session resumes with no
 * re-login. All requests send credentials so the cookie rides along.
 *
 * Requests go to `/auth/*` on the same origin (a dev/preview proxy or a prod
 * reverse proxy forwards them to the game server), so the cookie is first-party.
 */
export interface Account {
  id: string;
  username: string;
  empireId: string | null;
}

export type AuthResult = { ok: true; accessToken: string; account: Account } | { ok: false; error: string };

interface AuthResponse {
  ok: boolean;
  accessToken?: string;
  error?: string;
  account?: Account | null;
}

// Same-origin by default; override for a separately-hosted API.
const AUTH_BASE = (import.meta.env.VITE_AUTH_BASE as string | undefined) ?? '';

async function call(path: string, body?: Record<string, unknown>): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`${AUTH_BASE}${path}`, {
      method: 'POST',
      credentials: 'include', // send/receive the HTTP-only refresh cookie
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, error: 'cannot reach server' };
  }
  let data: AuthResponse;
  try {
    data = (await res.json()) as AuthResponse;
  } catch {
    return { ok: false, error: `server error (${res.status})` };
  }
  if (!res.ok || !data.ok || !data.accessToken || !data.account) {
    return { ok: false, error: data.error ?? `request failed (${res.status})` };
  }
  return { ok: true, accessToken: data.accessToken, account: data.account };
}

export function register(username: string, password: string): Promise<AuthResult> {
  return call('/auth/register', { username, password });
}
export function login(username: string, password: string): Promise<AuthResult> {
  return call('/auth/login', { username, password });
}
/** Silent session resume: exchange the refresh cookie for a fresh access token. */
export function refresh(): Promise<AuthResult> {
  return call('/auth/refresh');
}
/** Revoke the refresh session server-side and clear the cookie. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    /* best-effort — the access token expires on its own anyway */
  }
}
