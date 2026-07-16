/**
 * Node-only loader for world balance data (§21.3 constants-in-data). The pure
 * simulation receives a WorldData object; it never reads the filesystem itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RaceDef, WorldData } from './types.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function loadWorldData(): WorldData {
  return JSON.parse(readFileSync(path.join(DATA_DIR, 'world-data.json'), 'utf8')) as WorldData;
}

export function raceById(data: WorldData, id: string): RaceDef {
  const r = data.races.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown race: ${id}`);
  return r;
}
