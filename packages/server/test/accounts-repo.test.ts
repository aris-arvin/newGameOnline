import { describe, expect, it } from 'vitest';
import { AccountStore, REFRESH_TTL_MS, type Account, type RefreshRecord } from '../src/auth.js';
import {
  MemoryRefreshRepo,
  PostgresAccountRepo,
  RedisRefreshRepo,
} from '../src/accounts-repo.js';
import { FakeKv, FakeSql } from '../src/storage.js';

function rec(hash: string, family: string, expiresAt = Date.now() + REFRESH_TTL_MS): RefreshRecord {
  return { hash, accountId: 'acc1', family, expiresAt, rotated: false, revoked: false };
}

describe('RedisRefreshRepo (per-key TTL + family sets)', () => {
  it('stores, reads, marks rotated (keeping TTL) and revokes a family', async () => {
    const kv = new FakeKv();
    const repo = new RedisRefreshRepo(kv);
    await repo.put(rec('h1', 'famA'), 1000);
    expect((await repo.get('h1'))!.family).toBe('famA');

    await repo.markRotated('h1');
    expect((await repo.get('h1'))!.rotated).toBe(true); // still readable → TTL preserved

    await repo.put(rec('h2', 'famA'), 1000);
    await repo.revokeFamily('famA'); // O(members) delete via the family set
    expect(await repo.get('h1')).toBeNull();
    expect(await repo.get('h2')).toBeNull();
  });

  it('lets the datastore expire tokens by native TTL', async () => {
    const kv = new FakeKv();
    const repo = new RedisRefreshRepo(kv);
    await repo.put(rec('h3', 'famB'), 0); // ttl 0 → gone on next read
    expect(await repo.get('h3')).toBeNull();
    expect(kv.liveKeys()).toBe(0);
  });
});

describe('MemoryRefreshRepo', () => {
  it('honours expiresAt and family revoke', async () => {
    const repo = new MemoryRefreshRepo();
    await repo.put(rec('h1', 'famA'), 1000);
    expect((await repo.get('h1'))!.hash).toBe('h1');

    await repo.put(rec('h2', 'famB', Date.now() - 1), 1000); // already expired
    expect(await repo.get('h2')).toBeNull();

    await repo.revokeFamily('famA');
    expect(await repo.get('h1')).toBeNull();
  });
});

describe('PostgresAccountRepo (normalized rows)', () => {
  it('upserts accounts and the signing secret, then reloads them', async () => {
    const sql = new FakeSql();
    const repo = new PostgresAccountRepo(sql);
    await repo.init();

    const acc: Account = {
      id: 'acc1',
      username: 'Alice',
      usernameLower: 'alice',
      salt: 'aa',
      passwordHash: 'bb',
      empireId: null,
      createdAt: 123,
    };
    await repo.upsertAccount(acc);
    await repo.saveSecret('deadbeef');

    const loaded = await repo.loadAll();
    expect(loaded.secret).toBe('deadbeef');
    expect(loaded.accounts).toHaveLength(1);
    expect(loaded.accounts[0]).toEqual(acc); // row → Account mapping (incl. numeric created_at)

    await repo.upsertAccount({ ...acc, empireId: 'emp0' }); // ON CONFLICT update
    expect((await repo.loadAll()).accounts[0].empireId).toBe('emp0');
    expect(sql.accounts.size).toBe(1);
  });
});

describe('AccountStore over Postgres + Redis fakes', () => {
  it('persists accounts, secret and refresh sessions across a restart', async () => {
    const sql = new FakeSql();
    const kv = new FakeKv();

    const s1 = new AccountStore(new PostgresAccountRepo(sql), new RedisRefreshRepo(kv));
    await s1.init();
    const reg = await s1.register('Nomad', 'password1');
    s1.bindEmpire(reg.account!.id, 'emp1');
    await s1.drain(); // flush the write-behind empire binding
    const refreshRaw = await s1.issueRefresh(reg.account!.id);

    // Fresh store over the same datastores = a server restart.
    const s2 = new AccountStore(new PostgresAccountRepo(sql), new RedisRefreshRepo(kv));
    await s2.init();
    expect(s2.validateToken(reg.token)!.id).toBe(reg.account!.id); // secret survived (auth_meta)
    expect(s2.get(reg.account!.id)!.empireId).toBe('emp1'); // binding survived (accounts row)
    expect((await s2.rotateRefresh(refreshRaw)).ok).toBe(true); // refresh session survived (Redis)
  });
});
