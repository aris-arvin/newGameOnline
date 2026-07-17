/**
 * Authoritative multiplayer game server (design prompt §2.1, §18.2, §18.4).
 *
 * A single authoritative WorldState is advanced by the deterministic tick on a
 * fixed cadence; clients connect over WebSocket, claim an empire, and send
 * validated commands. After each tick the server streams a public snapshot to
 * everyone plus a private "mine" view to each owning connection. REST exposes
 * health and the public state. Persistence is pluggable. The world never leaves
 * the server — clients only render what they are sent.
 */
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createWorld, tick, startNextSeason, spectateSnapshot } from '@pure-galaxy/world-core';
import type { BattleResolver, WorldData, WorldState } from '@pure-galaxy/world-core';
import { COMMANDS } from './commands.js';
import { MemoryPersistence, type Persistence } from './persistence.js';
import type { ClientMessage, EmpireInfo, GalaxyDto, MineView, Ownership, ServerMessage, Society } from './protocol.js';

export interface GameServerOptions {
  data: WorldData;
  resolver: BattleResolver;
  persistence?: Persistence;
  seed?: number;
  races?: string[];
  tickIntervalMs?: number;
  autoTick?: boolean;
  autosaveEveryTicks?: number;
}

interface ClientState {
  empireId: string | null;
  tokens: number;
  lastRefill: number;
}

const RATE_CAP = 20;
const RATE_PER_SEC = 5;

export class GameServer {
  world: WorldState;
  private readonly data: WorldData;
  private readonly resolver: BattleResolver;
  private readonly persistence: Persistence;
  private readonly opts: Required<Pick<GameServerOptions, 'tickIntervalMs' | 'autoTick' | 'autosaveEveryTicks'>>;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly claimed = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticksSinceSave = 0;
  private galaxyCache: { token: number; dto: GalaxyDto } | null = null;

  constructor(options: GameServerOptions) {
    this.data = options.data;
    this.resolver = options.resolver;
    this.persistence = options.persistence ?? new MemoryPersistence();
    this.opts = {
      tickIntervalMs: options.tickIntervalMs ?? 2000,
      autoTick: options.autoTick ?? true,
      autosaveEveryTicks: options.autosaveEveryTicks ?? 10,
    };
    const loaded = this.persistence.load();
    this.world =
      loaded ??
      createWorld(options.seed ?? 7, this.data, {
        races: options.races ?? ['sol', 'reptiloid', 'tumali', 'gerber'],
        galaxy: { sectors: 6, systemsPerSector: 5, laneNeighbors: 3 },
      });
  }

