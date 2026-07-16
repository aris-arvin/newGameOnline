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

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  trigger: string;
}

export interface Tutorial {
  id: string;
  title: string;
  note: string;
  steps: TutorialStep[];
}

/** Client-facing onboarding content (§17); the sim emits the trigger events. */
export function loadTutorial(): Tutorial {
  return JSON.parse(readFileSync(path.join(DATA_DIR, 'tutorial.json'), 'utf8')) as Tutorial;
}

export function raceById(data: WorldData, id: string): RaceDef {
  const r = data.races.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown race: ${id}`);
  return r;
}
