import { describe, it, expect } from 'vitest';
import { Rng } from '@pure-galaxy/shared';
import { loadWorldData } from '../src/data.js';
import { createWorld, tick, runTicks, worldHash } from '../src/world.js';
import { senateWeight } from '../src/senate.js';
import { spawnAncients, ancientsStep, ANCIENT_EMPIRE } from '../src/ancients.js';
import { archaeologyStep } from '../src/archaeology.js';
import { dispatchExpedition, expeditionsStep } from '../src/expeditions.js';
import { recruitAdmiral, assignAdmiral, admiralBonus, killFleetAdmirals } from '../src/admiral.js';
import { invasionStep } from '../src/invasion.js';
import { checkVictory, sectorControlPct, tradeSharePct } from '../src/victory.js';
import { createColony } from '../src/colony.js';
import { createFleet } from '../src/fleet.js';
import { spawnPirates } from '../src/piracy.js';
import type { WorldState } from '../src/types.js';

const data = loadWorldData();
const smallGalaxy = { sectors: 5, systemsPerSector: 5, laneNeighbors: 3 };
const world = (seed = 7, races = ['sol', 'reptiloid', 'tumali', 'gerber']): WorldState =>
  createWorld(seed, data, { races, galaxy: smallGalaxy });
const homeSystem = (w: WorldState, eid: string): string =>
  w.galaxy.planets[w.colonies[w.empires[eid].colonyIds[0]].planetId].systemId;

describe('Galactic Senate (§11.3)', () => {
  it('elects a president and passes resolutions', () => {
    const w = world();
    runTicks(w, data, data.senate.termLength + 5);
    expect(w.senate.president).not.toBeNull();
    expect(w.senate.termCount).toBeGreaterThanOrEqual(1);
    expect(w.senate.resolutionLog.length).toBeGreaterThan(0);
  });

  it('weight counts economy/pop/reputation but NOT military', () => {
    const w = world();
    const before = senateWeight(w, w.empires['emp0']);
    createFleet(w, 'emp0', homeSystem(w, 'emp0'), [{ role: 'warship', power: 500 }]);
    expect(senateWeight(w, w.empires['emp0'])).toBe(before); // fleets don't help
  });
});

describe('Ancients & archaeology (§13)', () => {
  it('a raid resolves with an event', () => {
    const w = world();
    spawnAncients(w, data);
    w.time = data.ancients.firstRaidTick; // land exactly on a raid tick
    ancientsStep(w, data, new Rng(1));
    expect(w.log.some((e) => e.kind === 'ancients')).toBe(true);
  });

  it('excavating ruins yields artifacts', () => {
    const w = world();
    const colony = w.colonies[w.empires['emp0'].colonyIds[0]];
    w.galaxy.planets[colony.planetId].ruins = true;
    for (let i = 0; i < 40; i++) archaeologyStep(w, data, new Rng(i + 1));
    expect(w.empires['emp0'].artifacts).toBeGreaterThan(0);
  });
});

describe('Gate expeditions & science victory (§13, §15)', () => {
  it('a well-resourced empire completes an expedition', () => {
    const w = world();
    const e = w.empires['emp0'];
    e.credits = 2000;
    e.research.physics = 300;
    createFleet(w, 'emp0', homeSystem(w, 'emp0'), [{ role: 'warship', power: 600 }]);
    expect(dispatchExpedition(w, 'emp0', data)).toBe(true);
    for (let i = 0; i < data.expeditions.durationTicks + 2; i++) expeditionsStep(w, data, new Rng(99));
    expect(e.expeditionsDone).toBe(1);
  });

  it('completing all expeditions is a science victory', () => {
    const w = world();
    w.empires['emp0'].expeditionsDone = data.expeditions.count;
    checkVictory(w, data);
    expect(w.victor?.reason).toBe('science');
    expect(w.victor?.empireId).toBe('emp0');
  });
});

describe('Admirals (§9)', () => {
  it('recruit, assign, contribute a combat bonus, and die with the fleet', () => {
    const w = world();
    w.empires['emp0'].credits = 500;
    const fleet = createFleet(w, 'emp0', homeSystem(w, 'emp0'), [{ role: 'warship', power: 20 }]);
    const admiral = recruitAdmiral(w, 'emp0', data, new Rng(3))!;
    expect(admiral).toBeTruthy();
    assignAdmiral(w, admiral.id, fleet.id);
    expect(admiralBonus(w, fleet.id, data)).toBeGreaterThan(0);
    killFleetAdmirals(w, fleet.id);
    expect(admiralBonus(w, fleet.id, data)).toBe(0);
    expect(w.empires['emp0'].admiralIds).not.toContain(admiral.id);
  });
});

describe('Ground invasion (§10.10)', () => {
  it('captures an unprotected enemy colony with orbital dominance', () => {
    const w = world(5, ['sol', 'reptiloid']);
    w.empires['emp1'].foundedTick = -100; // unprotected

    // Give emp1 a second (non-home) colony on an unowned planet.
    const owned = new Set(Object.values(w.colonies).map((c) => c.planetId));
    const targetPlanet = Object.keys(w.galaxy.planets).sort().find((pid) => !owned.has(pid))!;
    const colonyId = 'col_target';
    w.colonies[colonyId] = createColony(colonyId, w.galaxy.planets[targetPlanet], 'emp1', 'balanced');
    w.empires['emp1'].colonyIds.push(colonyId);
    const sys = w.galaxy.planets[targetPlanet].systemId;

    // emp0 lands troops there; no emp1 fleet defends.
    createFleet(w, 'emp0', sys, [{ role: 'troops', power: 10 }]);
    invasionStep(w, data);

    expect(w.colonies[colonyId].empireId).toBe('emp0');
    expect(w.colonies[colonyId].unrest).toBeGreaterThan(0);
    expect(w.empires['emp0'].colonyIds).toContain(colonyId);
    expect(w.empires['emp1'].colonyIds).not.toContain(colonyId);
  });
});

describe('Victory conditions (§15)', () => {
  it('two consecutive presidencies is a diplomatic victory', () => {
    const w = world();
    w.senate.president = 'emp1';
    w.senate.consecutiveTerms = 2;
    checkVictory(w, data);
    expect(w.victor).toMatchObject({ empireId: 'emp1', reason: 'diplomatic' });
  });

  it('a sustained trade-share lead is an economic victory', () => {
    const w = world(3, ['sol', 'reptiloid']);
    w.empires['emp0'].tradeVolume = 100000;
    w.empires['emp1'].tradeVolume = 0;
    expect(tradeSharePct(w, 'emp0')).toBeGreaterThanOrEqual(data.victory.economicSharePct);
    for (let i = 0; i < data.victory.economicHoldTicks + 1 && !w.victor; i++) checkVictory(w, data);
    expect(w.victor?.reason).toBe('economic');
  });

  it('sectorControlPct is 0..100', () => {
    const w = world();
    const pct = sectorControlPct(w, 'emp0');
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

describe('Phase 3 determinism', () => {
  it('same seed + pirates + ancients reproduces the identical hash', () => {
    const a = world(21);
    const b = world(21);
    spawnPirates(a, data, 2);
    spawnAncients(a, data);
    spawnPirates(b, data, 2);
    spawnAncients(b, data);
    runTicks(a, data, 70);
    runTicks(b, data, 70);
    expect(worldHash(a)).toBe(worldHash(b));
    expect(w0(a)).toBe(w0(b));
  });
});

function w0(w: WorldState): string {
  return `${w.senate.termCount}:${w.senate.president}:${w.victor?.reason ?? ''}`;
}
