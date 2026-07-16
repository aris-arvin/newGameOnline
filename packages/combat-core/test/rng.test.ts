import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('int() stays within [0, n)', () => {
    const r = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('range() is inclusive on both ends', () => {
    const r = new Rng(7);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const v = r.range(3, 6);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBe(3);
    expect(hi).toBe(6);
  });

  it('percent() is roughly calibrated', () => {
    const r = new Rng(42);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (r.percent(30)) hits++;
    const rate = (hits * 100) / n;
    expect(rate).toBeGreaterThan(26);
    expect(rate).toBeLessThan(34);
  });

  it('emits only uint32 values', () => {
    const r = new Rng(0); // exercises the zero-seed guard
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
