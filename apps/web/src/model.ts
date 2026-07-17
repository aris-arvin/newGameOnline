/**
 * A single view-model that both modes render: the local in-browser sandbox and
 * the live authoritative server produce the same `GameView`, so the UI code is
 * identical whether the simulation runs here or on the server.
 *
 * The DTO shapes mirror `@pure-galaxy/server`'s protocol (kept in sync by hand
 * to avoid a client->server package dependency).
 */
import type { Snapshot, WorldState } from '@pure-galaxy/world-core';
import { spectateSnapshot, worldData } from './engine';

export interface PlanetDto {
  id: string;
  name: string;
  biome: string;
  gravity: string;
  size: number;
  richness: number;
  belt: number;
  ruins: boolean;
}
export interface SystemDto {
  id: string;
  name: string;
  sectorId: string;
  x: number;
  y: number;
  planets: PlanetDto[];
}
export interface GalaxyDto {
  systems: SystemDto[];
  lanes: { from: string; to: string }[];
}
export interface EmpireInfo {
  id: string;
  name: string;
}
export type Ownership = Record<string, string>;
export interface Society {
  treaties: number;
  agents: number;
  admirals: number;
}
export interface MineView {
  empireId: string;
  name: string;
  credits: number;
  focus: number;
  research: Record<string, number>;
  researchSliders: Record<string, number>;
  unlockedTechs: string[];
  treasury: Record<string, number>;
  colonies: { id: string; planet: string; population: number; governor: string; regions: { spec: string; level: number }[] }[];
  fleets: { id: string; systemId: string; ships: number; order: string | null }[];
  agents: number;
  admirals: number;
  expeditionsDone: number;
}
export interface GameEvent {
  time: number;
  kind: string;
  text: string;
}

export interface GameView {
  empires: EmpireInfo[];
  galaxy: GalaxyDto;
  ownership: Ownership;
  snapshot: Snapshot;
  mine: MineView | null;
  society: Society;
  events: GameEvent[];
}

/** Build a GameView from a local in-browser world (sandbox mode). */
export function localGameView(world: WorldState): GameView {
  const g = world.galaxy;
  const empires: EmpireInfo[] = Object.keys(world.empires)
    .filter((id) => !world.empires[id].pirate && !world.empires[id].ancient)
    .sort()
    .map((id) => ({ id, name: world.empires[id].name }));

  const systems: SystemDto[] = Object.values(g.systems).map((s) => ({
    id: s.id,
    name: s.name,
    sectorId: s.sectorId,
    x: s.x,
    y: s.y,
    planets: s.planetIds.map((pid) => {
      const p = g.planets[pid];
      return { id: p.id, name: p.name, biome: p.biome, gravity: p.gravity, size: p.size, richness: p.richness, belt: p.belt, ruins: p.ruins };
    }),
  }));

  const seen = new Set<string>();
  const lanes: { from: string; to: string }[] = [];
  for (const [from, ls] of Object.entries(g.lanes)) {
    for (const lane of ls) {
      const key = from < lane.to ? `${from}|${lane.to}` : `${lane.to}|${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lanes.push({ from, to: lane.to });
    }
  }

  const ownership: Ownership = {};
  for (const c of Object.values(world.colonies)) {
    const sys = g.planets[c.planetId]?.systemId;
    if (sys && !(sys in ownership)) ownership[sys] = c.empireId;
  }

  return {
    empires,
    galaxy: { systems, lanes },
    ownership,
    snapshot: spectateSnapshot(world, worldData),
    mine: null,
    society: {
      treaties: world.treaties.length,
      agents: Object.keys(world.agents).length,
      admirals: Object.keys(world.admirals).length,
    },
    events: world.log.slice(-14).map((e) => ({ time: e.time, kind: e.kind, text: e.text })),
  };
}
