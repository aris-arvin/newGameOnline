/**
 * Fleets, hyperlane travel, colonization, and the Phase-0 non-tactical
 * auto-resolve battle (design prompt §20 "автобой без тактики"). The rich
 * tactical WEGO engine lives in @pure-galaxy/combat-core (Phase 1); here a
 * system engagement is resolved by aggregate power with a deterministic roll.
 */
import { Rng } from '@pure-galaxy/shared';
import type { Fleet, Ship, WorldData, WorldEvent, WorldState } from './types.js';
import { MATERIAL_KINDS, RESOURCE_GROUPS } from './types.js';
import { laneDistance } from './galaxy.js';
import { createColony } from './colony.js';
import { areHostile } from './diplomacy.js';
import { isProtected } from './protection.js';
import { admiralBonus, killFleetAdmirals } from './admiral.js';

export function fleetPower(fleet: Fleet): number {
  let p = 0;
  for (const s of fleet.ships) p += s.power;
  return p;
}

/**
 * A battle resolver decides the fate of the (already filtered, mutually hostile)
 * fleets sharing a system. Injected so the core stays decoupled: the default is
 * the quick aggregate resolve; world.ts plugs in the tactical combat-core bridge.
 */
export type BattleResolver = (
  world: WorldState,
  data: WorldData,
  fleets: Fleet[],
  rng: Rng,
  events: WorldEvent[],
) => void;

/** Remove a fleet from the world (and kill its admirals). Exposed for resolvers. */
export function removeFleet(world: WorldState, fleet: Fleet): void {
  destroyFleet(world, fleet);
}

export function createFleet(world: WorldState, empireId: string, systemId: string, ships: Ship[]): Fleet {
  const id = `fl${world.nextId++}`;
  const fleet: Fleet = { id, empireId, systemId, ships };
  world.fleets[id] = fleet;
  world.empires[empireId]?.fleetIds.push(id);
  return fleet;
}

function destroyFleet(world: WorldState, fleet: Fleet): void {
  delete world.fleets[fleet.id];
  const empire = world.empires[fleet.empireId];
  if (empire) empire.fleetIds = empire.fleetIds.filter((f) => f !== fleet.id);
  killFleetAdmirals(world, fleet.id); // the admiral dies with the fleet (§9)
}

/** Integer ceiling of a/b for non-negative integers. */
function ceilDiv(a: number, b: number): number {
  return b <= 0 ? 0 : Math.floor((a + b - 1) / b);
}

export function fleetStep(
  world: WorldState,
  data: WorldData,
  rng: Rng,
  resolver: BattleResolver = quickResolveSystemBattle,
): WorldEvent[] {
  const events: WorldEvent[] = [];
  const speed = data.economy.fleetSpeed;

  for (const id of Object.keys(world.fleets).sort()) {
    const fleet = world.fleets[id];
    if (!fleet || !fleet.order) continue;
    const order = fleet.order;
    if (order.path.length === 0) {
      resolveArrival(world, fleet, events);
      continue;
    }
    order.legProgress += speed;
    const next = order.path[0];
    const dist = laneDistance(world.galaxy, fleet.systemId, next);
    if (order.legProgress >= dist) {
      fleet.systemId = next;
      order.path.shift();
      order.legProgress = 0;
      if (order.path.length === 0) resolveArrival(world, fleet, events);
    }
  }

  resolveBattles(world, data, rng, events, resolver);
  return events;
}

function resolveArrival(world: WorldState, fleet: Fleet, events: WorldEvent[]): void {
  const order = fleet.order;
  if (order && order.type === 'convoy' && fleet.cargo) {
    // Cargo reached its destination hub: deposit into the owner's treasury.
    const empire = world.empires[fleet.empireId];
    if (empire) {
      for (const k of [...RESOURCE_GROUPS, ...MATERIAL_KINDS]) empire.treasury[k] += fleet.cargo[k];
      events.push({ time: world.time, kind: 'convoy', text: `${empire.name} convoy delivered cargo` });
    }
    fleet.cargo = undefined;
    fleet.order = undefined;
    return;
  }
  if (order && order.type === 'colonize' && order.targetPlanetId) {
    const planet = world.galaxy.planets[order.targetPlanetId];
    const already = Object.values(world.colonies).some((c) => c.planetId === order.targetPlanetId);
    const hasColonyShip = fleet.ships.some((s) => s.role === 'colony');
    if (planet && planet.systemId === fleet.systemId && !already && hasColonyShip) {
      const empire = world.empires[fleet.empireId];
      const colonyId = `col${world.nextId++}`;
      const colony = createColony(colonyId, planet, fleet.empireId, 'balanced');
      world.colonies[colonyId] = colony;
      empire?.colonyIds.push(colonyId);
      // Consume one colony ship.
      const idx = fleet.ships.findIndex((s) => s.role === 'colony');
      if (idx >= 0) fleet.ships.splice(idx, 1);
      events.push({ time: world.time, kind: 'colonized', text: `${empire?.name ?? fleet.empireId} colonized ${planet.name}` });
      if (fleet.ships.length === 0) destroyFleet(world, fleet);
    }
  }
  if (fleet.order) fleet.order = undefined;
}

