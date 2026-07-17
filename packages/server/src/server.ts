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
import { AccountStore, publicAccount, REFRESH_TTL_MS } from './auth.js';
import { MemoryPersistence, type Persistence } from './persistence.js';
import type { ClientMessage, EmpireInfo, GalaxyDto, MineView, Ownership, ServerMessage, Society } from './protocol.js';

export interface GameServerOptions {
  data: WorldData;
  resolver: BattleResolver;
  persistence?: Persistence;
  /** When set, claiming an empire requires a valid session token and the
   *  empire is bound to the account. Omit for the legacy tokenless mode. */
  accounts?: AccountStore;
  /** HTTP-only refresh-cookie policy. Defaults are production-safe (Secure,
   *  SameSite=Lax, scoped to /auth); a dev server over plain HTTP sets
   *  secure:false so the browser will actually store the cookie. */
  authCookie?: { name?: string; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string; domain?: string };
  /** Allowed browser origins for credentialed CORS. Omit to reflect any
   *  origin (fine behind a same-origin proxy; set an allowlist in prod). */
  corsOrigins?: string[];
  seed?: number;
  races?: string[];
  tickIntervalMs?: number;
  autoTick?: boolean;
  autosaveEveryTicks?: number;
}

interface CookieConfig {
  name: string;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  path: string;
  domain?: string;
}

