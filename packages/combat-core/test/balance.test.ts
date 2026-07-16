import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/battle.js';
import { loadDefaultCatalog } from '../src/data.js';
import type { ArmorType, Blueprint, Side, WeaponType } from '../src/types.js';

/**
 * Balance-regression guard (design prompt §18.6). These invariants lock in the
 * rock-paper-scissors relationships (§10.6); CI runs them so a data/model tweak
 * that breaks the counters fails the build.
 */
const catalog = loadDefaultCatalog();

function duelShip(id: string, weapon: WeaponType, armor: ArmorType, pd: boolean): Blueprint {
  const weaponId = weapon === 'kinetic' ? 'railgun_m' : weapon === 'beam' ? 'laser_m' : 'missile_s';
  const armorId = armor === 'plated' ? 'armor_plate_m' : armor === 'ablative' ? 'armor_ablative_m' : 'armor_composite_m';
  return {
    id,
    name: id,
    hullId: 'hull_frigate',
    components: [
      { defId: weaponId, mount: 'nose' },
      { defId: weaponId, mount: 'nose' },
      { defId: 'engine_m', mount: 'side' },
      { defId: 'engine_m', mount: 'side' },
      { defId: armorId, mount: 'rear' },
      { defId: 'reactor_m', mount: 'internal' },
      { defId: armorId, mount: 'internal' },
      { defId: pd ? 'pd_m' : 'shield_s', mount: 'internal' },
    ],
  };
}

function side(id: string, bp: Blueprint, n: number): Side {
  return {
    id,
    name: id,
    ships: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, blueprint: bp, doctrineId: 'brawler', isFlagship: i === 0 })),
  };
}

function winRate(attacker: Blueprint, defender: Blueprint, runs: number): number {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const r = runBattle([side('atk', attacker, 2), side('def', defender, 2)], catalog, { seed }, {});
    if (r.winner === 'atk') wins++;
  }
  return Math.round((wins * 100) / runs);
}

describe('combat balance invariants (§10.6, §18.6)', () => {
  const runs = 120;

  it('missiles beat an unshielded, PD-less target', () => {
    const rate = winRate(duelShip('m', 'missile', 'plated', false), duelShip('d', 'kinetic', 'plated', false), runs);
    expect(rate).toBeGreaterThan(55);
  });

  it('point-defense hard-counters missiles', () => {
    const rate = winRate(duelShip('m', 'missile', 'plated', false), duelShip('d', 'kinetic', 'plated', true), runs);
    expect(rate).toBeLessThan(30);
  });

  it('a battle stays deterministic under the balance harness', () => {
    const a = runBattle([side('x', duelShip('k', 'kinetic', 'plated', false), 2), side('y', duelShip('b', 'beam', 'plated', false), 2)], catalog, { seed: 42 }, {});
    const b = runBattle([side('x', duelShip('k', 'kinetic', 'plated', false), 2), side('y', duelShip('b', 'beam', 'plated', false), 2)], catalog, { seed: 42 }, {});
    expect(a.logHash).toBe(b.logHash);
  });
});
