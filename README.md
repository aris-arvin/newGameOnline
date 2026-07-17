# PURE GALAXY

A browser MMO 4X space strategy: the playability of **Star Federation**
(persistent world, deep economy, free ship builder, races, level-less science,
total trade, espionage, archaeology) crossed with the empire scale and politics
of **Master of Orion 3** (habitability, regional planet development, governors,
six science schools, task forces, a Galactic Senate, seasonal victories) — and a
brand-new **tactical hex WEGO combat system** as the headline feature.

The full design brief is [`GAME_PROMPT.md`](./GAME_PROMPT.md).

## Repository layout

```
GAME_PROMPT.md              The complete design document (RU).
packages/shared/            Deterministic primitives shared by all sims (PRNG, stable hashing).
packages/combat-core/       Deterministic tactical WEGO combat engine (Phase 1, §21.2).
packages/world-core/        Deterministic world simulation: galaxy, economy, society,
                            politics, seasons — and the world<->combat bridge (Phases 0-4).
packages/server/            Authoritative multiplayer server: WebSocket state streaming +
                            REST, deterministic tick loop, pluggable persistence.
apps/web/                   React + Vite web client (vertical slice) running the engines
                            live in the browser: galaxy map, empire dashboard, ship lab.
```

`world-core` depends on `combat-core`: when hostile fleets meet, the engagement
is fought by the tactical engine (the "сшивка"), not an abstract roll.

Development follows the roadmap in `GAME_PROMPT.md` §20. Two vertical slices exist:

- **Phase 1 — combat** (`combat-core`): the game's core competitive advantage
  (§0.3), prioritised per §21.2.
- **Phase 0 — world core** (`world-core`): the persistent galaxy and the stable
  deterministic economic tick that everything else runs on.

Both are pure, server-authoritative, and fully deterministic — a simulation is a
function of `(inputs, seed)` and reproduces bit-for-bit from a state/event hash.

## Play it locally

Prerequisites: **Node 20+** and **pnpm**.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the authoritative server (`http` + `ws` on `:8787`) and the
Vite web client together, with prefixed logs and a clean Ctrl-C shutdown. Open
the URL Vite prints (usually <http://localhost:5173>), flip the top-right
toggle to **Live**, and **Register** a username — the server binds you an
empire that stays yours across reconnects and seasons (the refresh session
lives in an HTTP-only cookie, so a page reload silently resumes it). Then drive
it from the **My Empire** tab — research sliders, per-colony governors, and
colonize / expedition / recruit orders — and watch the shared galaxy tick
forward. Open a second browser or a private window and register again to play
a second empire in the **same** live world.

> Prefer two terminals? `pnpm serve` (server) and `pnpm web` (client) do the
> same thing separately. **Local** mode (the other toggle) still runs the whole
> simulation in your browser with no server at all.

Persistence defaults to JSON files under `packages/server/.data/` — no database
required. To back the same server with Postgres + Redis instead (accounts in
Postgres, refresh sessions in Redis, world checkpointed to Postgres):

```bash
docker compose -f packages/server/docker-compose.yml up -d
pnpm add --filter @pure-galaxy/server pg redis          # one-time: DB drivers
DATABASE_URL=postgres://pg:pg@localhost:5432/pure_galaxy \
REDIS_URL=redis://localhost:6379 \
  pnpm dev
```

Other scripts:

```bash
pnpm test          # every package: shared + combat-core + world-core + server
pnpm typecheck
pnpm build         # production web bundle (dist/)
```

## `@pure-galaxy/combat-core`

A dependency-free, server-authoritative, fully **deterministic** combat engine:
a battle is a pure function of `(fleets, seed)` and replays bit-for-bit from its
event log (design prompt §10.3, §10.12). It implements, at v1 scope:

- **Hex battlefield** with 6-way ship facing (§10.2).
- **WEGO rounds** — a planning phase (doctrine-driven orders) then a resolution
  phase of 10 impulses that interleave movement and fire in initiative order, so
  fast ships reposition before slow guns bear (§10.3).
- **Damage model**: shields per 4 sectors → armour per facing → structure, with
  subsystem crits, heat, and morale (§10.4, §10.7).
- **Rock-paper-scissors**: kinetic / beam / missile weapons vs plated / ablative /
  composite armour and shields, plus point-defense vs missiles (§10.6).
- **Doctrines**: rule-based ship autopilot that fights on behalf of an offline
  player — the key asynchronous-MMO mechanic (§2.2, §10.8).
- **Data-driven balance**: every hull, component, weapon and blueprint lives in
  `packages/combat-core/data/*.json` (§21.3).

### Watch a battle

```bash
pnpm autobattle -- --scenario demo --seed 7            # summary + log hash
pnpm autobattle -- --scenario duel --seed 3 --verbose  # full event log
```

Scenarios: `demo` (escort screen vs missile wing), `duel` (kinetic vs beam
frigate), `brawl` (4v4 mirror).

### Run the balance meta-simulator (§18.6)

```bash
pnpm meta -- --runs 500
```

Prints a weapon×armour rounds-to-kill matrix and squadron-scale win-rates — the
harness a shipped game runs in CI on every balance change.

## `@pure-galaxy/world-core`

The Phase-0 persistent-world simulation (design prompt §20 acceptance: a **stable
economic tick**). Deterministic, integer-only, no filesystem in the core:

- **Procedural galaxy** (§3): sectors → systems → planets (biome, gravity, size,
  richness, asteroid belts, ruins) with a connected hyperlane graph.
- **Colonies & regions** (§6): planet habitability = f(biome, gravity, race);
  regions carry a specialization + level with cluster synergy.
- **Five resource groups → materials** (§5): mining/farming/extraction feed
  production recipes (alloys, fuel, electronics, composites) and construction.
- **Population** with food-driven growth and starvation; **energy** and staffing
  throttles.
- **Science** (§7): two schools with milestone tech unlocks and empire-wide
  bonuses. **Governors** (§6.4) auto-develop colonies for offline players.
  **Imperial focus** regen (§6.5).
- **Fleets** with hyperlane travel, **colonization**, and a Phase-0 **non-tactical
  auto-battle** (§20) — distinct from the tactical engine in `combat-core`.

### The society layer (Phase 2, §11–§16)

`world-core` also carries the Phase-2 "Общество" systems, all wired into the
same deterministic tick:

- **Diplomacy** (§11): eight treaty types, relations, gradual AI diplomacy;
  allied empires don't auto-battle and `research_exchange` speeds research (a
  bonus, not full tech sharing — the SF imbalance fix).
