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
packages/world-core/        Deterministic world simulation: galaxy, colonies, economy tick (Phase 0, §20).
```

Development follows the roadmap in `GAME_PROMPT.md` §20. Two vertical slices exist:

- **Phase 1 — combat** (`combat-core`): the game's core competitive advantage
  (§0.3), prioritised per §21.2.
- **Phase 0 — world core** (`world-core`): the persistent galaxy and the stable
  deterministic economic tick that everything else runs on.

Both are pure, server-authoritative, and fully deterministic — a simulation is a
function of `(inputs, seed)` and reproduces bit-for-bit from a state/event hash.

## Quick start

```bash
pnpm install
pnpm test          # all packages: shared + combat-core + world-core
pnpm typecheck
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

### Run the world simulator

```bash
pnpm --filter @pure-galaxy/world-core run worldsim -- --seed 7 --ticks 48 --every 12
```

Generates a galaxy, seeds four empires (Солы / Рептилоиды / Тумали / Герберы)
plus pirate and Ancient factions, runs the full economy + society + politics
tick to a **season victory**, and prints a deterministic state hash proving the
run is reproducible.

## Status

All five roadmap phases of simulation are built and tested (**84 tests**, CI-guarded):

- **Phase 0 — world/economy tick** (`world-core`).
- **Phase 1 — tactical combat engine** (`combat-core`).
- **Phase 2 — society layer** (diplomacy, market, convoys/piracy, espionage,
  newbie protection).
- **Phase 3 — politics & PvE** (Galactic Senate & elections, the Ancients &
  raids, archaeology/artifacts, Gate expeditions, admirals, ground invasions,
  the four season-victory paths).
- **Phase 4 — polish** (seasons + Legacy soft restart, honest-F2P monetization
  invariant, spectator/mobile snapshot, balance autobattler in CI).

Still to come: the **client/UI** (React + PixiJS: galaxy map, ship builder,
doctrine editor) and **networking/server**, plus connecting the world's fleets
into the tactical combat engine (replacing the Phase-0 auto-battle).
