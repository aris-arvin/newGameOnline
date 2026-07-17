import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { loadWorldData, nodeTacticalResolver } from '@pure-galaxy/world-core/node';
import { GameServer } from '../src/server.js';
import { AccountStore, MemoryAccountPersistence } from '../src/auth.js';
import { MemoryPersistence } from '../src/persistence.js';
import type { ServerMessage } from '../src/protocol.js';

const data = loadWorldData();
const resolver = nodeTacticalResolver();

class TestClient {
  private queue: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  constructor(private ws: WebSocket) {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(m);
      else this.queue.push(m);
    });
  }
  next(pred: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve) => this.waiters.push({ pred, resolve }));
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  close(): void {
    this.ws.close();
  }
}

async function connect(port: number): Promise<TestClient> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const client = new TestClient(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return client;
}

const servers: GameServer[] = [];
async function makeAuthServer(): Promise<{ server: GameServer; port: number; accounts: AccountStore }> {
  const accounts = new AccountStore(new MemoryAccountPersistence());
  const server = new GameServer({ data, resolver, persistence: new MemoryPersistence(), accounts, seed: 7, autoTick: false });
  servers.push(server);
  const port = await server.start(0);
  return { server, port, accounts };
}

interface AuthBody {
  ok: boolean;
  accessToken?: string;
  error?: string;
  account?: { id: string; username: string; empireId: string | null };
}
async function post(
  port: number,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; body: AuthBody; setCookie: string[] }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie();
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as AuthBody) : ({ ok: res.ok } as AuthBody), setCookie };
}
async function registerToken(port: number, username: string, password: string): Promise<string> {
  const { body } = await post(port, '/auth/register', { username, password });
  return body.accessToken!;
}
/** Pull the refresh cookie's "name=value" pair out of a Set-Cookie header. */
function cookiePair(setCookie: string[]): string {
  return setCookie[0].split(';')[0];
}

type Welcome = Extract<ServerMessage, { type: 'welcome' }>;
const joined = (m: ServerMessage): boolean => m.type === 'welcome' && (m as Welcome).empireId != null;

afterEach(async () => {
  while (servers.length) await servers.pop()!.stop();
});

