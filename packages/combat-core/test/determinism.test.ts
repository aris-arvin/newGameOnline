import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/battle.js';
import { loadDefaultCatalog, loadBlueprintMap } from '../src/data.js';
import type { Side } from '../src/types.js';

const catalog = loadDefaultCatalog();
const blueprints = loadBlueprintMap();

function scenario(): [Side, Side] {
  const mk = (id: string, bpId: string, count: number, doctrine: string, flag = true): Side => ({
    id,
    name: id,
    ships: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i}`,
      blueprint: blueprints.get(bpId)!,
      doctrineId: doctrine,
      isFlagship: flag && i === 0,
    })),
  });
  const a: Side = {
    id: 'sol',
    name: 'sol',
    ships: [
      ...mk('sol', 'bp_cruiser_flagship', 1, 'brawler').ships,
      ...mk('sol', 'bp_pd_escort', 2, 'interceptor', false).ships.map((s, i) => ({ ...s, id: `sol-escort-${i}` })),
    ],
  };
  const b = mk('coalition', 'bp_missile_destroyer', 3, 'gunline');
  return [a, b];
}

describe('battle determinism (design prompt §10.12, §18.6)', () => {
  it('same seed reproduces the identical event-log hash and outcome', () => {
    const [a1, b1] = scenario();
    const [a2, b2] = scenario();
    const r1 = runBattle([a1, b1], catalog, { seed: 777 }, {});
    const r2 = runBattle([a2, b2], catalog, { seed: 777 }, {});
    expect(r2.logHash).toBe(r1.logHash);
    expect(r2.winner).toBe(r1.winner);
    expect(r2.rounds).toBe(r1.rounds);
    expect(r2.log.events.length).toBe(r1.log.events.length);
  });

  it('re-running does not mutate the input fleets (pure inputs)', () => {
    const [a, b] = scenario();
    const snapshot = JSON.stringify([a, b]);
    runBattle([a, b], catalog, { seed: 5 }, {});
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });

  it('different seeds generally diverge', () => {
    const hashes = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const [a, b] = scenario();
      hashes.add(runBattle([a, b], catalog, { seed }, {}).logHash);
    }
    expect(hashes.size).toBeGreaterThan(1);
  });

  it('the exported hash matches a fresh hash of the same event stream', () => {
    const [a, b] = scenario();
    const r = runBattle([a, b], catalog, { seed: 21 }, {});
    expect(r.log.hash()).toBe(r.logHash);
  });
});
