/**
 * Player command registry (design prompt §2.1 server-authoritative, §18.4).
 * Every command is validated against the acting player's empire before it may
 * mutate the authoritative world. Unknown commands and cross-empire attempts
 * are rejected.
 */
import { Rng } from '@pure-galaxy/shared';
import {
  admiralForFleet,
  assignAdmiral,
  createFleet,
  dispatchExpedition,
  findPath,
  habitability,
  recruitAdmiral,
} from '@pure-galaxy/world-core';
import type { WorldData, WorldState } from '@pure-galaxy/world-core';

export interface CommandContext {
  world: WorldState;
  data: WorldData;
  empireId: string;
  args: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  message: string;
}

export type CommandHandler = (ctx: CommandContext) => CommandResult;

export const COMMANDS: Record<string, CommandHandler> = {
  set_research: ({ world, empireId, args }) => {
    const e = world.empires[empireId];
    const physics = Math.max(0, Math.floor(Number(args.physics ?? 50)));
    const economics = Math.max(0, Math.floor(Number(args.economics ?? 50)));
    if (physics + economics <= 0) return { ok: false, message: 'sliders must be positive' };
    e.researchSliders = { physics, economics };
    return { ok: true, message: `research sliders set to ${physics}/${economics}` };
  },

  set_governor: ({ world, empireId, args }) => {
    const colonyId = String(args.colonyId ?? '');
    const plan = String(args.plan ?? 'balanced');
    const colony = world.colonies[colonyId];
    if (!colony || colony.empireId !== empireId) return { ok: false, message: 'not your colony' };
    colony.governor = plan;
    return { ok: true, message: `governor of ${colonyId} set to ${plan}` };
  },

  dispatch_expedition: ({ world, data, empireId }) => {
    const ok = dispatchExpedition(world, empireId, data);
    return { ok, message: ok ? 'expedition launched' : 'cannot launch (needs credits/research, or one is already running)' };
  },

  recruit_admiral: ({ world, data, empireId }) => {
    const rng = new Rng((world.seed ^ Math.imul(world.nextId, 0x9e3779b1)) >>> 0);
    const admiral = recruitAdmiral(world, empireId, data, rng);
    if (!admiral) return { ok: false, message: 'not enough credits' };
    const fleetId = world.empires[empireId].fleetIds.find((fid) => world.fleets[fid] && !admiralForFleet(world, fid));
    if (fleetId) assignAdmiral(world, admiral.id, fleetId);
    return { ok: true, message: `recruited ${admiral.name}${fleetId ? ' (assigned to a fleet)' : ''}` };
  },

  colonize: ({ world, data, empireId }) => {
    const e = world.empires[empireId];
    const home = world.colonies[e.colonyIds[0]];
    if (!home) return { ok: false, message: 'no home colony' };
    const homeSys = world.galaxy.planets[home.planetId].systemId;
    const race = data.races.find((r) => r.id === e.raceId);
    if (!race) return { ok: false, message: 'unknown race' };

    const owned = new Set(Object.values(world.colonies).map((c) => c.planetId));
    let target: { pid: string; sys: string } | null = null;
    const seen = new Set([homeSys]);
    const queue = [homeSys];
    while (queue.length && !target) {
      const sys = queue.shift()!;
      for (const pid of world.galaxy.systems[sys].planetIds) {
        if (!owned.has(pid) && habitability(world.galaxy.planets[pid], race, data) >= 30) {
          target = { pid, sys };
          break;
        }
      }
      for (const lane of world.galaxy.lanes[sys] ?? []) if (!seen.has(lane.to)) (seen.add(lane.to), queue.push(lane.to));
    }
    if (!target) return { ok: false, message: 'no habitable target found' };

    const enRoute = Object.values(world.fleets).some(
      (f) => f.empireId === empireId && f.order?.type === 'colonize' && f.order.targetPlanetId === target!.pid,
    );
    if (enRoute) return { ok: false, message: 'a colony fleet is already en route' };

    const fleet = createFleet(world, empireId, homeSys, [
      { role: 'colony', power: 0 },
      { role: 'warship', power: 12 },
    ]);
    fleet.order = { type: 'colonize', path: findPath(world.galaxy, homeSys, target.sys), legProgress: 0, targetPlanetId: target.pid };
    return { ok: true, message: `colony fleet dispatched to ${world.galaxy.planets[target.pid].name}` };
  },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
