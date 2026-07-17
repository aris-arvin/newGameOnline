/**
 * Durable storage adapters (design prompt §18.2: PostgreSQL for the world,
 * Redis for sessions/cache).
 *
 * The server keeps the authoritative WorldState and the AuthState in memory and
 * treats persistence as a checkpoint — loaded once at boot, saved periodically.
 * That maps cleanly onto a **write-behind KV blob**: on `save()` we update an
 * in-memory copy synchronously (so the tick loop never blocks on the database)
 * and flush it to the store asynchronously, coalescing bursts. Reads are served
 * from the copy that was pre-loaded during `init()`.
 *
 * Everything is expressed against two tiny driver interfaces so the real `pg`
 * and `redis` clients slot in behind them (via dynamic import, kept optional),
 * and in-memory fakes exercise the exact same code paths in tests.
 */

// --- Driver interfaces -------------------------------------------------------

export interface SqlRow {
  [column: string]: unknown;
}
export interface SqlClient {
  query<R extends SqlRow = SqlRow>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

export interface KvSetOptions {
  ttlSec?: number; // set an expiry (Redis EX)
  keepTtl?: boolean; // preserve the existing expiry (Redis KEEPTTL)
}
export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: KvSetOptions): Promise<void>;
  del(...keys: string[]): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, ttlSec: number): Promise<void>;
  quit(): Promise<void>;
}

// --- KV store abstraction ----------------------------------------------------

/** A minimal string keyspace both Postgres and Redis implement. */
export interface KvStore {
  init(): Promise<void>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

/** Postgres-backed KV: a single `text` blob per key, upserted atomically. */
export class PgKvStore implements KvStore {
  constructor(
    private readonly sql: SqlClient,
    private readonly table = 'pg_kv',
  ) {}

  async init(): Promise<void> {
    await this.sql.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (k text PRIMARY KEY, v text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
    );
  }
  async get(key: string): Promise<string | null> {
    const { rows } = await this.sql.query<{ v: string }>(`SELECT v FROM ${this.table} WHERE k = $1`, [key]);
    return rows[0]?.v ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO ${this.table} (k, v) VALUES ($1, $2)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
      [key, value],
    );
  }
  async close(): Promise<void> {
    await this.sql.end();
  }
}

/** Redis-backed KV: one string value per prefixed key. */
export class RedisKvStore implements KvStore {
  constructor(
    private readonly kv: KvClient,
    private readonly prefix = 'pg:',
  ) {}

  async init(): Promise<void> {
    /* nothing to provision */
  }
  get(key: string): Promise<string | null> {
    return this.kv.get(this.prefix + key);
  }
  put(key: string, value: string): Promise<void> {
    return this.kv.set(this.prefix + key, value);
  }
  close(): Promise<void> {
    return this.kv.quit();
  }
}

/**
 * Write-behind JSON blob over a KvStore. Implements the sync `Persistence` and
 * `AccountPersistence` shapes (load returns the pre-loaded snapshot; save
 * updates it and schedules a background flush that coalesces bursty writes), so
 * `GameServer` and `AccountStore` use it unchanged.
 */
export class KvBlobStore<T> {
  private cache: string | null = null;
  private pending: string | null = null;
  private draining = false;
  private inflight: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: KvStore,
    private readonly key: string,
  ) {}

  /** Provision the backing store and load the current snapshot into memory. */
  async init(): Promise<void> {
    await this.store.init();
    this.cache = await this.store.get(this.key);
  }

  load(): T | null {
    return this.cache != null ? (JSON.parse(this.cache) as T) : null;
  }

  save(value: T): void {
    this.cache = JSON.stringify(value);
    this.pending = this.cache;
    this.kick();
  }

  private kick(): void {
    if (this.draining) return; // the running drain will pick up the new pending
    this.draining = true;
    this.inflight = (async () => {
      try {
        while (this.pending != null) {
          const v = this.pending;
          this.pending = null;
          try {
            await this.store.put(this.key, v);
          } catch (err) {
            console.error(`[storage] failed writing "${this.key}"`, err);
          }
        }
      } finally {
        this.draining = false;
      }
    })();
  }

  /** Await all scheduled writes (for tests and graceful shutdown). */
  async flush(): Promise<void> {
    await this.inflight;
    if (this.pending != null) {
      this.kick();
      await this.inflight;
    }
  }

  async close(): Promise<void> {
    await this.flush();
    await this.store.close();
  }
}

// --- Real driver factories (optional deps, imported only when configured) ----

// A non-literal specifier keeps `pg`/`redis` out of the compile-time graph, so
// the package builds and runs without them; install them for production use.
async function optionalImport(name: string): Promise<Record<string, unknown>> {
  return import(/* @vite-ignore */ name) as Promise<Record<string, unknown>>;
}

/** Wrap `pg`'s Pool in the SqlClient interface. Requires `pg` to be installed. */
export async function createSqlClient(connectionString: string): Promise<SqlClient> {
  const pg = await optionalImport('pg');
  const Pool = (pg as { Pool: new (cfg: unknown) => unknown }).Pool;
  const pool = new Pool({ connectionString }) as {
    query: (text: string, params?: unknown[]) => Promise<{ rows: SqlRow[] }>;
    end: () => Promise<void>;
  };
  return {
    query: <R extends SqlRow>(text: string, params?: unknown[]) =>
      pool.query(text, params) as Promise<{ rows: R[] }>,
    end: () => pool.end(),
  };
}