interface ClientState {
  empireId: string | null;
  accountId: string | null;
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
  private readonly accounts: AccountStore | null;
  private readonly cookie: CookieConfig;
  private readonly corsOrigins: string[] | null;
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
    this.accounts = options.accounts ?? null;
    this.cookie = {
      name: options.authCookie?.name ?? 'pg_refresh',
      secure: options.authCookie?.secure ?? true,
      sameSite: options.authCookie?.sameSite ?? 'Lax',
      path: options.authCookie?.path ?? '/auth',
      domain: options.authCookie?.domain,
    };
    this.corsOrigins = options.corsOrigins ?? null;
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
    this.httpServer = http.createServer((req, res) => {
      this.handleRest(req, res).catch(() => {
        if (!res.headersSent) res.statusCode = 500;
        res.end(JSON.stringify({ error: 'internal error' }));
      });
    });
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
    const state: ClientState = { empireId: null, accountId: null, tokens: RATE_CAP, lastRefill: Date.now() };
    this.clients.set(ws, state);
    ws.on('message', (raw) => this.handleMessage(ws, state, raw));
    ws.on('close', () => {
      // In accounts mode the empire stays bound to the account; only the
      // legacy tokenless claim is released on disconnect.
      if (!this.accounts && state.empireId) this.claimed.delete(state.empireId);
      this.clients.delete(ws);
    });
    this.send(ws, {
      type: 'welcome',
      empireId: null,
      username: null,
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
      let empireId: string | null;
      let username: string | null = null;
      if (this.accounts) {
        // Accounts mode: a valid token is required to control an empire;
        // anyone else joins as a read-only spectator.
        const account = this.accounts.validateToken(msg.token);
        if (account) {
          state.accountId = account.id;
          username = account.username;
          empireId = this.assignEmpireForAccount(account.id);
        } else {
          state.accountId = null;
          empireId = null;
        }
      } else {
        empireId = this.claimEmpire(msg.empireId);
      }
      state.empireId = empireId;
      this.send(ws, {
        type: 'welcome',
        empireId,
        username,
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

  private isPlayableEmpire(id: string): boolean {
    const e = this.world.empires[id];
    return !!e && !e.pirate && !e.ancient;
  }

  /** Resolve the empire an account controls, assigning a free one on first join
   *  and persisting the binding so it is theirs on every future connection. */
  private assignEmpireForAccount(accountId: string): string | null {
    const store = this.accounts!;
    const bound = store.get(accountId)?.empireId ?? null;
    if (bound && this.isPlayableEmpire(bound)) return bound;
    const taken = store.boundEmpires();
    for (const id of Object.keys(this.world.empires).sort()) {
      if (taken.has(id) || !this.isPlayableEmpire(id)) continue;
      store.bindEmpire(accountId, id);
      return id;
    }
    return null; // galaxy full — spectate for now
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

  private async handleRest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.applyCors(req, res);
    res.setHeader('Content-Type', 'application/json');
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url === '/health') {
      res.end(
        JSON.stringify({
          ok: true,
          tick: this.world.time,
          season: this.world.season.number,
          players: this.accounts ? [...this.accounts.boundEmpires()] : [...this.claimed],
          accounts: this.accounts ? this.accounts.size : undefined,
          empires: Object.keys(this.world.empires).filter((id) => this.isPlayableEmpire(id)).length,
        }),
      );
      return;
    }
    if (url === '/state') {
      res.end(JSON.stringify(spectateSnapshot(this.world, this.data)));
      return;
    }

    // --- Auth (only when an account store is configured) ---
    if (this.accounts && method === 'POST' && (url === '/auth/register' || url === '/auth/login')) {
      let creds: { username?: string; password?: string };
      try {
        creds = JSON.parse((await this.readBody(req)) || '{}') as { username?: string; password?: string };
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
        return;
      }
      const result =
        url === '/auth/register'
          ? await this.accounts.register(creds.username ?? '', creds.password ?? '')
          : this.accounts.login(creds.username ?? '', creds.password ?? '');
      if (!result.ok || !result.account) {
        res.statusCode = url === '/auth/register' ? 409 : 401;
        res.end(JSON.stringify({ ok: false, error: result.error }));
        return;
      }
      // Long-lived refresh token → HTTP-only cookie; short-lived access token
      // → response body (the client keeps it in memory only).
      this.setRefreshCookie(res, await this.accounts.issueRefresh(result.account.id));
      res.end(JSON.stringify({ ok: true, accessToken: result.token, account: publicAccount(result.account) }));
      return;
    }

    // Silent session resume: rotate the refresh cookie, mint a fresh access token.
    if (this.accounts && method === 'POST' && url === '/auth/refresh') {
      const raw = this.parseCookies(req)[this.cookie.name];
      const r = await this.accounts.rotateRefresh(raw);
      if (!r.ok || !r.accountId) {
        this.clearRefreshCookie(res); // drop a stale/compromised cookie
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: r.reuse ? 'session revoked' : 'not authenticated' }));
        return;
      }
      this.setRefreshCookie(res, r.refresh!);
      const account = this.accounts.get(r.accountId);
      res.end(JSON.stringify({ ok: true, accessToken: r.token, account: account ? publicAccount(account) : null }));
      return;
    }

    if (this.accounts && method === 'POST' && url === '/auth/logout') {
      await this.accounts.revokeRefresh(this.parseCookies(req)[this.cookie.name]);
      this.clearRefreshCookie(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  }

  // --- CORS + cookies ----------------------------------------------------

  private applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && (!this.corsOrigins || this.corsOrigins.includes(origin))) {
      // Credentialed CORS can't use "*": echo the (allowed) origin instead.
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else if (!origin) {
      res.setHeader('Access-Control-Allow-Origin', '*'); // non-browser callers (health checks)
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private parseCookies(req: http.IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = req.headers.cookie;
    if (typeof raw === 'string') {
      for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      }
    }
    return out;
  }

  private setRefreshCookie(res: http.ServerResponse, value: string): void {
    res.setHeader('Set-Cookie', this.cookieString(value, REFRESH_TTL_MS / 1000));
  }
  private clearRefreshCookie(res: http.ServerResponse): void {
    res.setHeader('Set-Cookie', this.cookieString('', 0));
  }
  private cookieString(value: string, maxAgeSec: number): string {
    const c = this.cookie;
    const parts = [
      `${c.name}=${encodeURIComponent(value)}`,
      `Path=${c.path}`,
      `Max-Age=${Math.floor(maxAgeSec)}`,
      'HttpOnly',
      `SameSite=${c.sameSite}`,
    ];
    if (c.secure) parts.push('Secure');
    if (c.domain) parts.push(`Domain=${c.domain}`);
    return parts.join('; ');
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(''));
    });
  }
}