- **Market** (§16): colonies ship surplus to an empire treasury; a pure bid/ask
  **matching engine** plus a "Federation" NPC market-maker set prices that drift
  with supply. Production asymmetry between races creates real trade.
- **Convoys & piracy** (§5.4, §14.4): cargo convoys between colonies; a pirate
  faction hunts unprotected convoys.
- **Espionage** (§12): agents run recon / sabotage / steal-tech missions against
  counter-intelligence.
- **Newbie protection** (§14.1): young/weak empires are shielded from attack and
  piracy until they cross a rating or the grace period ends.

### Politics & PvE (Phase 3, §11.3, §13, §15)

The same tick also runs the Phase-3 systems:

- **Galactic Senate** (§11.3): representation by senate weight (economy +
  population + reputation — *not* military), sessions that pass resolutions
  (galactic tax/subsidy, sanctions/embargo, expedition funding), and a president
  elected each term; proposing costs imperial focus.
- **The Ancients & archaeology** (§13): a powerful NPC faction launches
  escalating raids resolved against colony defense; ruins are excavated into
  artifacts and Ancient devices.
- **Gate expeditions** (§13): a PvE race of five escalating expeditions.
- **Admirals** (§9): officers recruited, assigned to fleets for a combat bonus,
  and lost with their fleet.
- **Ground invasions** (§10.10): capture an unprotected enemy colony after
  orbital dominance; the colony keeps its buildings but suffers unrest.
- **Season victory** (§15): four equal paths — **military** (sector control),
  **diplomatic** (two-term presidency), **science** (all Gate expeditions), and
  **economic** (sustained trade-share lead).

### Seasons, Legacy & polish (Phase 4, §15, §19)

- **Seasons & Legacy** (§15): a season ends on any victory or on timeout; the
  ceremony awards Legacy points and titles, then a **soft restart** spins up a
  fresh galaxy that carries Legacy forward as a capped **±5% head start** —
  solving the browser-MMO problems of a stagnant world and unreachable veterans.
- **Honest-F2P monetization** (§19): an entitlement catalog restricted to
  quality-of-life, cosmetics and a season pass, guarded by `auditCatalog` — a
  machine-checkable invariant (tested) that forbids pay-to-win.
- **Spectator / mobile snapshot** (§10.11, §17): a compact public view of
  standings, the Senate, prices and the victor, excluding fog-of-war secrets.
- **Balance autobattler in CI** (§18.6): `.github/workflows/ci.yml` runs
  typecheck, tests, and a headless balance smoke on every push; combat RPS
  invariants (e.g. point-defense hard-counters missiles) are locked by tests.

### World ↔ combat bridge (the "сшивка")

When hostile fleets share a system, `world-core` hands the engagement to the
`combat-core` tactical engine instead of a power roll: each world ship is mapped
to a combat blueprint (by size tier, role, and any assigned admiral → flagship),
a deterministic WEGO battle is fought, and the **per-ship casualties are written
back** — so both sides can take real, uneven losses. Oversized battles fall back
to the quick aggregate resolve. It's injected as a `BattleResolver`, keeping the
world core decoupled from combat. The `worldsim` CLI prints a staged skirmish
demonstrating it.

