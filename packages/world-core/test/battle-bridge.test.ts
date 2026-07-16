import { describe, it, expect } from 'vitest';
import { loadWorldData } from '../src/data.js';
import { createWorld, tick, worldHash } from '../src/world.js';
import { createFleet } from '../src/fleet.js';
import type { WorldData, WorldState } from '../src/types.js';

const data = loadWorldData();
const smallGalaxy = { sectors: 5, systemsPerSector: 5, laneNeighbors: 3 };

function scene(seed = 5): { w: WorldState; sys: string } {
  const w = createWorld(seed, data, { races: ['sol', 'reptiloid'], galaxy: smallGalaxy });
  // Both empires out of newbie protection so battles resolve.
  w.empires['emp0'].foundedTick = -100;
  w.empires['emp1'].foundedTick = -100;
  const sys = w.galaxy.planets[w.colonies[w.empires['emp0'].colonyIds[0]].planetId].systemId;
  return { w, sys };
}

describe('world<->combat bridge (сшивка)', () => {
  it('resolves a co-located engagement tactically and applies casualties', () => {
    const { w, sys } = scene();
    const strong = createFleet(w, 'emp0', sys, [
      { role: 'warship', power: 90 },
      { role: 'warship', power: 90 },
    ]);
    const weak = createFleet(w, 'emp1', sys, [{ role: 'warship', power: 12 }]);

    tick(w, data);

    expect(w.log.some((e) => e.kind === 'battle' && e.text.includes('Tactical'))).toBe(true);
    expect(w.fleets[weak.id]).toBeUndefined(); // the weak side is wiped
    expect(w.fleets[strong.id]).toBeDefined();
  });

  it('is deterministic (same seed -> same outcome)', () => {
    const build = (): WorldState => {
      const { w, sys } = scene(9);
      createFleet(w, 'emp0', sys, [{ role: 'warship', power: 70 }, { role: 'warship', power: 70 }]);
      createFleet(w, 'emp1', sys, [{ role: 'warship', power: 60 }, { role: 'warship', power: 40 }]);
      return w;
    };
    const a = build();
    const b = build();
    tick(a, data);
    tick(b, data);
    expect(worldHash(a)).toBe(worldHash(b));
  });

  it('falls back to the quick resolve when tactical combat is disabled', () => {
    const quickData: WorldData = { ...data, combat: { ...data.combat, tactical: false } };
    const { w, sys } = scene(3);
    createFleet(w, 'emp0', sys, [{ role: 'warship', power: 90 }, { role: 'warship', power: 90 }]);
    const weak = createFleet(w, 'emp1', sys, [{ role: 'warship', power: 12 }]);

    tick(w, quickData);

    const battles = w.log.filter((e) => e.kind === 'battle');
    expect(battles.length).toBeGreaterThan(0);
    expect(battles.every((e) => !e.text.includes('Tactical'))).toBe(true);
    expect(w.fleets[weak.id]).toBeUndefined();
  });
});
