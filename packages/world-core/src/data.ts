/**
 * Node-only loader for world balance data (§21.3 constants-in-data). The pure
 * simulation receives a WorldData object; it never reads the filesystem itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { WorldData } from './types.js';
import type { Entitlement } from './monetization.js';

// Re-exported for node callers (tests/CLI); the pure definition lives in races.ts.
export { raceById } from './races.js';

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

/** Honest-F2P entitlement catalog (§19). */
export function loadMonetization(): { note: string; entitlements: Entitlement[] } {
  return JSON.parse(readFileSync(path.join(DATA_DIR, 'monetization.json'), 'utf8')) as {
    note: string;
    entitlements: Entitlement[];
  };
}
