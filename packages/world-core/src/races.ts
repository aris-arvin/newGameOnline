/**
 * Pure race lookup. Kept separate from the node-only data loader so the engine
 * stays browser-safe (importing this never pulls in `node:fs`).
 */
import type { RaceDef, WorldData } from './types.js';

export function raceById(data: WorldData, id: string): RaceDef {
  const r = data.races.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown race: ${id}`);
  return r;
}
