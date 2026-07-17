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

export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
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
    set: (k: string, v: string) => Promise<unknown>;
    del: (k: string) => Promise<unknown>;
    quit: () => Promise<unknown>;
  };
  await client.connect();
  return {
    get: (k) => client.get(k),
    set: (k, v) => client.set(k, v).then(() => undefined),
    del: (k) => client.del(k).then(() => undefined),
    quit: () => client.quit().then(() => undefined),
  };
}

// --- In-memory fakes (tests, and a dependency-free local option) -------------

/** In-memory SqlClient understanding just the PgKvStore statements. */
export class FakeSql implements SqlClient {
  readonly rows = new Map<string, string>();
  queries = 0;

  async query<R extends SqlRow = SqlRow>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
    this.queries++;
    const sql = text.trim().toUpperCase();
    if (sql.startsWith('CREATE TABLE')) return { rows: [] };
    if (sql.startsWith('INSERT INTO')) {
      this.rows.set(String(params[0]), String(params[1]));
      return { rows: [] };
    }
    if (sql.startsWith('SELECT')) {
      const v = this.rows.get(String(params[0]));
      return { rows: (v != null ? [{ v }] : []) as unknown as R[] };
    }
    return { rows: [] };
  }
  async end(): Promise<void> {
    /* no-op */
  }
}

/** In-memory KvClient. */
export class FakeKv implements KvClient {
  readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
  async quit(): Promise<void> {
    /* no-op */
  }
}
