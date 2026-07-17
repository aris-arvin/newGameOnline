import { describe, expect, it } from 'vitest';
import { loadWorldData, nodeTacticalResolver } from '@pure-galaxy/world-core/node';
import { worldHash } from '@pure-galaxy/world-core';
import type { WorldState } from '@pure-galaxy/world-core';
import { GameServer } from '../src/server.js';
import { FakeKv, FakeSql, KvBlobStore, PgKvStore, RedisKvStore } from '../src/storage.js';

const data = loadWorldData();
const resolver = nodeTacticalResolver();

describe('KV stores (§18.2 Postgres/Redis)', () => {
  it('PgKvStore round-trips a value and upserts in place', async () => {
    const sql = new FakeSql();
    const store = new PgKvStore(sql);
    await store.init();
    expect(await store.get('k')).toBeNull();
    await store.put('k', 'hello');
    expect(await store.get('k')).toBe('hello');
    await store.put('k', 'world'); // ON CONFLICT DO UPDATE
    expect(await store.get('k')).toBe('world');
    expect(sql.kv.size).toBe(1); // upsert, not insert-twice
  });

  it('RedisKvStore round-trips a prefixed value', async () => {
    const kv = new FakeKv();
    const store = new RedisKvStore(kv, 'pg:');
    await store.init();
    await store.put('auth:state', 'blob');
    expect(await store.get('auth:state')).toBe('blob');
    expect(await kv.get('pg:auth:state')).toBe('blob'); // prefix applied
    expect(await store.get('missing')).toBeNull();
  });
});

describe('KvBlobStore write-behind', () => {
  it('serves reads from the preloaded snapshot and flushes async', async () => {
    const kv = new FakeKv();
    await kv.set('pg:x', JSON.stringify({ n: 1 }));
    const blob = new KvBlobStore<{ n: number }>(new RedisKvStore(kv), 'x');
    await blob.init();
    expect(blob.load()).toEqual({ n: 1 }); // preloaded

    blob.save({ n: 2 });
    expect(blob.load()).toEqual({ n: 2 }); // cache updated synchronously
    await blob.flush();
    expect(await kv.get('pg:x')).toBe(JSON.stringify({ n: 2 })); // reached the store
  });

  it('coalesces a burst of saves into the latest value', async () => {
    const sql = new FakeSql();
    const blob = new KvBlobStore<{ n: number }>(new PgKvStore(sql), 'burst');
    await blob.init();
    const before = sql.queries;
    for (let i = 1; i <= 20; i++) blob.save({ n: i });
    await blob.flush();
    expect(JSON.parse(sql.kv.get('burst')!)).toEqual({ n: 20 });
    expect(sql.queries - before).toBeLessThan(20); // 20 saves collapse into far fewer writes
  });

  it('load() is null for an absent key', async () => {
    const blob = new KvBlobStore<unknown>(new PgKvStore(new FakeSql()), 'nope');
    await blob.init();
    expect(blob.load()).toBeNull();
  });
});

describe('world checkpoint → Postgres', () => {
  it('reloads a checkpointed world (worldHash matches)', async () => {
    const sql = new FakeSql();
    const blob1 = new KvBlobStore<WorldState>(new PgKvStore(sql), 'world:current');
    await blob1.init();

    const s1 = new GameServer({ data, resolver, persistence: blob1, seed: 3, autoTick: false });
    s1.tickOnce();
    s1.tickOnce();
    const hash = worldHash(s1.world);
    await s1.stop(); // persistence.save(world)
    await blob1.flush(); // let the write-behind reach Postgres

    // Fresh process: a new blob over the same store reloads the checkpoint.
    const blob2 = new KvBlobStore<WorldState>(new PgKvStore(sql), 'world:current');
    await blob2.init();
    const s2 = new GameServer({ data, resolver, persistence: blob2, autoTick: false });
    expect(worldHash(s2.world)).toBe(hash);
    await s2.stop();
  });
});
