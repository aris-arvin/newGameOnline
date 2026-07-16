/**
 * Node-only loader for the JSON data files (§21.3: all balance constants live in
 * data, not code). The pure engine never imports this — it keeps a filesystem
 * dependency out of the browser bundle.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Catalog } from './catalog.js';
import type { Blueprint, ComponentDef, HullDef } from './types.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8')) as T;
}

export function loadHulls(): HullDef[] {
  return loadJson<HullDef[]>('hulls.json');
}

export function loadComponents(): ComponentDef[] {
  return loadJson<ComponentDef[]>('components.json');
}

export function loadBlueprints(): Blueprint[] {
  return loadJson<Blueprint[]>('blueprints.json');
}

export function loadDefaultCatalog(): Catalog {
  return new Catalog({ hulls: loadHulls(), components: loadComponents() });
}

/** Blueprints keyed by id, for convenient scenario construction. */
export function loadBlueprintMap(): Map<string, Blueprint> {
  const m = new Map<string, Blueprint>();
  for (const bp of loadBlueprints()) m.set(bp.id, bp);
  return m;
}
