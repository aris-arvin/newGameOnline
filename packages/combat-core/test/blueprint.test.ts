import { describe, it, expect } from 'vitest';
import { computeShipStats } from '../src/blueprint.js';
import { loadDefaultCatalog, loadBlueprints } from '../src/data.js';

describe('blueprint compiler', () => {
  const catalog = loadDefaultCatalog();
  const blueprints = loadBlueprints();

  it('ships all example blueprints as valid designs', () => {
    for (const bp of blueprints) {
      const stats = computeShipStats(bp, catalog);
      expect(stats.valid, `${bp.name}: ${stats.issues.join('; ')}`).toBe(true);
      expect(stats.powerBalance).toBeGreaterThanOrEqual(0);
    }
  });

  it('derives sane movement and defence numbers', () => {
    for (const bp of blueprints) {
      const stats = computeShipStats(bp, catalog);
      expect(stats.speed).toBeGreaterThanOrEqual(1);
      expect(stats.speed).toBeLessThanOrEqual(8);
      expect(stats.maxStructure).toBeGreaterThan(0);
      expect(stats.shieldCapacity).toHaveLength(4);
      expect(stats.armor).toHaveLength(4);
    }
  });

  it('flags an over-slotted design', () => {
    const bad = catalog.blueprint('bad', 'Overloaded', 'hull_corvette', [
      { defId: 'railgun_s', mount: 'nose' },
      { defId: 'railgun_s', mount: 'nose' }, // corvette has only 1 nose slot
      { defId: 'reactor_m', mount: 'internal' },
    ]);
    const stats = computeShipStats(bad, catalog);
    expect(stats.valid).toBe(false);
    expect(stats.issues.some((i) => i.includes('nose'))).toBe(true);
  });

  it('flags a power deficit', () => {
    const bad = catalog.blueprint('starved', 'Starved', 'hull_corvette', [
      { defId: 'railgun_m', mount: 'nose' },
      { defId: 'engine_m', mount: 'side' },
      { defId: 'reactor_s', mount: 'internal' }, // not enough power
    ]);
    const stats = computeShipStats(bad, catalog);
    expect(stats.valid).toBe(false);
    expect(stats.issues.some((i) => i.includes('power'))).toBe(true);
  });
});
