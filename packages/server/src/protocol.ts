/**
 * Client/server message protocol (design prompt §18.2 WebSocket transport).
 * The server is authoritative: clients send intents (join, commands) and
 * receive snapshots. The public snapshot carries no fog-of-war secrets; the
 * per-player `mine` view is only sent to the owning connection (§18.4).
 */
import type { Snapshot } from '@pure-galaxy/world-core';

export type ClientMessage =
  | { type: 'join'; empireId?: string }
  | { type: 'command'; name: string; args?: Record<string, unknown> }
  | { type: 'ping' };

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
  | { type: 'welcome'; empireId: string | null; tick: number; season: number; public: Snapshot; mine: MineView | null }
  | { type: 'snapshot'; tick: number; public: Snapshot; mine: MineView | null }
  | { type: 'ack'; name: string; ok: boolean; message: string }
  | { type: 'event'; time: number; kind: string; text: string }
  | { type: 'pong' }
  | { type: 'error'; message: string };
