import { describe, it, expect } from 'vitest';
import { loadWorldData, raceById } from '../src/data.js';
import { habitability } from '../src/colony.js';
import type { Planet } from '../src/types.js';

const data = loadWorldData();

function planet(over: Partial<Planet>): Planet {
  return {
    id: 'p',
    systemId: 's',
    name: 'P',
    size: 5,
    biome: 'terra',
    gravity: 'normal',
    richness: 3,
    belt: 0,
    ruins: false,
    regionSlots: 6,
    ...over,
  };
}

describe('habitability', () => {
  it('ranks a terra world above a barren world for humans', () => {
    const sol = raceById(data, 'sol');
    expect(habitability(planet({ biome: 'terra' }), sol, data)).toBeGreaterThan(
      habitability(planet({ biome: 'barren' }), sol, data),
    );
  });

  it('grants a home-biome affinity bonus', () => {
    const gerber = raceById(data, 'gerber'); // toxic-dwellers
    const onToxic = habitability(planet({ biome: 'toxic' }), gerber, data);
    const sol = raceById(data, 'sol');
    const solToxic = habitability(planet({ biome: 'toxic' }), sol, data);
    expect(onToxic).toBeGreaterThan(solToxic);
  });

  it('applies gravity penalties and clamps to 0..100', () => {
    const sol = raceById(data, 'sol');
    const normal = habitability(planet({ biome: 'terra', gravity: 'normal' }), sol, data);
    const high = habitability(planet({ biome: 'terra', gravity: 'high' }), sol, data);
    expect(high).toBeLessThan(normal);
    expect(habitability(planet({ biome: 'barren', gravity: 'high' }), sol, data)).toBeGreaterThanOrEqual(0);
  });
});
