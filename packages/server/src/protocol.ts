/**
 * Client/server message protocol (design prompt §18.2 WebSocket transport).
 * The server is authoritative: clients send intents (join, commands) and
 * receive snapshots. The public snapshot carries no fog-of-war secrets; the
 * per-player `mine` view is only sent to the owning connection (§18.4).
 */
import type { Snapshot } from '@pure-galaxy/world-core';

export type ClientMessage =
  | { type: 'join'; empireId?: string; token?: string }
  | { type: 'command'; name: string; args?: Record<string, unknown> }
  | { type: 'ping' };

// --- Public galaxy view (static per season) ---
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
/** systemId -> owning empireId (by first colony there). */
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

export type ServerMessage =
  | {
      type: 'welcome';
      empireId: string | null;
      username: string | null;
      tick: number;
      season: number;
      public: Snapshot;
      mine: MineView | null;
      galaxy: GalaxyDto;
      empires: EmpireInfo[];
      ownership: Ownership;
      society: Society;
    }
  | { type: 'snapshot'; tick: number; public: Snapshot; mine: MineView | null; ownership: Ownership; society: Society }
  | { type: 'lobby'; galaxy: GalaxyDto; empires: EmpireInfo[] }
  | { type: 'ack'; name: string; ok: boolean; message: string }
  | { type: 'event'; time: number; kind: string; text: string }
  | { type: 'pong' }
  | { type: 'error'; message: string };
