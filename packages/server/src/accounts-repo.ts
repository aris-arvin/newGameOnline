/**
 * Normalized auth storage (design prompt §18.2): accounts live in Postgres,
 * refresh sessions in Redis.
 *
 *  - AccountRepo persists durable player identities as rows (not a blob) and
 *    the signing secret in an `auth_meta` row. AccountStore mirrors accounts in
 *    memory for the synchronous hot path, so the repo is only read once at boot
 *    and written on change.
 *  - RefreshRepo stores each refresh token under its own key with a native TTL,
 *    so expired sessions are reaped by the datastore for free, and a per-family
 *    set makes "revoke this whole login session" an O(members) delete — the
 *    reuse-detection tripwire.
 *
 * Memory + file implementations keep the default (no-database) path working;
 * the Postgres/Redis implementations sit behind the SqlClient / KvClient driver
 * interfaces so the real `pg` / `redis` clients or the in-memory fakes both fit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Account, RefreshRecord } from './auth.js';
import type { KvClient, SqlClient, SqlRow } from './storage.js';

export interface AccountRepo {
  init(): Promise<void>;
  loadAll(): Promise<{ secret: string | null; accounts: Account[] }>;
  saveSecret(secretHex: string): Promise<void>;
  upsertAccount(account: Account): Promise<void>;
  close(): Promise<void>;
}

export interface RefreshRepo {
  init(): Promise<void>;
  put(record: RefreshRecord, ttlSec: number): Promise<void>;
  get(hash: string): Promise<RefreshRecord | null>;
  markRotated(hash: string): Promise<void>;
  revokeFamily(family: string): Promise<void>;
  remove(hash: string): Promise<void>;
  close(): Promise<void>;
}

// --- Memory / file (default, no database) -----------------------------------

export class MemoryAccountRepo implements AccountRepo {
  protected secret: string | null = null;
  protected readonly accounts = new Map<string, Account>();

  async init(): Promise<void> {
    /* nothing to load */
  }
  async loadAll(): Promise<{ secret: string | null; accounts: Account[] }> {
    return { secret: this.secret, accounts: [...this.accounts.values()].map((a) => ({ ...a })) };
  }
  async saveSecret(secretHex: string): Promise<void> {
    this.secret = secretHex;
    await this.persist();
  }
  async upsertAccount(account: Account): Promise<void> {
    this.accounts.set(account.id, { ...account });
    await this.persist();
  }
  async close(): Promise<void> {
    /* nothing to release */
  }
  protected async persist(): Promise<void> {
    /* memory only */
  }
}

export class FileAccountRepo extends MemoryAccountRepo {
  constructor(private readonly file: string) {
    super();
  }
  override async init(): Promise<void> {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { secret?: string; accounts?: Account[] };
      this.secret = data.secret ?? null;
      for (const a of data.accounts ?? []) this.accounts.set(a.id, a);
    } catch {
      /* start empty on a corrupt file */
    }
  }
  protected override async persist(): Promise<void> {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ secret: this.secret, accounts: [...this.accounts.values()] }));
  }
}

export class MemoryRefreshRepo implements RefreshRepo {
  protected readonly records = new Map<string, RefreshRecord>();

  async init(): Promise<void> {
    /* nothing to load */
  }
  async put(record: RefreshRecord, _ttlSec: number): Promise<void> {
    void _ttlSec; // expiry is carried on record.expiresAt for the in-memory repo
    this.records.set(record.hash, { ...record });
    await this.persist();
  }
  async get(hash: string): Promise<RefreshRecord | null> {
    const r = this.records.get(hash);
    if (!r) return null;
    if (r.expiresAt < Date.now()) {
      this.records.delete(hash);
      await this.persist();
      return null;
    }
    return { ...r };
  }
  async markRotated(hash: string): Promise<void> {
    const r = this.records.get(hash);
    if (r) {
      r.rotated = true;
      await this.persist();
    }
  }
  async revokeFamily(family: string): Promise<void> {
    for (const [h, r] of this.records) if (r.family === family) this.records.delete(h);
    await this.persist();
  }
  async remove(hash: string): Promise<void> {
    this.records.delete(hash);
    await this.persist();
  }
  async close(): Promise<void> {
    /* nothing to release */
  }
  protected async persist(): Promise<void> {
    /* memory only */
  }
}