  /** Start listening. Returns the bound port (use 0 for an ephemeral one). */
  start(port = 0): Promise<number> {
    this.httpServer = http.createServer((req, res) => this.handleRest(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    return new Promise((resolve) => {
      this.httpServer!.listen(port, () => {
        if (this.opts.autoTick) {
          this.timer = setInterval(() => this.tickOnce(), this.opts.tickIntervalMs);
        }
        resolve((this.httpServer!.address() as AddressInfo).port);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persistence.save(this.world);
    for (const ws of this.clients.keys()) ws.close();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.httpServer ? this.httpServer.close(() => r()) : r()));
  }

  /** Advance the authoritative world one tick and stream updates. */
  tickOnce(): void {
    const before = this.world.log.length;
    tick(this.world, this.data, this.resolver);
    const newEvents = this.world.log.slice(before);

    if (++this.ticksSinceSave >= this.opts.autosaveEveryTicks) {
      this.persistence.save(this.world);
      this.ticksSinceSave = 0;
    }

    for (const e of newEvents) {
      if (['battle', 'victory', 'senate', 'ancients', 'season', 'invasion'].includes(e.kind)) {
        this.broadcastMessage({ type: 'event', time: e.time, kind: e.kind, text: e.text });
      }
    }

    // Season rollover: soft restart, keeping players on their empires (§15).
    if (this.world.season.status === 'ended') {
      this.world = startNextSeason(this.world, this.data);
      this.persistence.save(this.world);
      this.broadcastMessage({ type: 'lobby', galaxy: this.galaxyDto(), empires: this.empireRoster() });
      this.broadcastMessage({ type: 'event', time: this.world.time, kind: 'season', text: `Season ${this.world.season.number} begins` });
    }

    this.broadcastSnapshots();
  }

  // --- WebSocket ---------------------------------------------------------

  private handleConnection(ws: WebSocket): void {
    const state: ClientState = { empireId: null, tokens: RATE_CAP, lastRefill: Date.now() };
    this.clients.set(ws, state);
    ws.on('message', (raw) => this.handleMessage(ws, state, raw));
    ws.on('close', () => {
      if (state.empireId) this.claimed.delete(state.empireId);
      this.clients.delete(ws);
    });
    this.send(ws, {
      type: 'welcome',
      empireId: null,
      tick: this.world.time,
      season: this.world.season.number,
      public: spectateSnapshot(this.world, this.data),
      mine: null,
      galaxy: this.galaxyDto(),
      empires: this.empireRoster(),
      ownership: this.ownership(),
      society: this.society(),
    });
  }

  private handleMessage(ws: WebSocket, state: ClientState, raw: RawData): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      this.send(ws, { type: 'error', message: 'invalid JSON' });
      return;
    }

    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong' });
      return;
    }

    // Rate limit intent messages.
    const now = Date.now();
    state.tokens = Math.min(RATE_CAP, state.tokens + ((now - state.lastRefill) / 1000) * RATE_PER_SEC);
    state.lastRefill = now;
    if (state.tokens < 1) {
      this.send(ws, { type: 'error', message: 'rate limited' });
      return;
    }
    state.tokens -= 1;

    if (msg.type === 'join') {
      const empireId = this.claimEmpire(msg.empireId);
      state.empireId = empireId;
      this.send(ws, {
        type: 'welcome',
        empireId,
        tick: this.world.time,
        season: this.world.season.number,
        public: spectateSnapshot(this.world, this.data),
        mine: empireId ? this.myView(empireId) : null,
        galaxy: this.galaxyDto(),
        empires: this.empireRoster(),
        ownership: this.ownership(),
        society: this.society(),
      });
      return;
    }

    if (msg.type === 'command') {
      if (!state.empireId) {
        this.send(ws, { type: 'ack', name: msg.name, ok: false, message: 'join an empire first' });
        return;
      }
      const handler = COMMANDS[msg.name];
      if (!handler) {
        this.send(ws, { type: 'ack', name: msg.name, ok: false, message: 'unknown command' });
        return;
      }
      const result = handler({ world: this.world, data: this.data, empireId: state.empireId, args: msg.args ?? {} });
      this.send(ws, { type: 'ack', name: msg.name, ok: result.ok, message: result.message });
      // Reflect the mutation immediately for the acting player.
      this.send(ws, {
        type: 'snapshot',
        tick: this.world.time,
        public: spectateSnapshot(this.world, this.data),
        mine: this.myView(state.empireId),
        ownership: this.ownership(),
        society: this.society(),
      });
    }
  }

  private claimEmpire(requested?: string): string | null {
    const free = (id: string): boolean =>
      !this.claimed.has(id) && !!this.world.empires[id] && !this.world.empires[id].pirate && !this.world.empires[id].ancient;
    if (requested && free(requested)) {
      this.claimed.add(requested);
      return requested;
    }
    for (const id of Object.keys(this.world.empires).sort()) {
      if (free(id)) {
        this.claimed.add(id);
        return id;
      }
    }
    return null; // spectator
  }

  /** Public galaxy structure, cached per season (it only changes on restart). */
  private galaxyDto(): GalaxyDto {
    if (this.galaxyCache && this.galaxyCache.token === this.world.season.number) return this.galaxyCache.dto;
    const g = this.world.galaxy;
    const systems = Object.values(g.systems).map((s) => ({
      id: s.id,
      name: s.name,
      sectorId: s.sectorId,
      x: s.x,
      y: s.y,
      planets: s.planetIds.map((pid) => {
        const p = g.planets[pid];
        return { id: p.id, name: p.name, biome: p.biome, gravity: p.gravity, size: p.size, richness: p.richness, belt: p.belt, ruins: p.ruins };
      }),
    }));
    const seen = new Set<string>();
    const lanes: { from: string; to: string }[] = [];
    for (const [from, ls] of Object.entries(g.lanes)) {
      for (const lane of ls) {
        const key = from < lane.to ? `${from}|${lane.to}` : `${lane.to}|${from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lanes.push({ from, to: lane.to });
      }
    }
    const dto: GalaxyDto = { systems, lanes };
    this.galaxyCache = { token: this.world.season.number, dto };
    return dto;
  }

  private empireRoster(): EmpireInfo[] {
    return Object.keys(this.world.empires)
      .filter((id) => !this.world.empires[id].pirate && !this.world.empires[id].ancient)
      .sort()
      .map((id) => ({ id, name: this.world.empires[id].name }));
  }

  private ownership(): Ownership {
    const m: Ownership = {};
    for (const c of Object.values(this.world.colonies)) {
      const sys = this.world.galaxy.planets[c.planetId]?.systemId;
      if (sys && !(sys in m)) m[sys] = c.empireId;
    }
    return m;
  }

  private society(): Society {
    return {
      treaties: this.world.treaties.length,
      agents: Object.keys(this.world.agents).length,
      admirals: Object.keys(this.world.admirals).length,
    };
  }

  private myView(empireId: string): MineView {
    const e = this.world.empires[empireId];
    return {
      empireId,
      name: e.name,
      credits: e.credits,
      focus: e.focus,
      research: e.research,
      researchSliders: e.researchSliders,
      unlockedTechs: e.unlockedTechs,
      treasury: e.treasury,
      colonies: e.colonyIds
        .map((cid) => this.world.colonies[cid])
        .filter(Boolean)
        .map((c) => ({
          id: c.id,
          planet: this.world.galaxy.planets[c.planetId]?.name ?? c.planetId,
          population: c.population,
          governor: c.governor,
          regions: c.regions.map((r) => ({ spec: r.spec, level: r.level })),
        })),
      fleets: e.fleetIds
        .map((fid) => this.world.fleets[fid])
        .filter(Boolean)
        .map((f) => ({ id: f.id, systemId: f.systemId, ships: f.ships.length, order: f.order?.type ?? null })),
      agents: Object.values(this.world.agents).filter((a) => a.empireId === empireId).length,
      admirals: e.admiralIds.length,
      expeditionsDone: e.expeditionsDone,
    };
  }

  private broadcastSnapshots(): void {
    const pub = spectateSnapshot(this.world, this.data);
    const own = this.ownership();
    const soc = this.society();
    for (const [ws, state] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      this.send(ws, {
        type: 'snapshot',
        tick: this.world.time,
        public: pub,
        mine: state.empireId ? this.myView(state.empireId) : null,
        ownership: own,
        society: soc,
      });
    }
  }

  private broadcastMessage(msg: ServerMessage): void {
    for (const ws of this.clients.keys()) if (ws.readyState === WebSocket.OPEN) this.send(ws, msg);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    ws.send(JSON.stringify(msg));
  }

  // --- REST --------------------------------------------------------------

  private handleRest(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    const url = req.url ?? '/';
    if (url === '/health') {
      res.end(
        JSON.stringify({
          ok: true,
          tick: this.world.time,
          season: this.world.season.number,
          players: [...this.claimed],
          empires: Object.keys(this.world.empires).filter((id) => !this.world.empires[id].pirate && !this.world.empires[id].ancient).length,
        }),
      );
      return;
    }
    if (url === '/state') {
      res.end(JSON.stringify(spectateSnapshot(this.world, this.data)));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  }
}
