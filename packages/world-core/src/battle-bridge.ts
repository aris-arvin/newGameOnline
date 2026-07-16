/**
 * World <-> combat bridge (the "сшивка"). When hostile fleets meet in a system,
 * this resolver hands the engagement to the tactical WEGO engine in
 * @pure-galaxy/combat-core instead of the Phase-0 aggregate roll: world ships
 * are mapped to combat blueprints, a deterministic battle is fought, and the
 * per-ship casualties are written back to the world fleets — so both sides can
 * take real, uneven losses. Oversized battles fall back to the quick resolve.
 *
 * The combat catalog/blueprints are INJECTED (not loaded here) so this module
 * stays free of any filesystem dependency and runs in the browser as well as on
 * the server (design prompt §18.3). Node callers use `./node` to build one from
 * the JSON data; the browser builds one from imported JSON.
 */
import { runBattle } from '@pure-galaxy/combat-core';
import type { Blueprint, Catalog, FleetShip, Side as CombatSide } from '@pure-galaxy/combat-core';
import type { Fleet, Ship, WorldData, WorldState } from './types.js';
import { fleetPower, quickResolveSystemBattle, removeFleet, type BattleResolver } from './fleet.js';
import { admiralForFleet } from './admiral.js';

export type BlueprintLibrary = Map<string, Blueprint>;

function powerTier(power: number): 0 | 1 | 2 | 3 {
  if (power < 15) return 0;
  if (power < 40) return 1;
  if (power < 80) return 2;
  return 3;
}

function pickBlueprint(ship: Ship, bump: boolean, data: WorldData, blueprints: BlueprintLibrary): Blueprint {
  if (ship.design && blueprints.has(ship.design)) return blueprints.get(ship.design)!;
  const ref = data.combat.referenceBlueprints;
  if (ship.role !== 'warship') return blueprints.get(ref.corvette)!;
  const tiers = [ref.corvette, ref.frigate, ref.destroyer, ref.cruiser];
  let tier = powerTier(ship.power);
  if (bump) tier = Math.min(3, tier + 1) as 0 | 1 | 2 | 3;
  return blueprints.get(tiers[tier])!;
}

function doctrineFor(bp: Blueprint): string {
  if (bp.id.includes('missile')) return 'gunline';
  if (bp.id.includes('kinetic') || bp.id.includes('cruiser')) return 'brawler';
  return 'balanced';
}

function buildSide(sideId: string, fleets: Fleet[], world: WorldState, data: WorldData, blueprints: BlueprintLibrary): CombatSide {
  const ships: FleetShip[] = [];
  for (const fleet of fleets) {
    const admiral = admiralForFleet(world, fleet.id);
    fleet.ships.forEach((s, idx) => {
      const isFlag = !!admiral && idx === 0;
      const bp = pickBlueprint(s, isFlag, data, blueprints);
      ships.push({ id: `${fleet.id}#${idx}`, blueprint: bp, doctrineId: doctrineFor(bp), isFlagship: isFlag });
    });
  }
  return { id: sideId, name: sideId, ships };
}

function hashStr(seed: number, s: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** Deterministic battle seed from the world state and the participating fleets. */
function battleSeed(world: WorldState, fleets: Fleet[]): number {
  let h = (world.seed ^ Math.imul(world.time + 1, 0x9e3779b1)) >>> 0;
  for (const id of fleets.map((f) => f.id).sort()) h = hashStr(h, id);
  return h >>> 0;
}

/** Split the co-located hostile fleets into two sides: strongest empire vs. the rest. */
function splitSides(world: WorldState, fleets: Fleet[]): { a: Fleet[]; b: Fleet[]; aEmpire: string } {
  const power: Record<string, number> = {};
  for (const f of fleets) power[f.empireId] = (power[f.empireId] ?? 0) + fleetPower(f);
  let aEmpire = fleets[0].empireId;
  for (const [id, p] of Object.entries(power)) {
    if (p > power[aEmpire] || (p === power[aEmpire] && id < aEmpire)) aEmpire = id;
  }
  const a = fleets.filter((f) => f.empireId === aEmpire);
  const b = fleets.filter((f) => f.empireId !== aEmpire);
  return { a, b, aEmpire };
}

/**
 * Build a tactical BattleResolver from a combat catalog + blueprint library.
 * The returned resolver replaces the quick aggregate resolve.
 */
export function createTacticalResolver(catalog: Catalog, blueprints: BlueprintLibrary): BattleResolver {
  return (world, data, fleets, rng, events) => {
    if (!data.combat.tactical) {
      quickResolveSystemBattle(world, data, fleets, rng, events);
      return;
    }
    const { a, b, aEmpire } = splitSides(world, fleets);
    const shipsA = a.reduce((n, f) => n + f.ships.length, 0);
    const shipsB = b.reduce((n, f) => n + f.ships.length, 0);
    if (shipsA === 0 || shipsB === 0 || shipsA > data.combat.maxShipsPerSide || shipsB > data.combat.maxShipsPerSide) {
      quickResolveSystemBattle(world, data, fleets, rng, events);
      return;
    }

    const sideA = buildSide('A', a, world, data, blueprints);
    const sideB = buildSide('B', b, world, data, blueprints);
    const result = runBattle([sideA, sideB], catalog, { seed: battleSeed(world, fleets) }, {});

    const dead = new Set(result.ships.filter((s) => !s.alive).map((s) => s.id));
    for (const fleet of [...a, ...b]) {
      for (let idx = fleet.ships.length - 1; idx >= 0; idx--) {
        if (dead.has(`${fleet.id}#${idx}`)) fleet.ships.splice(idx, 1);
      }
      if (fleet.ships.length === 0) removeFleet(world, fleet);
    }

    const winnerEmpire = result.winner === 'A' ? aEmpire : result.winner === 'B' ? (b[0]?.empireId ?? '') : '';
    const winnerName = winnerEmpire ? world.empires[winnerEmpire]?.name ?? winnerEmpire : 'stalemate';
    const sysName = world.galaxy.systems[fleets[0].systemId]?.name ?? fleets[0].systemId;
    events.push({
      time: world.time,
      kind: 'battle',
      text: `Tactical battle at ${sysName}: ${winnerName} prevails (${result.rounds} rounds, lost ${dead.size} ships)`,
    });
  };
}
