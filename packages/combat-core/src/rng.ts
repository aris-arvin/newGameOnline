/**
 * Deterministic PRNG (splitmix32).
 *
 * The whole combat engine draws its randomness from this generator so that a
 * battle is fully reproducible from a single 32-bit seed (design prompt §10.3,
 * §10.12). All arithmetic is kept on 32-bit integers via `Math.imul` / `>>> 0`
 * so results are identical across JS engines (Node server + browser/WASM
 * preview, §18.3).
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Normalise to uint32; avoid the degenerate all-zero state.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Raw next uint32 in [0, 2^32). */
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  }

  /** Integer in [0, n). Returns 0 for n <= 0. */
  int(n: number): number {
    if (n <= 0) return 0;
    return this.next() % n;
  }

  /** Inclusive integer in [lo, hi]. */
  range(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability numerator/denominator (integer odds). */
  chance(numerator: number, denominator: number): boolean {
    if (numerator <= 0) return false;
    if (numerator >= denominator) return true;
    return this.int(denominator) < numerator;
  }

  /** Percentage roll: true if a d100 roll (1..100) is <= percent. */
  percent(percent: number): boolean {
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    return this.range(1, 100) <= percent;
  }

  /** Fork a child generator whose stream is derived from (and independent of) this one. */
  fork(salt: number): Rng {
    return new Rng((this.next() ^ Math.imul(salt | 0, 0x9e3779b9)) >>> 0);
  }

  /** Snapshot the internal state (for debugging / serialisation). */
  snapshot(): number {
    return this.state >>> 0;
  }
}