describe('AccountStore (§18.2 auth service)', () => {
  it('registers, then logs in case-insensitively with the right password', () => {
    const store = new AccountStore();
    const reg = store.register('Captain_Sol', 'hunter2pass');
    expect(reg.ok).toBe(true);
    expect(reg.token).toBeTruthy();
    const login = store.login('captain_sol', 'hunter2pass');
    expect(login.ok).toBe(true);
    expect(login.account!.id).toBe(reg.account!.id);
  });

  it('rejects a wrong password and an unknown user alike', () => {
    const store = new AccountStore();
    store.register('Zara', 'correctpass');
    expect(store.login('Zara', 'wrongpass').ok).toBe(false);
    expect(store.login('ghost', 'whatever1').ok).toBe(false);
  });

  it('rejects weak credentials and duplicate usernames', () => {
    const store = new AccountStore();
    expect(store.register('ab', 'longenough').ok).toBe(false); // username too short
    expect(store.register('gooduser', 'short').ok).toBe(false); // password too short
    expect(store.register('Dup', 'password1').ok).toBe(true);
    expect(store.register('dup', 'password2').ok).toBe(false); // case-insensitive collision
  });

  it('issues verifiable tokens and rejects tampering', () => {
    const store = new AccountStore();
    const { token, account } = store.register('Tok', 'password1');
    expect(store.validateToken(token)!.id).toBe(account!.id);
    expect(store.validateToken(token! + 'x')).toBeNull();
    expect(store.validateToken('garbage')).toBeNull();
    expect(store.validateToken(undefined)).toBeNull();
  });

  it('persists accounts, secret and bindings across a reload', () => {
    const p = new MemoryAccountPersistence();
    const s1 = new AccountStore(p);
    const { token, account } = s1.register('Persist', 'password1');
    s1.bindEmpire(account!.id, 'emp2');
    const s2 = new AccountStore(p); // fresh instance, same store
    expect(s2.validateToken(token)!.id).toBe(account!.id); // signing secret survived
    expect(s2.get(account!.id)!.empireId).toBe('emp2');
  });

  it('rotates refresh tokens and detects replay of a used one', () => {
    const store = new AccountStore();
    const { account } = store.register('Rot', 'password1');
    const raw1 = store.issueRefresh(account!.id);

    const r1 = store.rotateRefresh(raw1);
    expect(r1.ok).toBe(true);
    expect(r1.accountId).toBe(account!.id);
    expect(r1.refresh).toBeTruthy();
    expect(r1.token).toBeTruthy();

    // The consumed token can't be rotated again — that's a replay.
    const replay = store.rotateRefresh(raw1);
    expect(replay.ok).toBe(false);
    expect(replay.reuse).toBe(true);

    // Reuse detection revokes the family, so the successor is dead too.
    expect(store.rotateRefresh(r1.refresh).ok).toBe(false);
  });

  it('revokes a refresh session and rejects unknown tokens', () => {
    const store = new AccountStore();
    const { account } = store.register('Rev', 'password1');
    const raw = store.issueRefresh(account!.id);
    expect(store.revokeRefresh(raw)).toBe(true);
    expect(store.rotateRefresh(raw).ok).toBe(false);
    expect(store.rotateRefresh('deadbeef').ok).toBe(false);
    expect(store.rotateRefresh(undefined).ok).toBe(false);
  });

  it('persists refresh tokens across a reload', () => {
    const p = new MemoryAccountPersistence();
    const s1 = new AccountStore(p);
    const { account } = s1.register('RefPersist', 'password1');
    const raw = s1.issueRefresh(account!.id);
    const s2 = new AccountStore(p);
    expect(s2.rotateRefresh(raw).ok).toBe(true);
  });
});

