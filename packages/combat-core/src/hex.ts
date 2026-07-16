/**
 * Axial hex geometry for the tactical battle map (design prompt §10.2).
 *
 * Uses axial coordinates (q, r) with cube (x = q, z = r, y = -x - z) helpers for
 * distance and direction. Directions are indexed 0..5; index 0 points toward +q.
 * Everything here is pure and integer-only, hence deterministic.
 */

export interface Hex {
  q: number;
  r: number;
}

/** The six axial neighbour offsets, in direction order 0..5. */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: +1, r: 0 },
  { q: +1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: +1 },
  { q: 0, r: +1 },
] as const;

/** Cube-space vectors matching HEX_DIRECTIONS, for dot-product direction picking. */
const DIRECTION_CUBE: readonly [number, number, number][] = HEX_DIRECTIONS.map((d) => {
  const x = d.q;
  const z = d.r;
  const y = -x - z;
  return [x, y, z] as [number, number, number];
});

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexKey(a: Hex): string {
  return `${a.q},${a.r}`;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** Neighbour in the given direction (0..5). */
export function hexNeighbor(a: Hex, direction: number): Hex {
  const d = HEX_DIRECTIONS[((direction % 6) + 6) % 6];
  return hexAdd(a, d);
}

/** Hex (Manhattan-on-cube) distance. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/**
 * Best-matching direction index (0..5) pointing from `a` toward `b`.
 * Ties break toward the lowest index for determinism. Returns 0 for a == b.
 */
export function hexDirectionTo(a: Hex, b: Hex): number {
  const dx = b.q - a.q;
  const dz = b.r - a.r;
  const dy = -dx - dz;
  if (dx === 0 && dz === 0) return 0;
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const [cx, cy, cz] = DIRECTION_CUBE[i];
    const dot = dx * cx + dy * cy + dz * cz;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

/** All hexes within `radius` of the centre (inclusive), in a stable order. */
export function hexesInRange(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const rLo = Math.max(-radius, -dq - radius);
    const rHi = Math.min(radius, -dq + radius);
    for (let dr = rLo; dr <= rHi; dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

/** Relative direction of `to` as seen from a unit facing `facing` (result 0..5). */
export function relativeDirection(facing: number, absoluteDirection: number): number {
  return ((absoluteDirection - facing) % 6 + 6) % 6;
}
