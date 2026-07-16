import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { loadWorldData, nodeTacticalResolver } from '@pure-galaxy/world-core/node';
import { worldHash } from '@pure-galaxy/world-core';
import { GameServer } from '../src/server.js';
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
async function makeServer(persistence = new MemoryPersistence(), seed = 7): Promise<{ server: GameServer; port: number }> {
  const server = new GameServer({ data, resolver, persistence, seed, autoTick: false });
  servers.push(server);
  const port = await server.start(0);
  return { server, port };
}

afterEach(async () => {
  while (servers.length) await servers.pop()!.stop();
});

describe('authoritative game server (§18.2, §18.4)', () => {
  it('a client joins an empire and receives streamed snapshots', async () => {
    const { server, port } = await makeServer();
    const c = await connect(port);
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'join' });
    const joined = await c.next((m) => m.type === 'welcome' && (m as { empireId?: string }).empireId != null);
    expect((joined as { empireId: string }).empireId).toBe('emp0');

    server.tickOnce();
    const snap = await c.next((m) => m.type === 'snapshot' && (m as { tick: number }).tick === 1);
    expect((snap as { public: { standings: unknown[] } }).public.standings.length).toBe(4);
    c.close();
  });

  it('validates commands and mutates the authoritative world', async () => {
    const { server, port } = await makeServer();
    const c = await connect(port);
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'join' });
    await c.next((m) => m.type === 'welcome' && (m as { empireId?: string }).empireId != null);

    c.send({ type: 'command', name: 'set_research', args: { physics: 80, economics: 20 } });
    const ack = await c.next((m) => m.type === 'ack' && (m as { name: string }).name === 'set_research');
    expect((ack as { ok: boolean }).ok).toBe(true);
    expect(server.world.empires['emp0'].researchSliders).toEqual({ physics: 80, economics: 20 });
    c.close();
  });

  it('rejects commands before joining and against another empire', async () => {
    const { server, port } = await makeServer();
    const a = await connect(port);
    await a.next((m) => m.type === 'welcome');
    a.send({ type: 'command', name: 'set_research', args: {} });
    const noJoin = await a.next((m) => m.type === 'ack');
    expect((noJoin as { ok: boolean }).ok).toBe(false);

    a.send({ type: 'join' });
    await a.next((m) => m.type === 'welcome' && (m as { empireId?: string }).empireId != null);

    const b = await connect(port);
    await b.next((m) => m.type === 'welcome');
    b.send({ type: 'join' });
    const bJoin = await b.next((m) => m.type === 'welcome' && (m as { empireId?: string }).empireId != null);
    expect((bJoin as { empireId: string }).empireId).toBe('emp1');

    const emp0Colony = server.world.empires['emp0'].colonyIds[0];
    b.send({ type: 'command', name: 'set_governor', args: { colonyId: emp0Colony, plan: 'industry' } });
    const crossAck = await b.next((m) => m.type === 'ack' && (m as { name: string }).name === 'set_governor');
    expect((crossAck as { ok: boolean }).ok).toBe(false);
    a.close();
    b.close();
  });

  it('an unknown command is rejected', async () => {
    const { port } = await makeServer();
    const c = await connect(port);
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'join' });
    await c.next((m) => m.type === 'welcome' && (m as { empireId?: string }).empireId != null);
    c.send({ type: 'command', name: 'nuke_from_orbit', args: {} });
    const ack = await c.next((m) => m.type === 'ack');
    expect((ack as { ok: boolean; message: string }).ok).toBe(false);
    c.close();
  });

  it('persists and reloads the authoritative world', async () => {
    const mem = new MemoryPersistence();
    const { server: s1 } = await makeServer(mem, 3);
    s1.tickOnce();
    s1.tickOnce();
    await s1.stop();
    servers.pop(); // already stopped
    const hash1 = worldHash(s1.world);

    const s2 = new GameServer({ data, resolver, persistence: mem, autoTick: false });
    servers.push(s2);
    await s2.start(0);
    expect(worldHash(s2.world)).toBe(hash1);
  });

  it('serves REST health', async () => {
    const { port } = await makeServer();
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; empires: number };
    expect(body.ok).toBe(true);
    expect(body.empires).toBe(4);
  });
});