describe('authenticated multiplayer (§18.4)', () => {
  it('registers and logs in over REST with proper status codes and an HTTP-only cookie', async () => {
    const { port } = await makeAuthServer();
    const reg = await post(port, '/auth/register', { username: 'Alice', password: 'password1' });
    expect(reg.status).toBe(200);
    expect(reg.body.ok).toBe(true);
    expect(reg.body.accessToken).toBeTruthy();
    expect(reg.body.account!.username).toBe('Alice');
    // Refresh token is delivered only as an HttpOnly cookie, never in the body.
    expect(reg.setCookie.length).toBe(1);
    expect(reg.setCookie[0]).toMatch(/HttpOnly/i);
    expect(reg.setCookie[0]).toMatch(/pg_refresh=/);
    expect(JSON.stringify(reg.body)).not.toContain('pg_refresh');

    const dup = await post(port, '/auth/register', { username: 'Alice', password: 'password1' });
    expect(dup.status).toBe(409);

    const login = await post(port, '/auth/login', { username: 'Alice', password: 'password1' });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.setCookie[0]).toMatch(/HttpOnly/i);

    const bad = await post(port, '/auth/login', { username: 'Alice', password: 'nope' });
    expect(bad.status).toBe(401);
  });

  it('resumes a session by rotating the refresh cookie, and revokes it on logout', async () => {
    const { port } = await makeAuthServer();
    const reg = await post(port, '/auth/register', { username: 'Nomad', password: 'password1' });
    const cookie1 = cookiePair(reg.setCookie);

    // Refresh with the cookie → new access token + a rotated cookie.
    const r1 = await post(port, '/auth/refresh', undefined, cookie1);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    expect(r1.body.account!.username).toBe('Nomad');
    const cookie2 = cookiePair(r1.setCookie);
    expect(cookie2).not.toBe(cookie1); // rotation actually changed the token

    // The rotated (old) cookie is now dead; replaying it fails (reuse ⇒ revoke).
    const replay = await post(port, '/auth/refresh', undefined, cookie1);
    expect(replay.status).toBe(401);

    // Reuse detection revoked the whole family, so the fresh cookie dies too.
    const afterReuse = await post(port, '/auth/refresh', undefined, cookie2);
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the refresh session', async () => {
    const { port } = await makeAuthServer();
    const reg = await post(port, '/auth/register', { username: 'Bye', password: 'password1' });
    const cookie = cookiePair(reg.setCookie);

    const logout = await post(port, '/auth/logout', undefined, cookie);
    expect(logout.status).toBe(204);

    const afterLogout = await post(port, '/auth/refresh', undefined, cookie);
    expect(afterLogout.status).toBe(401);
  });

  it('refresh without a cookie is unauthorized', async () => {
    const { port } = await makeAuthServer();
    const r = await post(port, '/auth/refresh');
    expect(r.status).toBe(401);
  });

  it('binds an empire to a token that survives reconnect; a second account gets a different empire', async () => {
    const { port } = await makeAuthServer();
    const tokenA = await registerToken(port, 'Alice', 'password1');
    const tokenB = await registerToken(port, 'Bob', 'password1');

    const a = await connect(port);
    await a.next((m) => m.type === 'welcome');
    a.send({ type: 'join', token: tokenA });
    const wa = (await a.next(joined)) as Welcome;
    expect(wa.empireId).toBe('emp0');
    expect(wa.username).toBe('Alice');
    a.close();

    // Reconnect with the same token → same empire.
    const a2 = await connect(port);
    await a2.next((m) => m.type === 'welcome');
    a2.send({ type: 'join', token: tokenA });
    const wa2 = (await a2.next(joined)) as Welcome;
    expect(wa2.empireId).toBe('emp0');
    a2.close();

    // A different account is bound to a different empire.
    const b = await connect(port);
    await b.next((m) => m.type === 'welcome');
    b.send({ type: 'join', token: tokenB });
    const wb = (await b.next(joined)) as Welcome;
    expect(wb.empireId).toBe('emp1');
    b.close();
  });

  it('lets an authenticated player command, and reflects it on the authoritative world', async () => {
    const { server, port } = await makeAuthServer();
    const token = await registerToken(port, 'Cmdr', 'password1');
    const c = await connect(port);
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'join', token });
    const w = (await c.next(joined)) as Welcome;
    expect(w.empireId).toBe('emp0');

    c.send({ type: 'command', name: 'set_research', args: { physics: 70, economics: 30 } });
    const ack = await c.next((m) => m.type === 'ack' && (m as { name: string }).name === 'set_research');
    expect((ack as { ok: boolean }).ok).toBe(true);
    expect(server.world.empires['emp0'].researchSliders).toEqual({ physics: 70, economics: 30 });
    c.close();
  });

  it('joining without a valid token spectates: no empire, commands rejected', async () => {
    const { port } = await makeAuthServer();
    const c = await connect(port);
    const w1 = (await c.next((m) => m.type === 'welcome')) as Welcome; // initial
    expect(w1.empireId).toBeNull();

    c.send({ type: 'join' }); // no token
    const w2 = (await c.next((m) => m.type === 'welcome')) as Welcome; // join response
    expect(w2.empireId).toBeNull();
    expect(w2.mine).toBeNull();

    c.send({ type: 'command', name: 'set_research', args: {} });
    const ack = await c.next((m) => m.type === 'ack');
    expect((ack as { ok: boolean }).ok).toBe(false);
    c.close();
  });

  it('an invalid token also spectates rather than claiming an empire', async () => {
    const { port } = await makeAuthServer();
    const c = await connect(port);
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'join', token: 'not.a.real.token' });
    const w = (await c.next((m) => m.type === 'welcome')) as Welcome;
    expect(w.empireId).toBeNull();
    c.close();
  });
});
