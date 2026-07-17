/**
 * Run the authoritative PURE GALAXY server.
 *
 *   PORT=8787 TICK_MS=2000 pnpm --filter @pure-galaxy/server run serve
 *
 * Durable storage (design prompt §18.2) is chosen by environment:
 *   DATABASE_URL  → world blob + normalized accounts in Postgres
 *   REDIS_URL     → refresh sessions in Redis (per-key native TTL)
 * With neither set it falls back to JSON files under .data/ — no DB required.
 * Install `pg` / `redis` for the database adapters.
 */
import { loadWorldData, nodeTacticalResolver } from '@pure-galaxy/world-core/node';
import type { WorldState } from '@pure-galaxy/world-core';
import { GameServer } from '../src/server.js';
import { FilePersistence, type Persistence } from '../src/persistence.js';
import { AccountStore } from '../src/auth.js';
import {
  FileAccountRepo,
  FileRefreshRepo,
  PostgresAccountRepo,
  RedisRefreshRepo,
  type AccountRepo,
  type RefreshRepo,
} from '../src/accounts-repo.js';
import { KvBlobStore, PgKvStore, createKvClient, createSqlClient, type KvClient, type SqlClient } from '../src/storage.js';

async function main(): Promise<void> {
  const data = loadWorldData();
  const resolver = nodeTacticalResolver();
  const port = Number(process.env.PORT ?? 8787);
  const tickMs = Number(process.env.TICK_MS ?? 2000);

  // Shared clients (opened once, closed once); flushes run before closes.
  const flushes: (() => Promise<void>)[] = [];
  const closers: (() => Promise<void>)[] = [];
  let sql: SqlClient | null = null;
  let kv: KvClient | null = null;
  if (process.env.DATABASE_URL) sql = await createSqlClient(process.env.DATABASE_URL);
  if (process.env.REDIS_URL) kv = await createKvClient(process.env.REDIS_URL);

  // World → Postgres blob (ACID) if configured, else a local JSON file.
  let worldPersistence: Persistence;
  let worldLabel: string;
  if (sql) {
    const blob = new KvBlobStore<WorldState>(new PgKvStore(sql), 'world:current');
    await blob.init();
    worldPersistence = blob;
    worldLabel = 'postgres[world:current]';
    flushes.push(() => blob.flush());
  } else {
    worldPersistence = new FilePersistence('.data/world.json');
    worldLabel = '.data/world.json';
  }

  // Accounts → Postgres tables; refresh sessions → Redis; else JSON files.
  const accountRepo: AccountRepo = sql ? new PostgresAccountRepo(sql) : new FileAccountRepo('.data/accounts.json');
  const refreshRepo: RefreshRepo = kv ? new RedisRefreshRepo(kv) : new FileRefreshRepo('.data/refresh.json');
  const accounts = new AccountStore(accountRepo, refreshRepo);
  await accounts.init();
  flushes.push(() => accounts.drain());
  const accountLabel = sql ? 'postgres[accounts]' : '.data/accounts.json';
  const refreshLabel = kv ? 'redis[rt:*]' : '.data/refresh.json';

  if (sql) closers.push(() => sql!.end());
  if (kv) closers.push(() => kv!.quit());

  const server = new GameServer({
    data,
    resolver,
    persistence: worldPersistence,
    accounts,
    // Cookie policy: production serves over HTTPS with COOKIE_SECURE=true (and
    // SameSite=None if the API is on a different site than the app). The dev
    // default is insecure so the cookie survives plain-HTTP localhost.
    authCookie: {
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: (process.env.COOKIE_SAMESITE as 'Lax' | 'Strict' | 'None') || 'Lax',
      domain: process.env.COOKIE_DOMAIN || undefined,
    },
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()) : undefined,
    tickIntervalMs: tickMs,
    autoTick: true,
    autosaveEveryTicks: 10,
  });

  const p = await server.start(port);
  console.log(`PURE GALAXY server listening on http://localhost:${p}`);
  console.log(`  REST:  GET /health, GET /state`);
  console.log(`  auth:  POST /auth/{register,login,refresh,logout}`);
  console.log(`  WS:    ws://localhost:${p}  (join {token}, command, ping)`);
  console.log(`  store: world → ${worldLabel} · accounts → ${accountLabel} · refresh → ${refreshLabel}`);
  console.log(`  tick:  every ${tickMs}ms`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nshutting down…');
    await server.stop(); // checkpoints the world into the persistence layer
    for (const f of flushes) await f().catch((e) => console.error('[storage] flush failed', e));
    for (const c of closers) await c().catch((e) => console.error('[storage] close failed', e));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('failed to start server:', err);
  process.exit(1);
});
