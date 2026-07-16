import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/battle.js';
import { loadDefaultCatalog, loadBlueprintMap } from '../src/data.js';
import type { Side } from '../src/types.js';

const catalog = loadDefaultCatalog();
const blueprints = loadBlueprintMap();

function fleet(id: string, bpId: string, count: number, doctrine: string): Side {
  const bp = blueprints.get(bpId)!;
  return {
    id,
    name: id,
    ships: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i}`,
      blueprint: bp,
      doctrineId: doctrine,
      isFlagship: i === 0,
    })),
  };
}

describe('battle engine', () => {
  it('runs a duel to a decisive result', () => {
    const a = fleet('a', 'bp_kinetic_frigate', 1, 'brawler');
    const b = fleet('b', 'bp_beam_frigate', 1, 'balanced');
    const r = runBattle([a, b], catalog, { seed: 3 }, {});

    expect(r.rounds).toBeGreaterThanOrEqual(1);
    expect(r.rounds).toBeLessThanOrEqual(20);
    expect([a.id, b.id, null]).toContain(r.winner);
    expect(r.log.events[0].t).toBe('battle_start');
    expect(r.log.events[r.log.events.length - 1].t).toBe('battle_end');
  });

  it('produces at least one hit or miss event in a real fight', () => {
    const a = fleet('a', 'bp_kinetic_frigate', 2, 'brawler');
    const b = fleet('b', 'bp_kinetic_frigate', 2, 'brawler');
    const r = runBattle([a, b], catalog, { seed: 11 }, {});
    const fires = r.log.events.filter((e) => e.t === 'fire');
    expect(fires.length).toBeGreaterThan(0);
  });

  it('a larger identical fleet reliably beats a smaller one', () => {
    let bigWins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const big = fleet('big', 'bp_kinetic_frigate', 4, 'brawler');
      const small = fleet('small', 'bp_kinetic_frigate', 2, 'brawler');
      const r = runBattle([big, small], catalog, { seed }, {});
      if (r.winner === 'big') bigWins++;
    }
    expect(bigWins).toBeGreaterThan(32); // > 80% of the time
  });

  it('records destruction and ends when a side is annihilated', () => {
    const a = fleet('a', 'bp_cruiser_flagship', 1, 'brawler');
    const b = fleet('b', 'bp_sol_corvette', 1, 'balanced');
    const r = runBattle([a, b], catalog, { seed: 5 }, {});
    if (r.reason === 'annihilation') {
      expect(r.log.events.some((e) => e.t === 'destroyed')).toBe(true);
    }
    expect(['annihilation', 'timeout', 'draw']).toContain(r.reason);
  });
});
