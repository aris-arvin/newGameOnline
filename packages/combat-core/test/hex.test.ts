import { describe, it, expect } from 'vitest';
import {
  hex,
  hexDistance,
  hexNeighbor,
  hexDirectionTo,
  relativeDirection,
  hexesInRange,
  HEX_DIRECTIONS,
} from '../src/hex.js';

describe('hex geometry', () => {
  it('distance is zero to self and symmetric', () => {
    const a = hex(2, -3);
    const b = hex(-1, 4);
    expect(hexDistance(a, a)).toBe(0);
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });

  it('each neighbour is exactly distance 1', () => {
    const c = hex(0, 0);
    for (let d = 0; d < 6; d++) {
      expect(hexDistance(c, hexNeighbor(c, d))).toBe(1);
    }
  });

  it('direction to a neighbour matches the neighbour index', () => {
    const c = hex(3, 3);
    for (let d = 0; d < 6; d++) {
      const n = hexNeighbor(c, d);
      expect(hexDirectionTo(c, n)).toBe(d);
    }
  });

  it('relativeDirection wraps into 0..5', () => {
    expect(relativeDirection(0, 0)).toBe(0);
    expect(relativeDirection(2, 0)).toBe(4);
    expect(relativeDirection(5, 1)).toBe(2);
  });

  it('hexesInRange has the right count', () => {
    // A hex disk of radius R has 3R(R+1)+1 hexes.
    for (const R of [0, 1, 2, 3]) {
      expect(hexesInRange(hex(0, 0), R).length).toBe(3 * R * (R + 1) + 1);
    }
  });

  it('direction offsets round-trip through neighbour', () => {
    const c = hex(-2, 5);
    HEX_DIRECTIONS.forEach((_, d) => {
      const n = hexNeighbor(c, d);
      expect(hexDistance(c, n)).toBe(1);
    });
  });
});
