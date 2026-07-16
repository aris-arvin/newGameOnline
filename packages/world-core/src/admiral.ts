/**
 * Admirals (design prompt §9): officer-characters recruited at academies,
 * assigned to a fleet, granting a combat bonus. They die with their fleet
 * (handled in fleet destruction). Kept dependency-light (reads world state only)
 * so both the combat resolver and the Ancient-raid defense can use the bonus.
 */
import { Rng } from '@pure-galaxy/shared';
import type { Admiral, AdmiralSpec, WorldData, WorldState } from './types.js';

const SPECS: AdmiralSpec[] = ['gunnery', 'carrier', 'raider', 'defense', 'logistics'];

export function recruitAdmiral(world: WorldState, empireId: string, data: WorldData, rng: Rng): Admiral | null {
  const e = world.empires[empireId];
  if (!e || e.credits < data.admirals.cost) return null;
  e.credits -= data.admirals.cost;
  const id = `adm${world.nextId++}`;
  const admiral: Admiral = { id, empireId, name: `Adm. ${id.toUpperCase()}`, level: 1, spec: SPECS[rng.int(SPECS.length)] };
  world.admirals[id] = admiral;
  e.admiralIds.push(id);
  return admiral;
}

export function assignAdmiral(world: WorldState, admiralId: string, fleetId: string): void {
  const a = world.admirals[admiralId];
  if (a) a.fleetId = fleetId;
}

export function admiralForFleet(world: WorldState, fleetId: string): Admiral | undefined {
  for (const id of Object.keys(world.admirals).sort()) {
    if (world.admirals[id].fleetId === fleetId) return world.admirals[id];
  }
  return undefined;
}

/** Extra combat power a fleet's admiral contributes (0 if none). */
export function admiralBonus(world: WorldState, fleetId: string, data: WorldData): number {
  const a = admiralForFleet(world, fleetId);
  return a ? a.level * data.admirals.powerBonusPerLevel : 0;
}

/** Remove any admirals bound to a destroyed fleet (they die with it). */
export function killFleetAdmirals(world: WorldState, fleetId: string): void {
  for (const id of Object.keys(world.admirals)) {
    const a = world.admirals[id];
    if (a.fleetId === fleetId) {
      const e = world.empires[a.empireId];
      if (e) e.admiralIds = e.admiralIds.filter((x) => x !== id);
      delete world.admirals[id];
    }
  }
}
