import { describe, it, expect } from 'vitest';
import { loadWorldData, raceById } from '../src/data.js';
import { createWorld, tick } from '../src/world.js';
import { createFleet } from '../src/fleet.js';
import { findPath } from '../src/galaxy.js';
import { habitability } from '../src/colony.js';
import type { WorldState } from '../src/types.js';

const data = loadWorldData();
const races = ['sol', 'reptiloid'];

function fresh(seed = 7): WorldState {
  return createWorld(seed, data, { races, galaxy: { sectors: 5, systemsPerSector: 5, laneNeighbors: 3 } });
}

describe('fleet travel & colonization', () => {
  it('a colony fleet reaches an unowned planet and founds a colony', () => {
    const w = fresh(4);
    const emp0 = w.empires['emp0'];
    const race = raceById(data, emp0.raceId);
    const homeSystem = w.galaxy.planets[w.colonies[emp0.colonyIds[0]].planetId].systemId;

    // Find a reachable unowned, habitable target via BFS.
    const owned = new Set(Object.values(w.colonies).map((c) => c.planetId));
    let target: { planetId: string; systemId: string } | null = null;
    const seen = new Set([homeSystem]);
    const queue = [homeSystem];
    while (queue.length && !target) {
      const sys = queue.shift()!;
      for (const pid of w.galaxy.systems[sys].planetIds) {
        if (!owned.has(pid) && habitability(w.galaxy.planets[pid], race, data) >= 25) {
          target = { planetId: pid, systemId: sys };
          break;
        }
      }
      for (const lane of w.galaxy.lanes[sys] ?? []) if (!seen.has(lane.to)) (seen.add(lane.to), queue.push(lane.to));
    }
    expect(target).not.toBeNull();

    const fleet = createFleet(w, 'emp0', homeSystem, [{ role: 'colony', power: 0 }]);
    fleet.order = { type: 'colonize', path: findPath(w.galaxy, homeSystem, target!.systemId), legProgress: 0, targetPlanetId: target!.planetId };

    const before = emp0.colonyIds.length;
    for (let t = 0; t < 60; t++) tick(w, data);

    expect(emp0.colonyIds.length).toBe(before + 1);
    expect(Object.values(w.colonies).some((c) => c.planetId === target!.planetId && c.empireId === 'emp0')).toBe(true);
  });
});

describe('non-tactical auto-battle (§20)', () => {
  it('the stronger fleet wins and the weaker is destroyed', () => {
    const w = fresh(5);
    const sys = w.galaxy.planets[w.colonies[w.empires['emp0'].colonyIds[0]].planetId].systemId;
    const strong = createFleet(w, 'emp0', sys, [
      { role: 'warship', power: 60 },
      { role: 'warship', power: 60 },
    ]);
    const weak = createFleet(w, 'emp1', sys, [{ role: 'warship', power: 15 }]);

    tick(w, data); // fleetStep resolves the co-located hostile fleets

    expect(w.fleets[weak.id]).toBeUndefined();
    expect(w.fleets[strong.id]).toBeDefined();
    expect(w.empires['emp1'].fleetIds).not.toContain(weak.id);
  });
});
