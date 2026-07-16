import { describe, it, expect } from 'vitest';
import { loadWorldData, loadMonetization } from '../src/data.js';
import { createWorld, runTicks, tick, worldHash, startNextSeason } from '../src/world.js';
import { endSeason, seasonStep } from '../src/seasons.js';
import { auditCatalog, isFair, type Entitlement } from '../src/monetization.js';
import { spectateSnapshot } from '../src/spectate.js';
import type { WorldState } from '../src/types.js';

const data = loadWorldData();
const smallGalaxy = { sectors: 5, systemsPerSector: 5, laneNeighbors: 3 };
const world = (seed = 7, races = ['sol', 'reptiloid', 'tumali', 'gerber']): WorldState =>
  createWorld(seed, data, { races, galaxy: smallGalaxy });

describe('seasons & legacy (§15)', () => {
  it('ends the season on a victory and crowns a champion with Legacy', () => {
    const w = world();
    w.victor = { empireId: 'emp0', reason: 'science', time: w.time };
    endSeason(w, data, 'victory');
    expect(w.season.status).toBe('ended');
    expect(w.empires['emp0'].legacy).toBeGreaterThanOrEqual(data.season.championLegacy);
    expect(w.empires['emp0'].titles.some((t) => t.includes('Champion'))).toBe(true);
  });

  it('ends the season on timeout', () => {
    const w = world();
    w.time = data.season.lengthTicks;
    seasonStep(w, data);
    expect(w.season.status).toBe('ended');
    expect(w.season.endReason).toBe('time');
  });

  it('caps the Legacy head start at the configured maximum', () => {
    const w = world();
    w.empires['emp0'].legacy = 1_000_000;
    endSeason(w, data, 'time');
    expect(w.empires['emp0'].legacyBonusPct).toBeLessThanOrEqual(data.season.maxLegacyBonusPct);
  });

  it('soft restart carries Legacy into a fresh season 2', () => {
    const w = world();
    w.empires['emp0'].legacy = 300;
    w.empires['emp0'].titles.push('S1 Champion (science)');
    w.empires['emp0'].legacyBonusPct = 2;
    const next = startNextSeason(w, data);
    expect(next.season.number).toBe(2);
    expect(next.season.status).toBe('active');
    expect(next.empires['emp0'].legacy).toBe(300);
    expect(next.empires['emp0'].titles).toContain('S1 Champion (science)');
    // Fresh world: each empire back to a single homeworld.
    for (const e of Object.values(next.empires)) {
      if (!e.pirate && !e.ancient) expect(e.colonyIds.length).toBe(1);
    }
  });

  it('soft restart is deterministic', () => {
    const a = world(21);
    const b = world(21);
    runTicks(a, data, 20);
    runTicks(b, data, 20);
    expect(worldHash(startNextSeason(a, data))).toBe(worldHash(startNextSeason(b, data)));
  });
});

describe('monetization is honest F2P (§19)', () => {
  it('the shipped catalog contains no pay-to-win entitlements', () => {
    const catalog = loadMonetization().entitlements;
    expect(catalog.length).toBeGreaterThan(0);
    expect(auditCatalog(catalog)).toEqual([]);
  });

  it('rejects a disguised pay-to-win entitlement', () => {
    const bad: Entitlement = { id: 'x', name: 'Booster', category: 'qol', description: 'Instant resources and a combat power boost.' };
    expect(isFair(bad)).toBe(false);
    expect(auditCatalog([bad])).toHaveLength(1);
  });

  it('rejects a forbidden category outright', () => {
    const bad = { id: 'y', name: 'Pay to Win', category: 'advantage', description: 'anything' } as unknown as Entitlement;
    expect(isFair(bad)).toBe(false);
  });
});

describe('spectator/mobile snapshot (§10.11, §17)', () => {
  it('exposes public standings sorted by rating and leaks no secrets', () => {
    const w = world();
    runTicks(w, data, 20);
    const snap = spectateSnapshot(w, data);
    expect(snap.standings.length).toBe(4);
    for (let i = 1; i < snap.standings.length; i++) {
      expect(snap.standings[i - 1].rating).toBeGreaterThanOrEqual(snap.standings[i].rating);
    }
    const json = JSON.stringify(snap);
    expect(json).not.toContain('relations');
    expect(json).not.toContain('treasury');
    expect(json).not.toContain('agents');
  });
});
