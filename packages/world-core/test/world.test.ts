import { describe, it, expect } from 'vitest';
import { loadWorldData } from '../src/data.js';
import { createWorld, tick, runTicks, worldHash } from '../src/world.js';
import { RESOURCE_GROUPS, MATERIAL_KINDS, type WorldState } from '../src/types.js';

const data = loadWorldData();
const races = ['sol', 'reptiloid', 'tumali', 'gerber'];

function fresh(seed = 7): WorldState {
  return createWorld(seed, data, { races, galaxy: { sectors: 5, systemsPerSector: 5, laneNeighbors: 3 } });
}

function totalPop(world: WorldState): number {
  return Object.values(world.colonies).reduce((a, c) => a + c.population, 0);
}

function totalRegionLevels(world: WorldState): number {
  return Object.values(world.colonies).reduce((a, c) => a + c.regions.reduce((x, r) => x + r.level, 0), 0);
}

describe('world creation', () => {
  it('gives every empire a homeworld colony', () => {
    const w = fresh();
    expect(Object.keys(w.empires)).toHaveLength(races.length);
    for (const e of Object.values(w.empires)) {
      expect(e.colonyIds.length).toBe(1);
      expect(w.colonies[e.colonyIds[0]].homeworld).toBe(true);
    }
  });

  it('places empires on distinct planets', () => {
    const w = fresh();
    const planetIds = Object.values(w.colonies).map((c) => c.planetId);
    expect(new Set(planetIds).size).toBe(planetIds.length);
  });
});

describe('economic tick', () => {
  it('grows population over time (food sustains the homeworld)', () => {
    const w = fresh();
    runTicks(w, data, 3);
    const early = totalPop(w);
    runTicks(w, data, 30);
    expect(totalPop(w)).toBeGreaterThan(early);
  });

  it('develops colonies via governors (region levels rise)', () => {
    const w = fresh();
    const before = totalRegionLevels(w);
    runTicks(w, data, 40);
    expect(totalRegionLevels(w)).toBeGreaterThan(before);
  });

  it('never drives a stock negative and keeps population >= 1 over a long run', () => {
    const w = fresh(11);
    for (let t = 0; t < 60; t++) {
      tick(w, data);
      for (const c of Object.values(w.colonies)) {
        expect(c.population).toBeGreaterThanOrEqual(1);
        for (const k of [...RESOURCE_GROUPS, ...MATERIAL_KINDS]) {
          expect(c.stock[k], `${c.id}.${k} negative at t${w.time}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('accumulates research and unlocks at least one technology', () => {
    const w = fresh();
    runTicks(w, data, 150);
    const anyTech = Object.values(w.empires).some((e) => e.unlockedTechs.length > 0);
    expect(anyTech).toBe(true);
  });
});

describe('tick determinism (design prompt §20 acceptance)', () => {
  it('same seed reproduces the identical world hash after N ticks', () => {
    const a = fresh(21);
    const b = fresh(21);
    runTicks(a, data, 50);
    runTicks(b, data, 50);
    expect(worldHash(a)).toBe(worldHash(b));
  });

  it('different seeds diverge', () => {
    const a = fresh(1);
    const b = fresh(2);
    runTicks(a, data, 25);
    runTicks(b, data, 25);
    expect(worldHash(a)).not.toBe(worldHash(b));
  });
});
