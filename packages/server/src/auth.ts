/**
 * Accounts & authentication (design prompt §18.2 `auth` service, §18.4).
 *
 * Two-token model, production-shaped:
 *  - a short-lived **access token** — HMAC-signed, stateless, ~15 min — kept in
 *    the client's memory and handed to the WebSocket `join`;
 *  - a long-lived **refresh token** — opaque random, stored server-side (only
 *    its hash), delivered to the browser only as an HTTP-only cookie. It is
 *    rotated on every use and replaying a rotated token revokes the whole
 *    session family — the stolen-token tripwire.
 *
 * Durable storage is delegated to two repositories (see `accounts-repo.ts`):
 * accounts + signing secret to `AccountRepo` (Postgres), refresh sessions to
 * `RefreshRepo` (Redis, with native per-key TTL). Accounts are mirrored in
 * memory so the hot WebSocket path — access-token validation and empire
 * binding — stays synchronous; only the async REST handlers touch the refresh
 * store. Password hashing is scrypt; no external dependencies.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { MemoryAccountRepo, MemoryRefreshRepo, type AccountRepo, type RefreshRepo } from './accounts-repo.js';

export interface Account {
  id: string;
  username: string;
  usernameLower: string;
  salt: string; // hex
  passwordHash: string; // hex
  empireId: string | null;
  createdAt: number;
}

/** A stored refresh token — only its hash is ever persisted. */
export interface RefreshRecord {
  hash: string; // sha256(rawToken) hex
  accountId: string;
  family: string; // session id; rotation stays within one family
  expiresAt: number;
  rotated: boolean; // consumed by a rotation (replay ⇒ theft)
  revoked: boolean;
}

const SCRYPT_KEYLEN = 32;
export const ACCESS_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;

/** Public shape sent to clients — never includes salt/hash. */
export interface PublicAccount {
  id: string;
  username: string;
  empireId: string | null;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  account?: Account;
  token?: string; // access token
}

/** Outcome of rotating a refresh token. */
export interface RefreshResult {
  ok: boolean;
  reuse?: boolean; // a rotated token was replayed — family was revoked
  accountId?: string;
  refresh?: string; // new raw refresh token to re-cookie
  token?: string; // new access token
}

