/**
 * Colonies, planet habitability, regional development (design prompt §6).
 */
import type {
  Colony,
  Planet,
  RaceDef,
  Region,
  RegionSpec,
  Stock,
  WorldData,
} from './types.js';
import { MATERIAL_KINDS, RESOURCE_GROUPS } from './types.js';

export function makeStock(init: Partial<Stock> = {}): Stock {
  const stock = {} as Stock;
  for (const r of RESOURCE_GROUPS) stock[r] = init[r] ?? 0;
  for (const m of MATERIAL_KINDS) stock[m] = init[m] ?? 0;
  return stock;
}

/** Planet habitability for a race, 0..100 (§3 suitability = f(biome, gravity, race)). */
export function habitability(planet: Planet, race: RaceDef, data: WorldData): number {
  const biome = data.biomes[planet.biome];
  let h = biome.habitability + data.gravityHabMod[planet.gravity];
  if (planet.biome === race.homeBiome) h += race.biomeAffinity;
  return Math.max(0, Math.min(100, h));
}

/** Housing-derived population cap, scaled by habitability. */
export function populationCap(colony: Colony, planet: Planet, race: RaceDef, data: WorldData): number {
  const housingBase = data.regionBase.housing.popCap ?? 24;
  let base = 10;
  for (const r of colony.regions) {
    if (r.spec === 'housing') base += housingBase * r.level;
  }
  const hab = habitability(planet, race, data);
  return Math.max(1, Math.floor((base * hab) / 100));
}

/** A developed homeworld colony (safe start per §6.1: the home planet is invulnerable). */
export function createHomeColony(
  id: string,
  planet: Planet,
  empireId: string,
  governor: string,
): Colony {
  const desired: [RegionSpec, number][] = [
    ['housing', 3],
    ['farm', 2],
    ['mining', 2],
    ['industry', 2],
    ['science', 1],
    ['spaceport', 1],
  ];
  const regions: Region[] = [];
  for (const [spec, level] of desired) {
    if (regions.length >= planet.regionSlots) break;
    regions.push({ spec, level });
  }
  while (regions.length < Math.min(planet.regionSlots, 8)) regions.push({ spec: 'empty', level: 0 });

  return {
    id,
    planetId: planet.id,
    empireId,
    homeworld: true,
    population: 40,
    regions,
    stock: makeStock({ metals: 60, minerals: 40, gas: 30, organics: 40, food: 60, alloys: 20 }),
    buildQueue: [],
    governor,
  };
}

/** A freshly founded colony (from a colony ship reaching a planet). */
export function createColony(
  id: string,
  planet: Planet,
  empireId: string,
  governor: string,
): Colony {
  const regions: Region[] = [
    { spec: 'housing', level: 1 },
    { spec: 'farm', level: 1 },
  ];
  const extra = Math.min(Math.max(0, planet.regionSlots - 2), 3);
  for (let i = 0; i < extra; i++) regions.push({ spec: 'empty', level: 0 });
  return {
    id,
    planetId: planet.id,
    empireId,
    homeworld: false,
    population: 8,
    regions,
    stock: makeStock({ food: 20, metals: 10 }),
    buildQueue: [],
    governor,
  };
}

/** Count regions of a given spec (used for cluster synergy, §6.2). */
export function countSpec(colony: Colony, spec: RegionSpec): number {
  let n = 0;
  for (const r of colony.regions) if (r.spec === spec) n++;
  return n;
}
