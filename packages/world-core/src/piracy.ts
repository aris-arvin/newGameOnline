/**
 * Convoys and piracy (design prompt §5.4, §14.4). Convoys are fleets carrying
 * cargo between colonies; a pirate NPC faction roams toward unprotected targets
 * and raids convoys (interception is resolved by the normal fleet auto-battle,
 * since pirates are hostile to everyone). Newbie-protected empires are immune.
 */
import { Rng } from '@pure-galaxy/shared';
import type { Stock, WorldData, WorldState } from './types.js';
import { createFleet } from './fleet.js';
import { findPath } from './galaxy.js';
import { makeStock } from './colony.js';
import { isProtected } from './protection.js';

export const PIRATE_EMPIRE = 'empPirate';

export function spawnPirates(world: WorldState, data: WorldData, count = 2, power = 26): void {
  if (world.empires[PIRATE_EMPIRE]) return;
  world.empires[PIRATE_EMPIRE] = {
    id: PIRATE_EMPIRE,
    name: 'Пираты',
    raceId: data.races[0].id,
    credits: 0,
    focus: 0,
    research: { physics: 0, economics: 0 },
    researchSliders: { physics: 50, economics: 50 },
    unlockedTechs: [],
    colonyIds: [],
    fleetIds: [],
    isNpc: true,
    treasury: makeStock(),
    foundedTick: world.time,
    relations: {},
    counterIntel: 0,
    pirate: true,
  };
  const systemIds = Object.keys(world.galaxy.systems).sort();
  for (let k = 0; k < count; k++) {
    const sys = systemIds[(k * 7 + 3) % systemIds.length];
    createFleet(world, PIRATE_EMPIRE, sys, [
      { role: 'warship', power },
      { role: 'warship', power: Math.max(5, power - 6) },
    ]);
  }
}

/** Dispatch a cargo convoy from one colony to another (§5.4). */
export function dispatchConvoy(
  world: WorldState,
  empireId: string,
  fromColonyId: string,
  toColonyId: string,
  cargo: Stock,
): string | null {
  const from = world.colonies[fromColonyId];
  const to = world.colonies[toColonyId];
  if (!from || !to) return null;
  const fromSys = world.galaxy.planets[from.planetId].systemId;
  const toSys = world.galaxy.planets[to.planetId].systemId;
  const fleet = createFleet(world, empireId, fromSys, [{ role: 'miner', power: 5 }]);
  fleet.cargo = cargo;
  fleet.order = { type: 'convoy', path: findPath(world.galaxy, fromSys, toSys), legProgress: 0, targetPlanetId: to.planetId };
  return fleet.id;
}

/** Pirate AI: idle pirate fleets set course for the nearest unprotected target. */
export function piracyStep(world: WorldState, data: WorldData, rng: Rng): void {
  void rng;
  const pirates = Object.keys(world.empires).filter((id) => world.empires[id].pirate).sort();
  if (pirates.length === 0) return;

  // Collect raid targets: unprotected colonies and any convoy in transit.
  const targetSystems: string[] = [];
  for (const eid of Object.keys(world.empires).sort()) {
    const e = world.empires[eid];
    if (e.pirate || isProtected(world, e, data)) continue;
    for (const cid of e.colonyIds) {
      const c = world.colonies[cid];
      if (c) targetSystems.push(world.galaxy.planets[c.planetId].systemId);
    }
  }
  for (const fid of Object.keys(world.fleets).sort()) {
    const f = world.fleets[fid];
    const owner = world.empires[f.empireId];
    if (f.cargo && owner && !owner.pirate && !isProtected(world, owner, data)) targetSystems.push(f.systemId);
  }
  if (targetSystems.length === 0) return;

  for (const eid of pirates) {
    for (const fid of [...world.empires[eid].fleetIds].sort()) {
      const fleet = world.fleets[fid];
      if (!fleet || fleet.order) continue;
      let bestSys: string | null = null;
      let bestLen = Number.POSITIVE_INFINITY;
      for (const ts of targetSystems) {
        if (ts === fleet.systemId) {
          bestSys = ts;
          bestLen = 0;
          break;
        }
        const path = findPath(world.galaxy, fleet.systemId, ts);
        if (path.length > 0 && path.length < bestLen) {
          bestLen = path.length;
          bestSys = ts;
        }
      }
      if (bestSys && bestSys !== fleet.systemId) {
        fleet.order = { type: 'move', path: findPath(world.galaxy, fleet.systemId, bestSys), legProgress: 0 };
      }
    }
  }
}
