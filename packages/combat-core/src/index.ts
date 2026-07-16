/**
 * @pure-galaxy/combat-core — deterministic WEGO tactical combat engine.
 *
 * This barrel re-exports the pure (dependency-free) engine so it can be bundled
 * for the browser/WASM preview (design prompt §18.3). The Node-only data loader
 * lives in `./data.js` and is imported directly where a filesystem is available.
 */
export * from './rng.js';
export * from './hex.js';
export * from './types.js';
export * from './catalog.js';
export * from './blueprint.js';
export * from './doctrine.js';
export * from './log.js';
export * from './battle.js';
