/**
 * Spectator / mobile snapshot (design prompt §10.11 spectator, §17 mobile).
 * Produces a compact, read-only view of PUBLIC state — standings, the Senate,
 * market prices, the season and any victor — deliberately excluding fog-of-war
 * secrets (agents, relations, treasury) so it is safe to broadcast to spectators
 * and light enough for a phone.
 */
import type { WorldData, WorldState } from './types.js';
import { empireRating } from './protection.js';

export interface Standing {
  empire: string;
  race: string;
  rating: number;
  colonies: number;
  population: number;
  credits: number;
  expeditions: number;
  artifacts: number;
  legacy: number;
  president: boolean;
}

export interface Snapshot {
  season: number;
  seasonStatus: string;
  time: number;
  victor: { empire: string; reason: string } | null;
  standings: Standing[];
  senate: { president: string; term: number; streak: number };
  prices: Record<string, number>;
  galaxy: { sectors: number; systems: number; planets: number };
}

export function spectateSnapshot(world: WorldState, data: WorldData): Snapshot {
  void data;
  const ids = Object.keys(world.empires)
    .filter((id) => !world.empires[id].pirate && !world.empires[id].ancient)
    .sort();

  const standings: Standing[] = ids
    .map((id) => {
      const e = world.empires[id];
      let population = 0;
      for (const cid of e.colonyIds) population += world.colonies[cid]?.population ?? 0;
      return {
        empire: e.name,
        race: e.raceId,
        rating: empireRating(world, e),
        colonies: e.colonyIds.length,
        population,
        credits: e.credits,
        expeditions: e.expeditionsDone,
        artifacts: e.artifacts,
        legacy: e.legacy,
        president: world.senate.president === id,
      };
    })
    .sort((a, b) => b.rating - a.rating || (a.empire < b.empire ? -1 : 1));

  return {
    season: world.season.number,
    seasonStatus: world.season.status,
    time: world.time,
    victor: world.victor
      ? { empire: world.empires[world.victor.empireId]?.name ?? world.victor.empireId, reason: world.victor.reason }
      : null,
    standings,
    senate: {
      president: world.senate.president ? world.empires[world.senate.president]?.name ?? '' : '',
      term: world.senate.termCount,
      streak: world.senate.consecutiveTerms,
    },
    prices: { ...world.market.prices },
    galaxy: {
      sectors: world.galaxy.sectors.length,
      systems: Object.keys(world.galaxy.systems).length,
      planets: Object.keys(world.galaxy.planets).length,
    },
  };
}
