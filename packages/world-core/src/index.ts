/**
 * @pure-galaxy/world-core — deterministic Phase-0 world simulation.
 *
 * Pure engine (no filesystem): galaxy, colonies, economy, science, fleets, and
 * the world tick. The Node-only data loader lives in `./data.js`.
 */
export * from './types.js';
export * from './galaxy.js';
export * from './colony.js';
export * from './science.js';
export * from './governor.js';
export * from './economy.js';
export * from './fleet.js';
export * from './diplomacy.js';
export * from './protection.js';
export * from './market.js';
export * from './espionage.js';
export * from './piracy.js';
export * from './world.js';