function resolveBattles(world: WorldState, data: WorldData, rng: Rng, events: WorldEvent[], resolver: BattleResolver): void {
  const bySystem: Record<string, Fleet[]> = {};
  for (const id of Object.keys(world.fleets).sort()) {
    const f = world.fleets[id];
    (bySystem[f.systemId] ??= []).push(f);
  }
  for (const sysId of Object.keys(bySystem).sort()) {
    const fleets = bySystem[sysId];
    const empires = [...new Set(fleets.map((f) => f.empireId))].sort();
    if (empires.length < 2) continue;

    // A battle needs two mutually hostile empires, neither under newbie
    // protection (§14.1) and not bound by a peace treaty (§11.1).
    const active = new Set<string>();
    for (let i = 0; i < empires.length; i++) {
      for (let j = i + 1; j < empires.length; j++) {
        const a = empires[i];
        const b = empires[j];
        if (!areHostile(world, a, b)) continue;
        if (isProtected(world, world.empires[a], data) || isProtected(world, world.empires[b], data)) continue;
        active.add(a);
        active.add(b);
      }
    }
    if (active.size < 2) continue;
    resolver(world, data, fleets.filter((f) => active.has(f.empireId)), rng, events);
  }
}

/** Quick aggregate resolution (Phase-0 non-tactical auto-battle, §20). */
export function quickResolveSystemBattle(world: WorldState, data: WorldData, fleets: Fleet[], rng: Rng, events: WorldEvent[]): void {
  const power: Record<string, number> = {};
  for (const f of fleets) power[f.empireId] = (power[f.empireId] ?? 0) + fleetPower(f) + admiralBonus(world, f.id, data);
  const emps = Object.keys(power).sort();

  let winner = emps[0];
  for (const e of emps) {
    if (power[e] > power[winner] || (power[e] === power[winner] && e < winner)) winner = e;
  }
  const winnerPower = power[winner];
  let loserPower = 0;
  for (const e of emps) if (e !== winner) loserPower += power[e];

  // Deterministic upset roll: an underdog can still win a close fight.
  const rollW = winnerPower * 100 + rng.int(winnerPower * 40 + 1);
  const rollL = loserPower * 100 + rng.int(loserPower * 40 + 1);
  let actualWinner = winner;
  if (rollL > rollW) {
    let best = '';
    let bestP = -1;
    for (const e of emps) {
      if (e !== winner && power[e] > bestP) {
        bestP = power[e];
        best = e;
      }
    }
    if (best) actualWinner = best;
  }

  // Destroy every fleet not belonging to the winner.
  const winnerName = world.empires[actualWinner]?.name ?? actualWinner;
  for (const f of [...fleets]) {
    if (f.empireId !== actualWinner) {
      destroyFleet(world, f);
    }
  }
  const winPow = power[actualWinner];
  const enemyPow = winnerPower + loserPower - winPow;

  // Winner takes casualties proportional to enemy strength (never fully wiped).
  const winnerFleets = fleets.filter((f) => f.empireId === actualWinner && world.fleets[f.id]);
  const totalShips = winnerFleets.reduce((a, f) => a + f.ships.length, 0);
  let toKill = Math.min(Math.max(0, totalShips - 1), ceilDiv(totalShips * enemyPow, winPow + enemyPow));
  for (const f of winnerFleets) {
    f.ships.sort((a, b) => a.power - b.power);
    while (toKill > 0 && f.ships.length > 0) {
      f.ships.shift();
      toKill--;
    }
  }

  events.push({
    time: world.time,
    kind: 'battle',
    text: `Battle at ${fleets[0].systemId}: ${winnerName} prevails`,
  });
}
