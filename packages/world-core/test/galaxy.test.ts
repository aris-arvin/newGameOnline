import { describe, it, expect } from 'vitest';
import { hashValue } from '@pure-galaxy/shared';
import { generateGalaxy, findPath, laneDistance } from '../src/galaxy.js';

describe('galaxy generation', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = generateGalaxy(42);
    const b = generateGalaxy(42);
    const c = generateGalaxy(43);
    expect(hashValue(a)).toBe(hashValue(b));
    expect(hashValue(a)).not.toBe(hashValue(c));
  });

  it('produces the requested structure', () => {
    const g = generateGalaxy(1, { sectors: 4, systemsPerSector: 5, laneNeighbors: 3 });
    expect(g.sectors).toHaveLength(4);
    expect(Object.keys(g.systems)).toHaveLength(20);
    expect(Object.keys(g.planets).length).toBeGreaterThan(20);
  });

  it('is fully connected (every system reachable from the first)', () => {
    const g = generateGalaxy(9);
    const ids = Object.keys(g.systems).sort();
    const start = ids[0];
    for (const target of ids) {
      if (target === start) continue;
      const path = findPath(g, start, target);
      expect(path.length, `no path ${start} -> ${target}`).toBeGreaterThan(0);
    }
  });

  it('lanes are symmetric with equal distance', () => {
    const g = generateGalaxy(3);
    for (const [from, lanes] of Object.entries(g.lanes)) {
      for (const lane of lanes) {
        expect(laneDistance(g, lane.to, from)).toBe(lane.dist);
      }
    }
  });
});