export class FileRefreshRepo extends MemoryRefreshRepo {
  constructor(private readonly file: string) {
    super();
  }
  override async init(): Promise<void> {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { records?: RefreshRecord[] };
      const now = Date.now();
      for (const r of data.records ?? []) if (r.expiresAt >= now) this.records.set(r.hash, r);
    } catch {
      /* start empty on a corrupt file */
    }
  }
  protected override async persist(): Promise<void> {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ records: [...this.records.values()] }));
  }
}

// --- Postgres accounts -------------------------------------------------------

interface AccountRow extends SqlRow {
  id: string;
  username: string;
  username_lower: string;
  salt: string;
  password_hash: string;
  empire_id: string | null;
  created_at: string | number;
}

function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id,
    username: r.username,
    usernameLower: r.username_lower,
    salt: r.salt,
    passwordHash: r.password_hash,
    empireId: r.empire_id ?? null,
    createdAt: Number(r.created_at),
  };
}

export class PostgresAccountRepo implements AccountRepo {
  constructor(private readonly sql: SqlClient) {}

  async init(): Promise<void> {
    await this.sql.query(
      `CREATE TABLE IF NOT EXISTS accounts (
         id text PRIMARY KEY,
         username text NOT NULL,
         username_lower text UNIQUE NOT NULL,
         salt text NOT NULL,
         password_hash text NOT NULL,
         empire_id text,
         created_at bigint NOT NULL
       )`,
    );
    await this.sql.query(`CREATE TABLE IF NOT EXISTS auth_meta (k text PRIMARY KEY, v text NOT NULL)`);
  }
  async loadAll(): Promise<{ secret: string | null; accounts: Account[] }> {
    const meta = await this.sql.query<{ v: string }>(`SELECT v FROM auth_meta WHERE k = $1`, ['secret']);
    const rows = await this.sql.query<AccountRow>(
      `SELECT id, username, username_lower, salt, password_hash, empire_id, created_at FROM accounts`,
    );
    return { secret: meta.rows[0]?.v ?? null, accounts: rows.rows.map(rowToAccount) };
  }
  async saveSecret(secretHex: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO auth_meta (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
      ['secret', secretHex],
    );
  }
  async upsertAccount(a: Account): Promise<void> {
    await this.sql.query(
      `INSERT INTO accounts (id, username, username_lower, salt, password_hash, empire_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         username_lower = EXCLUDED.username_lower,
         salt = EXCLUDED.salt,
         password_hash = EXCLUDED.password_hash,
         empire_id = EXCLUDED.empire_id`,
      [a.id, a.username, a.usernameLower, a.salt, a.passwordHash, a.empireId, a.createdAt],
    );
  }
  async close(): Promise<void> {
    await this.sql.end();
  }
}

// --- Redis refresh sessions --------------------------------------------------

export class RedisRefreshRepo implements RefreshRepo {
  private readonly rt: (h: string) => string;
  private readonly fam: (f: string) => string;

  constructor(
    private readonly kv: KvClient,
    prefix = 'pg:',
  ) {
    this.rt = (h) => `${prefix}rt:${h}`;
    this.fam = (f) => `${prefix}rtfam:${f}`;
  }

  async init(): Promise<void> {
    /* nothing to provision */
  }
  async put(record: RefreshRecord, ttlSec: number): Promise<void> {
    await this.kv.set(this.rt(record.hash), JSON.stringify(record), { ttlSec });
    // Track the token in its family set so the whole session can be revoked at
    // once; keep the set alive at least as long as its longest-lived member.
    await this.kv.sadd(this.fam(record.family), record.hash);
    await this.kv.expire(this.fam(record.family), ttlSec);
  }
  async get(hash: string): Promise<RefreshRecord | null> {
    const raw = await this.kv.get(this.rt(hash)); // null once Redis TTL expires it
    return raw ? (JSON.parse(raw) as RefreshRecord) : null;
  }
  async markRotated(hash: string): Promise<void> {
    const raw = await this.kv.get(this.rt(hash));
    if (!raw) return;
    const rec = JSON.parse(raw) as RefreshRecord;
    rec.rotated = true;
    await this.kv.set(this.rt(hash), JSON.stringify(rec), { keepTtl: true }); // don't extend the TTL
  }
  async revokeFamily(family: string): Promise<void> {
    const members = await this.kv.smembers(this.fam(family));
    if (members.length) await this.kv.del(...members.map((h) => this.rt(h)));
    await this.kv.del(this.fam(family));
  }
  async remove(hash: string): Promise<void> {
    await this.kv.del(this.rt(hash));
  }
  async close(): Promise<void> {
    await this.kv.quit();
  }
}