/** Wrap `redis`'s client in the KvClient interface. Requires `redis` installed. */
export async function createKvClient(url: string): Promise<KvClient> {
  const redis = await optionalImport('redis');
  const createClient = (redis as { createClient: (cfg: unknown) => unknown }).createClient;
  const client = createClient({ url }) as {
    connect: () => Promise<void>;
    get: (k: string) => Promise<string | null>;
    set: (k: string, v: string, opts?: Record<string, unknown>) => Promise<unknown>;
    del: (keys: string[]) => Promise<unknown>;
    sAdd: (k: string, m: string) => Promise<unknown>;
    sMembers: (k: string) => Promise<string[]>;
    expire: (k: string, s: number) => Promise<unknown>;
    quit: () => Promise<unknown>;
  };
  await client.connect();
  return {
    get: (k) => client.get(k),
    set: (k, v, opts) => {
      const o: Record<string, unknown> = {};
      if (opts?.ttlSec != null) o.EX = opts.ttlSec;
      if (opts?.keepTtl) o.KEEPTTL = true;
      return client.set(k, v, o).then(() => undefined);
    },
    del: (...keys) => (keys.length ? client.del(keys).then(() => undefined) : Promise.resolve()),
    sadd: (k, m) => client.sAdd(k, m).then(() => undefined),
    smembers: (k) => client.sMembers(k),
    expire: (k, s) => client.expire(k, s).then(() => undefined),
    quit: () => client.quit().then(() => undefined),
  };
}

// --- In-memory fakes (tests, and a dependency-free local option) -------------

/**
 * In-memory SqlClient that recognises the statements our stores/repos issue
 * (the `pg_kv` blob table, plus the normalized `accounts` / `auth_meta`
 * tables). It exercises the real SQL/param mapping without a live Postgres.
 */
export class FakeSql implements SqlClient {
  readonly kv = new Map<string, string>();
  readonly accounts = new Map<string, SqlRow>();
  readonly meta = new Map<string, string>();
  queries = 0;

  async query<R extends SqlRow = SqlRow>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
    this.queries++;
    const t = text.trim();
    if (/^CREATE TABLE/i.test(t)) return { rows: [] };

    if (/\bpg_kv\b/i.test(t)) {
      if (/^INSERT/i.test(t)) return (this.kv.set(String(params[0]), String(params[1])), { rows: [] });
      const v = this.kv.get(String(params[0]));
      return { rows: (v != null ? [{ v }] : []) as unknown as R[] };
    }
    if (/\bauth_meta\b/i.test(t)) {
      if (/^INSERT/i.test(t)) return (this.meta.set(String(params[0]), String(params[1])), { rows: [] });
      const v = this.meta.get(String(params[0]));
      return { rows: (v != null ? [{ v }] : []) as unknown as R[] };
    }
    if (/\baccounts\b/i.test(t)) {
      if (/^INSERT/i.test(t)) {
        const [id, username, username_lower, salt, password_hash, empire_id, created_at] = params;
        this.accounts.set(String(id), { id, username, username_lower, salt, password_hash, empire_id: empire_id ?? null, created_at });
        return { rows: [] };
      }
      return { rows: [...this.accounts.values()] as unknown as R[] };
    }
    return { rows: [] };
  }
  async end(): Promise<void> {
    /* no-op */
  }
}

/**
 * In-memory KvClient emulating the Redis features the refresh repo relies on:
 * string values with lazy TTL expiry, and sets (for family membership).
 */
export class FakeKv implements KvClient {
  private readonly strings = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly expiry = new Map<string, number>(); // key -> epoch ms

  private alive(key: string): boolean {
    const e = this.expiry.get(key);
    if (e != null && e <= Date.now()) {
      this.strings.delete(key);
      this.sets.delete(key);
      this.expiry.delete(key);
      return false;
    }
    return true;
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key) && this.strings.has(key) ? this.strings.get(key)! : null;
  }
  async set(key: string, value: string, opts?: KvSetOptions): Promise<void> {
    this.alive(key);
    this.strings.set(key, value);
    if (opts?.ttlSec != null) this.expiry.set(key, Date.now() + opts.ttlSec * 1000);
    else if (!opts?.keepTtl) this.expiry.delete(key);
  }
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) {
      this.strings.delete(k);
      this.sets.delete(k);
      this.expiry.delete(k);
    }
  }
  async sadd(key: string, member: string): Promise<void> {
    this.alive(key);
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = new Set()));
    s.add(member);
  }
  async smembers(key: string): Promise<string[]> {
    return this.alive(key) ? [...(this.sets.get(key) ?? [])] : [];
  }
  async expire(key: string, ttlSec: number): Promise<void> {
    if (this.strings.has(key) || this.sets.has(key)) this.expiry.set(key, Date.now() + ttlSec * 1000);
  }
  async quit(): Promise<void> {
    /* no-op */
  }

  /** Test helper: how many live string keys exist. */
  liveKeys(): number {
    let n = 0;
    for (const k of this.strings.keys()) if (this.alive(k)) n++;
    return n;
  }
}
