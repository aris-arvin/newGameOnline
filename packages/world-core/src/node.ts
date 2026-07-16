/**
 * Node-only helpers. Kept out of the package index so the main entry stays
 * browser-safe; this module pulls in combat-core's filesystem data loader.
 */
import { loadDefaultCatalog, loadBlueprintMap } from '@pure-galaxy/combat-core/data';
import { createTacticalResolver } from './battle-bridge.js';
import type { BattleResolver } from './fleet.js';

/** A tactical battle resolver built from the shipped combat JSON data. */
export function nodeTacticalResolver(): BattleResolver {
  return createTacticalResolver(loadDefaultCatalog(), loadBlueprintMap());
}
