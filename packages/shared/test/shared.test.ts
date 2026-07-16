import { describe, it, expect } from 'vitest';
import { Rng, stableStringify, hashValue } from '../src/index.js';

describe('shared Rng', () => {
  it('same seed reproduces the same stream', () => {
    const a = new Rng(2024);
    const b = new Rng(2024);
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(
      Array.from({ length: 50 }, () => b.next()),
    );
  });

  it('fork produces an independent but deterministic stream', () => {
    const parent1 = new Rng(1);
    const parent2 = new Rng(1);
    const c1 = parent1.fork(9).next();
    const c2 = parent2.fork(9).next();
    expect(c1).toBe(c2);
  });
});

describe('shared hashing', () => {
  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('hashValue is stable and differs for different content', () => {
    expect(hashValue({ x: 1 })).toBe(hashValue({ x: 1 }));
    expect(hashValue({ x: 1 })).not.toBe(hashValue({ x: 2 }));
  });
});
