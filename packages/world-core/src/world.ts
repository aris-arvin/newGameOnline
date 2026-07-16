/**
 * The world aggregate and the deterministic economic tick (design prompt §20
 * Phase-0 acceptance: "экономический тик стабилен"). A tick advances every
 * empire's colonies, science, and fleets by one step. Given the same seed and
 * data, the world state is identical after N ticks on any machine — verified by
 * `worldHash`.
 */
import { Rng, hashValue } from '@pure-galaxy/shared';
import type { Empire, WorldData, WorldState } from './types.js';
import { SCHOOLS } from './types.js';
import { generateGalaxy, DEFAULT_GALAXY, type GalaxyGenConfig } from './galaxy.js';
import { createHomeColony, habitability } from './colony.js';
import { raceById } from './data.js';
import { governorStep } from './governor.js';
import { economyStep } from './economy.js';
import { accrueResearch, checkTechUnlocks } from './science.js';
import { fleetStep } from './fleet.js';

export interface CreateWorldOptions {
  races?: string[];
  galaxy?: GalaxyGenConfig;
  governor?: string;
}

const LOG_CAP = 400;

export function createWorld(seed: number, data: WorldData, opts: CreateWorldOptions = {}): WorldState {
  const galaxy = generateGalaxy(seed, opts.galaxy ?? DEFAULT_GALAXY);
  const raceIds = opts.races ?? data.races.map((r) => r.id);
  const governor = opts.governor ?? 'balanced';

  const world: WorldState = {
    seed,
    time: 0,
    galaxy,
    empires: {},
    colonies: {},
    fleets: {},
    nextId: 1,
    log: [],
  };

  const usedPlanets = new Set<string>();
  const planetIds = Object.keys(galaxy.planets).sort();

  raceIds.forEach((raceId, i) => {
    const race = raceById(data, raceId);
    // Pick the best unused homeworld: habitable AND large enough to develop
    // (a tiny world has too few region slots for a viable capital).
    let bestPlanet = '';
    let bestScore = -1;
    for (const pid of planetIds) {
      if (usedPlanets.has(pid)) continue;
      const p = galaxy.planets[pid];
      const score = habitability(p, race, data) + p.size * 6;
      if (score > bestScore) {
        bestScore = score;
        bestPlanet = pid;
      }
    }
    if (!bestPlanet) return;
    usedPlanets.add(bestPlanet);

    const empireId = `emp${i}`;
    const empire: Empire = {
      id: empireId,
      name: race.name,
      raceId,
      credits: 100,
      focus: 12,
      research: { physics: 0, economics: 0 },
      researchSliders: { physics: 50, economics: 50 },
      unlockedTechs: [],
      colonyIds: [],
      fleetIds: [],
      isNpc: false,
    };
    world.empires[empireId] = empire;

    const colonyId = `col${world.nextId++}`;
    const colony = createHomeColony(colonyId, galaxy.planets[bestPlanet], empireId, governor);
    world.colonies[colonyId] = colony;
    empire.colonyIds.push(colonyId);
  });

  return world;
}

export function tick(world: WorldState, data: WorldData): WorldState {
  const rng = new Rng((world.seed + world.time * 0x9e3779b1) >>> 0);

  for (const empireId of Object.keys(world.empires).sort()) {
    const empire = world.empires[empireId];
    const race = raceById(data, empire.raceId);
    let researchGain = 0;
    let creditGain = 0;

    for (const colonyId of empire.colonyIds) {
      const colony = world.colonies[colonyId];
      if (!colony) continue;
      const planet = world.galaxy.planets[colony.planetId];
      governorStep(colony, planet, data);
      const res = economyStep(colony, planet, empire, race, data, world.time);
      researchGain += res.research;
      creditGain += res.credits;
      for (const e of res.events) world.log.push(e);
    }

    accrueResearch(empire, researchGain, data);
    const unlocked = checkTechUnlocks(empire, data);
    for (const techId of unlocked) {
      const tech = data.techs.find((t) => t.id === techId);
      world.log.push({ time: world.time, kind: 'tech', text: `${empire.name}: ${tech?.name ?? techId} (${tech?.effect ?? ''})` });
    }
    empire.credits += creditGain;
    empire.focus = Math.min(data.economy.focusCap, empire.focus + data.economy.focusRegen);
  }

  for (const e of fleetStep(world, data, rng)) world.log.push(e);

  world.time += 1;
  if (world.log.length > LOG_CAP) world.log = world.log.slice(-LOG_CAP);
  return world;
}

export function runTicks(world: WorldState, data: WorldData, n: number): WorldState {
  for (let i = 0; i < n; i++) tick(world, data);
  return world;
}

/** Deterministic fingerprint of the meaningful world state (excludes the log). */
export function worldHash(world: WorldState): string {
  const projection = {
    time: world.time,
    empires: Object.keys(world.empires)
      .sort()
      .map((id) => {
        const e = world.empires[id];
        return {
          id,
          credits: e.credits,
          focus: e.focus,
          research: SCHOOLS.map((s) => e.research[s]),
          techs: [...e.unlockedTechs].sort(),
          colonies: e.colonyIds.length,
          fleets: e.fleetIds.length,
        };
      }),
    colonies: Object.keys(world.colonies)
      .sort()
      .map((id) => {
        const c = world.colonies[id];
        return {
          id,
          pop: c.population,
          gov: c.governor,
          regions: c.regions.map((r) => [r.spec, r.level]),
          stock: c.stock,
          queue: c.buildQueue.map((o) => [o.kind, o.progress, o.cost]),
        };
      }),
    fleets: Object.keys(world.fleets)
      .sort()
      .map((id) => {
        const f = world.fleets[id];
        return {
          id,
          sys: f.systemId,
          ships: f.ships.map((s) => [s.role, s.power]),
          order: f.order ? { type: f.order.type, path: f.order.path, leg: f.order.legProgress } : null,
        };
      }),
  };
  return hashValue(projection);
}
