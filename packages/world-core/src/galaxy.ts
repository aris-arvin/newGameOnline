/**
 * Procedural galaxy generation (design prompt §3): sectors of star systems,
 * each with planets (biome, gravity, size, richness, belts, ruins) and a
 * connected hyperlane graph. Fully deterministic from a seed.
 */
import { Rng } from '@pure-galaxy/shared';
import type { Biome, Galaxy, Gravity, Lane, Planet, Sector, StarSystem } from './types.js';

export interface GalaxyGenConfig {
  sectors: number;
  systemsPerSector: number;
  laneNeighbors: number;
}

export const DEFAULT_GALAXY: GalaxyGenConfig = {
  sectors: 6,
  systemsPerSector: 5,
  laneNeighbors: 3,
};

const BIOMES: Biome[] = ['terra', 'ocean', 'tundra', 'desert', 'toxic', 'lava', 'barren'];
const GRAVITIES: Gravity[] = ['low', 'normal', 'high'];
const SYLLABLES = ['ka', 'zor', 'vel', 'mi', 'tor', 'an', 'rus', 'lyr', 'xen', 'dro', 'sol', 'nix', 'qua', 'bel', 'orn'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function systemName(rng: Rng): string {
  const a = SYLLABLES[rng.int(SYLLABLES.length)];
  const b = SYLLABLES[rng.int(SYLLABLES.length)];
  const n = rng.range(1, 999);
  return `${a[0].toUpperCase()}${a.slice(1)}${b}-${n}`;
}

function regionSlotsForSize(size: number): number {
  return Math.max(3, Math.min(12, Math.round(size * 1.2)));
}

function makePlanet(rng: Rng, systemId: string, index: number, name: string): Planet {
  const size = rng.range(1, 10);
  const biome = BIOMES[rng.int(BIOMES.length)];
  const gravity = GRAVITIES[rng.int(GRAVITIES.length)];
  const richness = rng.range(1, 5);
  const belt = rng.percent(35) ? rng.range(1, 5) : 0;
  const ruins = rng.percent(12);
  return {
    id: `${systemId}-p${index}`,
    systemId,
    name: `${name} ${ROMAN[index] ?? index + 1}`,
    size,
    biome,
    gravity,
    richness,
    belt,
    ruins,
    regionSlots: regionSlotsForSize(size),
  };
}

/** Euclidean distance rounded into a hyperlane travel cost (>= 2). */
function laneCost(a: StarSystem, b: StarSystem): number {
  const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  return Math.max(2, Math.round(d / 120));
}

export function generateGalaxy(seed: number, config: GalaxyGenConfig = DEFAULT_GALAXY): Galaxy {
  const rng = new Rng((seed ^ 0x6c0ffee) >>> 0);
  const sectors: Sector[] = [];
  const systems: Record<string, StarSystem> = {};
  const planets: Record<string, Planet> = {};
  const systemList: StarSystem[] = [];

  for (let s = 0; s < config.sectors; s++) {
    const sectorId = `sec${s}`;
    const sector: Sector = { id: sectorId, name: `Sector ${s + 1}`, systemIds: [] };
    for (let k = 0; k < config.systemsPerSector; k++) {
      const sysId = `${sectorId}-sys${k}`;
      const name = systemName(rng);
      const sys: StarSystem = {
        id: sysId,
        name,
        sectorId,
        x: rng.range(0, 1000),
        y: rng.range(0, 1000),
        planetIds: [],
      };
      const planetCount = rng.range(1, 5);
      for (let p = 0; p < planetCount; p++) {
        const planet = makePlanet(rng, sysId, p, name);
        planets[planet.id] = planet;
        sys.planetIds.push(planet.id);
      }
      systems[sysId] = sys;
      systemList.push(sys);
      sector.systemIds.push(sysId);
    }
    sectors.push(sector);
  }

  const lanes = buildLanes(systemList, config.laneNeighbors);

  return { sectors, systems, planets, lanes };
}

/** K-nearest-neighbour lanes unioned with an MST so the whole map is connected. */
function buildLanes(systemList: StarSystem[], k: number): Record<string, Lane[]> {
  const lanes: Record<string, Lane[]> = {};
  for (const s of systemList) lanes[s.id] = [];
  const addEdge = (a: StarSystem, b: StarSystem): void => {
    const dist = laneCost(a, b);
    if (!lanes[a.id].some((l) => l.to === b.id)) lanes[a.id].push({ to: b.id, dist });
    if (!lanes[b.id].some((l) => l.to === a.id)) lanes[b.id].push({ to: a.id, dist });
  };

  // KNN edges.
  for (const a of systemList) {
    const others = systemList
      .filter((b) => b.id !== a.id)
      .map((b) => ({ b, d: laneCost(a, b) }))
      .sort((x, y) => x.d - y.d || (x.b.id < y.b.id ? -1 : 1));
    for (let i = 0; i < Math.min(k, others.length); i++) addEdge(a, others[i].b);
  }

  // MST (Kruskal) for guaranteed connectivity.
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const s of systemList) parent[s.id] = s.id;
  const edges: { a: StarSystem; b: StarSystem; d: number }[] = [];
  for (let i = 0; i < systemList.length; i++) {
    for (let j = i + 1; j < systemList.length; j++) {
      edges.push({ a: systemList[i], b: systemList[j], d: laneCost(systemList[i], systemList[j]) });
    }
  }
  edges.sort((x, y) => x.d - y.d || (x.a.id < y.a.id ? -1 : 1));
  for (const e of edges) {
    const ra = find(e.a.id);
    const rb = find(e.b.id);
    if (ra !== rb) {
      parent[ra] = rb;
      addEdge(e.a, e.b);
    }
  }

  // Stable ordering of each adjacency list.
  for (const id of Object.keys(lanes)) lanes[id].sort((x, y) => x.dist - y.dist || (x.to < y.to ? -1 : 1));
  return lanes;
}

export function laneDistance(galaxy: Galaxy, from: string, to: string): number {
  const lane = galaxy.lanes[from]?.find((l) => l.to === to);
  return lane ? lane.dist : Number.POSITIVE_INFINITY;
}

/** Breadth-first shortest hyperlane path (by hop count) between two systems. */
export function findPath(galaxy: Galaxy, from: string, to: string): string[] {
  if (from === to) return [];
  const queue: string[] = [from];
  const prev: Record<string, string | null> = { [from]: null };
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const lane of galaxy.lanes[cur] ?? []) {
      if (!(lane.to in prev)) {
        prev[lane.to] = cur;
        queue.push(lane.to);
      }
    }
  }
  if (!(to in prev)) return [];
  const path: string[] = [];
  let node: string | null = to;
  while (node !== null && node !== from) {
    path.unshift(node);
    node = prev[node] ?? null;
  }
  return path;
}
