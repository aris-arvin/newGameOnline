/**
 * Browser engine bootstrap. Constructs the real PURE GALAXY engines from the
 * shipped JSON data and runs them entirely client-side — the same deterministic
 * cores used on the server (design prompt §18.3). No mock data.
 */
import { Catalog, computeShipStats, runBattle } from '@pure-galaxy/combat-core';
import type { Blueprint, ComponentDef, HullDef, Side } from '@pure-galaxy/combat-core';
import hullsJson from '@pure-galaxy/combat-core/data/hulls.json';
import componentsJson from '@pure-galaxy/combat-core/data/components.json';
import blueprintsJson from '@pure-galaxy/combat-core/data/blueprints.json';
import { createWorld, tick, spectateSnapshot, createTacticalResolver } from '@pure-galaxy/world-core';
import type { BattleResolver, WorldData, WorldState } from '@pure-galaxy/world-core';
import worldDataJson from '@pure-galaxy/world-core/data/world-data.json';

export const hulls = hullsJson as unknown as HullDef[];
export const components = componentsJson as unknown as ComponentDef[];
export const blueprints = blueprintsJson as unknown as Blueprint[];

export const catalog = new Catalog({ hulls, components });
export const blueprintMap = new Map<string, Blueprint>(blueprints.map((b) => [b.id, b]));
export const worldData = worldDataJson as unknown as WorldData;
export const resolver: BattleResolver = createTacticalResolver(catalog, blueprintMap);

export const RACES = ['sol', 'reptiloid', 'tumali', 'gerber'];

export function newWorld(seed: number): WorldState {
  return createWorld(seed, worldData, {
    races: RACES,
    galaxy: { sectors: 6, systemsPerSector: 5, laneNeighbors: 3 },
  });
}

/** Advance the world by n ticks in place (mutates). */
export function advance(world: WorldState, n: number): void {
  for (let i = 0; i < n; i++) tick(world, worldData, resolver);
}

export { computeShipStats, runBattle, spectateSnapshot };
export type { Blueprint, ComponentDef, Side, WorldState };

/** Stable colour per empire id for the UI. */
export const EMPIRE_COLORS: Record<string, string> = {
  emp0: '#4ea1ff',
  emp1: '#ff6b6b',
  emp2: '#ffd166',
  emp3: '#8ce99a',
  empPirate: '#b197fc',
  empAncient: '#e599f7',
};

export function empireColor(id: string): string {
  return EMPIRE_COLORS[id] ?? '#9aa4b2';
}
