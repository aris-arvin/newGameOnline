import { describe, it, expect } from 'vitest';
import { Rng } from '@pure-galaxy/shared';
import { loadWorldData } from '../src/data.js';
import { createWorld, tick, runTicks, worldHash } from '../src/world.js';
import { addTreaty, hasTreaty, areAllied, areHostile, breakTreaty } from '../src/diplomacy.js';
import { isProtected, empireRating } from '../src/protection.js';
import { spawnPirates, dispatchConvoy, PIRATE_EMPIRE } from '../src/piracy.js';
import { trainAgent, assignMission, espionageStep } from '../src/espionage.js';
import { createFleet } from '../src/fleet.js';
import { makeStock } from '../src/colony.js';
import { TRADE_COMMODITIES } from '../src/market.js';
import type { WorldState } from '../src/types.js';

const data = loadWorldData();
const smallGalaxy = { sectors: 5, systemsPerSector: 5, laneNeighbors: 3 };

function world(seed = 7, races = ['sol', 'reptiloid']): WorldState {
  return createWorld(seed, data, { races, galaxy: smallGalaxy });
}
const homeSystem = (w: WorldState, eid: string): string =>
  w.galaxy.planets[w.colonies[w.empires[eid].colonyIds[0]].planetId].systemId;

describe('diplomacy (§11)', () => {
  it('treaties make allies and stop hostility', () => {
    const w = world();
    expect(areHostile(w, 'emp0', 'emp1')).toBe(true);
    addTreaty(w, 'emp0', 'emp1', 'nonaggression');
    expect(hasTreaty(w, 'emp0', 'emp1', 'nonaggression')).toBe(true);
    expect(areAllied(w, 'emp0', 'emp1')).toBe(true);
    expect(areHostile(w, 'emp0', 'emp1')).toBe(false);
  });

  it('breaking a treaty damages relations', () => {
    const w = world();
    addTreaty(w, 'emp0', 'emp1', 'nonaggression');
    breakTreaty(w, 'emp0', 'emp1', 'nonaggression');
    expect(hasTreaty(w, 'emp0', 'emp1', 'nonaggression')).toBe(false);
    expect(w.empires['emp0'].relations['emp1']).toBeLessThan(0);
  });

  it('pirates are hostile to everyone', () => {
    const w = world();
    spawnPirates(w, data, 1);
    expect(areHostile(w, PIRATE_EMPIRE, 'emp0')).toBe(true);
    addTreaty(w, PIRATE_EMPIRE, 'emp0', 'nonaggression'); // should not matter
    expect(areHostile(w, PIRATE_EMPIRE, 'emp0')).toBe(true);
  });
});

describe('newbie protection (§14.1)', () => {
  it('shields young empires and lifts with age', () => {
    const w = world();
    expect(isProtected(w, w.empires['emp0'], data)).toBe(true);
    w.empires['emp0'].foundedTick = -100; // long-established
    expect(isProtected(w, w.empires['emp0'], data)).toBe(false);
  });

  it('rating grows as the empire develops', () => {
    const w = world();
    const before = empireRating(w, w.empires['emp0']);
    runTicks(w, data, 30);
    expect(empireRating(w, w.empires['emp0'])).toBeGreaterThan(before);
  });
});

describe('market (§16)', () => {
  it('empires accumulate treasury and prices stay within the band', () => {
    const w = world(4, ['sol', 'reptiloid', 'tumali', 'gerber']);
    runTicks(w, data, 40);
    const anyTreasury = Object.values(w.empires).some((e) => TRADE_COMMODITIES.some((c) => e.treasury[c] > 0));
    expect(anyTreasury).toBe(true);
    for (const c of TRADE_COMMODITIES) {
      const base = data.market.basePrices[c];
      expect(w.market.prices[c]).toBeGreaterThanOrEqual(Math.floor(base / 2));
      expect(w.market.prices[c]).toBeLessThanOrEqual(base * 3);
    }
  });
});

describe('espionage (§12)', () => {
  it('a mission resolves and is logged', () => {
    const w = world();
    w.empires['emp1'].unlockedTechs.push('phys_extraction'); // give the target something to steal
    const agent = trainAgent(w, 'emp0', data)!;
    expect(agent).toBeTruthy();
    assignMission(agent, 'emp1', 'steal_tech');
    const rng = new Rng(123);
    for (let i = 0; i < data.espionage.missionTicks + 2; i++) espionageStep(w, data, rng);
    expect(w.log.some((e) => e.kind === 'spy')).toBe(true);
  });
});

describe('convoys & piracy (§5.4, §14.4)', () => {
  it('delivers cargo to the treasury when the route is safe', () => {
    const w = world(8);
    const emp0 = w.empires['emp0'];
    // A same-colony convoy delivers next tick (path length 0).
    const before = emp0.treasury.alloys;
    dispatchConvoy(w, 'emp0', emp0.colonyIds[0], emp0.colonyIds[0], makeStock({ alloys: 25 }));
    tick(w, data);
    expect(emp0.treasury.alloys).toBeGreaterThanOrEqual(before + 25);
  });

  it('a pirate raids an unprotected convoy', () => {
    const w = world(9);
    w.empires['emp0'].foundedTick = -100; // unprotected
    const sys = homeSystem(w, 'emp0');
    spawnPirates(w, data, 0);
    createFleet(w, PIRATE_EMPIRE, sys, [{ role: 'warship', power: 80 }]);
    const convoy = createFleet(w, 'emp0', sys, [{ role: 'miner', power: 5 }]);
    convoy.cargo = makeStock({ alloys: 30 });

    tick(w, data);
    expect(w.fleets[convoy.id]).toBeUndefined();
  });
});

describe('society determinism', () => {
  it('same seed + pirates reproduces the identical hash after N ticks', () => {
    const a = world(21, ['sol', 'reptiloid', 'tumali', 'gerber']);
    const b = world(21, ['sol', 'reptiloid', 'tumali', 'gerber']);
    spawnPirates(a, data, 2);
    spawnPirates(b, data, 2);
    runTicks(a, data, 45);
    runTicks(b, data, 45);
    expect(worldHash(a)).toBe(worldHash(b));
  });
});
