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
packages/combat-core/       Deterministic tactical combat engine (Phase 1 priority, §21.2).
```

Development follows the roadmap in `GAME_PROMPT.md` §20. Per §21.2 the first
buildable slice is the **deterministic WEGO combat core** — the game's core
competitive advantage (§0.3) — so that is what lives here first.

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

### Requirements

Node 20+ and `pnpm`.

### Setup

```bash
pnpm install
```

### Run the tests (determinism, geometry, blueprints, battle outcomes)

```bash
pnpm test
```

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

## Status

This is the Phase-1 combat prototype. The economy/world simulation (Phase 0),
client, and the rest of the systems in `GAME_PROMPT.md` are not built yet.
