/**
 * Accounts & authentication (design prompt §18.2 `auth` service, §18.4).
 *
 * A self-contained account layer with no external dependencies: passwords are
 * per-user salted and scrypt-hashed, session tokens are HMAC-signed and
 * stateless (so they survive server restarts as long as the signing secret is
 * persisted alongside the accounts). Each account is bound to exactly one
 * empire — that binding is what makes an empire *yours* across reconnects and
 * season restarts, instead of grabbing whatever slot is free.
 *
 * Persistence mirrors the world's pluggable pattern (memory + file adapters);
 * a production deployment would back the same interface with Postgres (§18.2).
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Account {
  id: string;
  username: string;
  usernameLower: string;
  salt: string; // hex
  passwordHash: string; // hex
  empireId: string | null;
  createdAt: number;
}

export interface AuthState {
  secret: string; // hex — HMAC signing key
  accounts: Account[];
}

export interface AccountPersistence {
  load(): AuthState | null;
  save(state: AuthState): void;
}

export class MemoryAccountPersistence implements AccountPersistence {
  private data: string | null = null;
  load(): AuthState | null {
    return this.data ? (JSON.parse(this.data) as AuthState) : null;
  }
  save(state: AuthState): void {
    this.data = JSON.stringify(state);
  }
}

export class FileAccountPersistence implements AccountPersistence {
  constructor(private readonly file: string) {}
  load(): AuthState | null {
    if (!existsSync(this.file)) return null;
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as AuthState;
    } catch {
      return null;
    }
  }
  save(state: AuthState): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(state));
  }
}

const SCRYPT_KEYLEN = 32;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
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
  token?: string;
}

export function publicAccount(a: Account): PublicAccount {
  return { id: a.id, username: a.username, empireId: a.empireId };
}

export class AccountStore {
  private secret: Buffer;
  private readonly accounts = new Map<string, Account>(); // id -> account
  private readonly byName = new Map<string, string>(); // usernameLower -> id
  private nextId = 1;

  constructor(private readonly persistence: AccountPersistence = new MemoryAccountPersistence()) {
    const loaded = this.persistence.load();
    if (loaded) {
      this.secret = Buffer.from(loaded.secret, 'hex');
      for (const a of loaded.accounts) {
        this.accounts.set(a.id, a);
        this.byName.set(a.usernameLower, a.id);
        const n = Number(a.id.replace(/\D/g, ''));
        if (Number.isFinite(n) && n >= this.nextId) this.nextId = n + 1;
      }
    } else {
      this.secret = randomBytes(32);
      this.flush();
    }
  }

  private flush(): void {
    this.persistence.save({ secret: this.secret.toString('hex'), accounts: [...this.accounts.values()] });
  }

  private hash(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, SCRYPT_KEYLEN);
  }

  register(username: string, password: string): AuthResult {
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
    this.accounts.set(account.id, account);
    this.byName.set(lower, account.id);
    this.flush();
    return { ok: true, account, token: this.issueToken(account.id) };
  }

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

  /** Stateless signed token: base64url(accountId.expiry).base64url(hmac). */
  issueToken(accountId: string): string {
    const body = `${accountId}.${Date.now() + TOKEN_TTL_MS}`;
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

  get(accountId: string): Account | null {
    return this.accounts.get(accountId) ?? null;
  }

  bindEmpire(accountId: string, empireId: string): void {
    const a = this.accounts.get(accountId);
    if (a) {
      a.empireId = empireId;
      this.flush();
    }
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
}
