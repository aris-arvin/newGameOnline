/**
 * Re-export of the shared deterministic PRNG so the combat engine and the world
 * simulation draw from the exact same generator (design prompt §10.12, §18.3).
 */
export { Rng } from '@pure-galaxy/shared';
