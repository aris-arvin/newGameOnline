/**
 * The component/hull catalog. Holds the game's data-driven definitions
 * (loaded from JSON, §21.3 "all constants in data files") and offers typed
 * lookups used by the ship-stat compiler and the battle engine.
 */
import type {
  ComponentDef,
  HullDef,
  Mount,
  Blueprint,
  InstalledComponent,
} from './types.js';

/** Firing arc (relative directions 0..5) granted by each mount type (§10.2 facing). */
export const ARC_BY_MOUNT: Record<Mount, number[]> = {
  nose: [5, 0, 1],
  side: [1, 2, 4, 5],
  rear: [2, 3, 4],
  internal: [0, 1, 2, 3, 4, 5],
};

export interface CatalogData {
  hulls: HullDef[];
  components: ComponentDef[];
}

export class Catalog {
  private readonly hulls = new Map<string, HullDef>();
  private readonly components = new Map<string, ComponentDef>();

  constructor(data: CatalogData) {
    for (const h of data.hulls) this.hulls.set(h.id, h);
    for (const c of data.components) this.components.set(c.id, c);
  }

  hull(id: string): HullDef {
    const h = this.hulls.get(id);
    if (!h) throw new Error(`Unknown hull: ${id}`);
    return h;
  }

  component(id: string): ComponentDef {
    const c = this.components.get(id);
    if (!c) throw new Error(`Unknown component: ${id}`);
    return c;
  }

  hasHull(id: string): boolean {
    return this.hulls.has(id);
  }

  hasComponent(id: string): boolean {
    return this.components.has(id);
  }

  /** Convenience builder for tests and data-defined fleets. */
  blueprint(
    id: string,
    name: string,
    hullId: string,
    components: InstalledComponent[],
    race?: string,
  ): Blueprint {
    return { id, name, hullId, race, components };
  }
}