export function publicAccount(a: Account): PublicAccount {
  return { id: a.id, username: a.username, empireId: a.empireId };
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export class AccountStore {
  private secret: Buffer = Buffer.alloc(0);
  private readonly accounts = new Map<string, Account>(); // id -> account (mirror)
  private readonly byName = new Map<string, string>(); // usernameLower -> id
  private readonly writes = new Set<Promise<unknown>>(); // in-flight write-behind
  private nextId = 1;

  constructor(
    private readonly accountRepo: AccountRepo = new MemoryAccountRepo(),
    private readonly refreshRepo: RefreshRepo = new MemoryRefreshRepo(),
  ) {}

  /** Load accounts + signing secret into the in-memory mirror. Must be awaited
   *  before the store serves requests. */
  async init(): Promise<void> {
    await this.accountRepo.init();
    await this.refreshRepo.init();
    const { secret, accounts } = await this.accountRepo.loadAll();
    if (secret) {
      this.secret = Buffer.from(secret, 'hex');
    } else {
      this.secret = randomBytes(32);
      await this.accountRepo.saveSecret(this.secret.toString('hex'));
    }
    for (const a of accounts) {
      this.accounts.set(a.id, a);
      this.byName.set(a.usernameLower, a.id);
      const n = Number(a.id.replace(/\D/g, ''));
      if (Number.isFinite(n) && n >= this.nextId) this.nextId = n + 1;
    }
  }

  private hash(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, SCRYPT_KEYLEN);
  }

  async register(username: string, password: string): Promise<AuthResult> {
    const name = (username ?? '').trim();
    if (!USERNAME_RE.test(name)) return { ok: false, error: 'username must be 3–20 letters, digits or underscore' };
    if ((password ?? '').length < MIN_PASSWORD) return { ok: false, error: `password must be at least ${MIN_PASSWORD} characters` };
    const lower = name.toLowerCase();
    if (this.byName.has(lower)) return { ok: false, error: 'username already taken' };

    const salt = randomBytes(16);
    const account: Account = {
      id: `acc${this.nextId++}`,
      username: name,
      usernameLower: lower,
      salt: salt.toString('hex'),
      passwordHash: this.hash(password, salt).toString('hex'),
      empireId: null,
      createdAt: Date.now(),
    };
    // Reserve in the mirror synchronously so two concurrent registrations of the
    // same name can't both pass the uniqueness check across the await below.
    this.accounts.set(account.id, account);
    this.byName.set(lower, account.id);
    try {
      await this.accountRepo.upsertAccount(account);
    } catch (err) {
      this.accounts.delete(account.id);
      this.byName.delete(lower);
      console.error('[auth] failed persisting account', err);
      return { ok: false, error: 'storage unavailable' };
    }
    return { ok: true, account, token: this.issueToken(account.id) };
  }

  /** Synchronous: only reads the in-memory mirror. */
  login(username: string, password: string): AuthResult {
    const id = this.byName.get((username ?? '').trim().toLowerCase());
    const account = id ? this.accounts.get(id) : undefined;
    if (!account) {
      // Hash anyway so a missing user costs roughly the same as a wrong password.
      this.hash(password ?? '', Buffer.alloc(16));
      return { ok: false, error: 'invalid username or password' };
    }
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = this.hash(password ?? '', Buffer.from(account.salt, 'hex'));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, error: 'invalid username or password' };
    }
    return { ok: true, account, token: this.issueToken(account.id) };
  }

  // --- Access tokens (stateless, short-lived) ---

  /** Signed token: base64url(accountId.expiry).base64url(hmac). */
  issueToken(accountId: string): string {
    const body = `${accountId}.${Date.now() + ACCESS_TTL_MS}`;
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${Buffer.from(body).toString('base64url')}.${sig}`;
  }

  validateToken(token: string | undefined): Account | null {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const body = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    const sig = token.slice(dot + 1);
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [accountId, expStr] = body.split('.');
    if (!accountId || !expStr || Number(expStr) < Date.now()) return null;
    return this.accounts.get(accountId) ?? null;
  }

  // --- Refresh tokens (server-side, rotating; async) ---

  async issueRefresh(accountId: string, family?: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    const rec: RefreshRecord = {
      hash: sha256(raw),
      accountId,
      family: family ?? randomBytes(9).toString('base64url'),
      expiresAt: Date.now() + REFRESH_TTL_MS,
      rotated: false,
      revoked: false,
    };
    await this.refreshRepo.put(rec, Math.ceil(REFRESH_TTL_MS / 1000));
    return raw;
  }

  async rotateRefresh(raw: string | undefined): Promise<RefreshResult> {
    if (!raw) return { ok: false };
    const rec = await this.refreshRepo.get(sha256(raw)); // null once its TTL lapses
    if (!rec || rec.revoked) return { ok: false };
    if (rec.rotated) {
      await this.refreshRepo.revokeFamily(rec.family); // replay of a used token ⇒ kill the session
      return { ok: false, reuse: true };
    }
    await this.refreshRepo.markRotated(rec.hash);
    const next = await this.issueRefresh(rec.accountId, rec.family);
    return { ok: true, accountId: rec.accountId, refresh: next, token: this.issueToken(rec.accountId) };
  }

  async revokeRefresh(raw: string | undefined): Promise<boolean> {
    if (!raw) return false;
    const rec = await this.refreshRepo.get(sha256(raw));
    if (!rec) return false;
    await this.refreshRepo.revokeFamily(rec.family);
    return true;
  }

  // --- Accounts / empire binding (synchronous mirror + write-behind) ---

  get(accountId: string): Account | null {
    return this.accounts.get(accountId) ?? null;
  }

  bindEmpire(accountId: string, empireId: string): void {
    const a = this.accounts.get(accountId);
    if (!a) return;
    a.empireId = empireId;
    this.track(this.accountRepo.upsertAccount(a)); // durable, non-blocking
  }

  /** Empires already owned by some account (so we never hand one out twice). */
  boundEmpires(): Set<string> {
    const s = new Set<string>();
    for (const a of this.accounts.values()) if (a.empireId) s.add(a.empireId);
    return s;
  }

  get size(): number {
    return this.accounts.size;
  }

  private track(p: Promise<unknown>): void {
    const q = p.catch((err) => console.error('[auth] write-behind failed', err));
    this.writes.add(q);
    void q.finally(() => this.writes.delete(q));
  }

  /** Await outstanding write-behind persists (graceful shutdown / tests). */
  async drain(): Promise<void> {
    await Promise.all([...this.writes]);
  }

  async close(): Promise<void> {
    await this.drain();
    await this.accountRepo.close();
    await this.refreshRepo.close();
  }
}