### Run the world simulator

```bash
pnpm --filter @pure-galaxy/world-core run worldsim -- --seed 7 --ticks 200 --every 50
```

Generates a galaxy, seeds four empires (Солы / Рептилоиды / Тумали / Герберы)
plus pirate and Ancient factions, runs the full economy + society + politics
tick to a **season victory**, and prints a deterministic state hash proving the
run is reproducible.

## `@pure-galaxy/web` — the client (vertical slice)

A React + Vite app with a dark, layered UI (§17) that runs in two modes behind
one unified view-model — a **Local** sandbox that runs the **real, unmodified
engines in the browser** (no mock data, §18.3), and a **Live** mode that
authenticates and streams the shared world from the server. The tabs are the
same in both:

- **Galaxy** — an SVG map (systems, hyperlanes, colonies coloured by owner)
  with a system/planet inspector showing biome, size, richness and habitability.
- **Empires** — live standings, the Galactic Senate, Federation market prices,
  society counters and the season victory banner, from `spectateSnapshot`.
- **My Empire** (Live) — the command console: research sliders, per-colony
  governor plans, and colonize / expedition / recruit orders, each round-tripped
  through the server with an ack log.
- **Ship Lab** — an interactive ship builder with **live** `computeShipStats`
  and a 3-v-3 `runBattle` sparring result (winner, rounds, survivors, replay
  hash) — the deterministic WEGO engine, in the browser.

```bash
pnpm web                                    # dev server (proxies /auth → :8787)
pnpm build                                  # production build (dist/)
```

Making the client possible required the world core to be browser-safe: the
combat catalog is now injected into the battle bridge (no filesystem imports),
so the entire sim compiles into a ~70 KB gzipped bundle.

## `@pure-galaxy/server` — authoritative multiplayer

A Node service (plain `http` + `ws`, no framework) that makes the game
multiplayer while keeping the server the single source of truth (§2.1, §18.2,
§18.4):

- **Authoritative tick loop** — one world, advanced by the deterministic tick on
  a fixed cadence; clients never run the simulation, they only render what they
  are sent.
- **WebSocket streaming** — on each tick every client gets a public snapshot
  (no fog-of-war secrets), and each owning connection also gets a private "mine"
  view of its empire.
- **Accounts & sessions** (§18.4) — register / login with scrypt-hashed
  passwords; a short-lived HMAC **access token** (in the client's memory) plus
  a long-lived **refresh token** in an HTTP-only cookie, rotated on every use
  with stolen-token reuse detection. A `join` is token-gated and **binds an
  empire to the account**, so it's yours on every device and across seasons.
- **Validated commands** — ownership-checked commands (`set_research`,
  `set_governor`, `dispatch_expedition`, `recruit_admiral`, `colonize`) with
  per-connection rate limiting.
- **REST** — `GET /health`, `GET /state`, `POST /auth/{register,login,refresh,logout}`.
- **Pluggable persistence** — memory / file by default, or **Postgres**
  (world checkpoint + normalized account rows) and **Redis** (per-key refresh
  sessions with native TTL) behind driver interfaces, selected by
  `DATABASE_URL` / `REDIS_URL`; writes are coalesced write-behind so the tick
  loop never blocks on the database.
- **Season rollover** — on a victory or timeout the server soft-restarts into
  the next season, keeping players on their empires.

```bash
PORT=8787 TICK_MS=2000 pnpm --filter @pure-galaxy/server run serve
# then, in another shell:
URL=ws://localhost:8787 pnpm --filter @pure-galaxy/server run smoke
```

## Status

All five roadmap phases of simulation are built and tested (**120 tests**, CI-guarded),
the two engines are joined by the world↔combat bridge, an authoritative server
makes it multiplayer, and a browser client runs it live:

- **Phase 0 — world/economy tick** (`world-core`).
- **Phase 1 — tactical combat engine** (`combat-core`).
- **Phase 2 — society layer** (diplomacy, market, convoys/piracy, espionage,
  newbie protection).
- **Phase 3 — politics & PvE** (Galactic Senate & elections, the Ancients &
  raids, archaeology/artifacts, Gate expeditions, admirals, ground invasions,
  the four season-victory paths).
- **Phase 4 — polish** (seasons + Legacy soft restart, honest-F2P monetization
  invariant, spectator/mobile snapshot, balance autobattler in CI).

The **web client** (`apps/web`) is wired to the **authoritative server**
(`packages/server`): players register/log in (HTTP-only cookie sessions),
claim an account-bound empire, and issue commands against a shared world
streamed over WebSocket — all runnable locally with `pnpm dev`. Persistence
runs on files by default or on **Postgres + Redis** (§18.2). Still to come:
fleshing out the client (PixiJS battle replays, a doctrine editor,
planet/region management), CSRF hardening and rate-limiting the auth
endpoints, and horizontal battle/sector sharding (§18.2).
