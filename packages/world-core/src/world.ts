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
import { createHomeColony, habitability, makeStock } from './colony.js';
import { raceById } from './data.js';
import { governorStep } from './governor.js';
import { economyStep } from './economy.js';
import { accrueResearch, checkTechUnlocks } from './science.js';
import { fleetStep } from './fleet.js';
import { diplomacyStep, researchExchangeBonus } from './diplomacy.js';
import { logisticsStep, marketStep, makeMarket } from './market.js';
import { espionageStep } from './espionage.js';
import { piracyStep } from './piracy.js';
import { protectionStep } from './protection.js';
import { makeSenate, senateStep } from './senate.js';
import { archaeologyStep } from './archaeology.js';
import { ancientsStep } from './ancients.js';
import { expeditionsStep } from './expeditions.js';
import { invasionStep } from './invasion.js';
import { checkVictory } from './victory.js';
import { recruitAdmiral, assignAdmiral, admiralForFleet } from './admiral.js';
import { makeSeason, seasonStep, carryLegacy, nextSeasonSeed, seasonCitizens } from './seasons.js';
import { tacticalResolve } from './battle-bridge.js';

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
    treaties: [],
    market: makeMarket(data),
    agents: {},
    senate: makeSenate(data),
    admirals: {},
    galacticFund: 0,
    victor: null,
    holds: { military: {}, economic: {} },
    season: makeSeason(),
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
      treasury: makeStock(),
      foundedTick: 0,
      relations: {},
      counterIntel: 0,
      pirate: false,
      ancient: false,
      artifacts: 0,
      expeditionsDone: 0,
      tradeVolume: 0,
      sanctionedUntil: 0,
      admiralIds: [],
      legacy: 0,
      titles: [],
      legacyBonusPct: 0,
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

    // Research-exchange treaties speed research (a bonus, not full sharing, §11.2).
    const bonus = researchExchangeBonus(world, empireId);
    accrueResearch(empire, Math.floor((researchGain * (100 + bonus)) / 100), data);
    const unlocked = checkTechUnlocks(empire, data);
    for (const techId of unlocked) {
      const tech = data.techs.find((t) => t.id === techId);
      world.log.push({ time: world.time, kind: 'tech', text: `${empire.name}: ${tech?.name ?? techId} (${tech?.effect ?? ''})` });
    }
    empire.credits += creditGain;
    empire.focus = Math.min(data.economy.focusCap, empire.focus + data.economy.focusRegen);
  }

  // --- Society layer (Phase 2) -----------------------------------------
  logisticsStep(world, data);
  marketStep(world, data);
  diplomacyStep(world, data, rng.fork(1));
  espionageStep(world, data, rng.fork(2));
  piracyStep(world, data, rng.fork(3));
  // Fleet movement + combat: hostile encounters are fought tactically via the
  // combat-core bridge (the world<->combat "сшивка").
  for (const e of fleetStep(world, data, rng.fork(4), tacticalResolve)) world.log.push(e);
  protectionStep(world, data);

  // --- Politics & PvE (Phase 3) ----------------------------------------
  senateStep(world, data, rng.fork(5));
  archaeologyStep(world, data, rng.fork(6));
  ancientsStep(world, data, rng.fork(7));
  expeditionsStep(world, data, rng.fork(8));
  invasionStep(world, data);
  admiralAi(world, data, rng.fork(9));
  checkVictory(world, data);
  seasonStep(world, data);

  world.time += 1;
  if (world.log.length > LOG_CAP) world.log = world.log.slice(-LOG_CAP);
  return world;
}

/**
 * Soft restart into the next season (§15): a fresh galaxy that carries each
 * empire's Legacy and head-start forward. The previous world is discarded.
 */
export function startNextSeason(old: WorldState, data: WorldData): WorldState {
  const raceIds = seasonCitizens(old).map((id) => old.empires[id].raceId);
  const fresh = createWorld(nextSeasonSeed(old), data, { races: raceIds });
  carryLegacy(old, fresh);
  return fresh;
}

/** Light AI: wealthy empires with an unled fleet recruit and assign an admiral. */
function admiralAi(world: WorldState, data: WorldData, rng: Rng): void {
  for (const eid of Object.keys(world.empires).sort()) {
    const e = world.empires[eid];
    if (e.pirate || e.ancient || e.fleetIds.length === 0) continue;
    if (e.credits < data.admirals.cost * 3) continue;
    const unled = e.fleetIds.find((fid) => world.fleets[fid] && !admiralForFleet(world, fid));
    if (!unled) continue;
    const r = rng.fork(eid.length * 31 + world.time);
    if (r.percent(15)) {
      const admiral = recruitAdmiral(world, eid, data, r);
      if (admiral) assignAdmiral(world, admiral.id, unled);
    }
  }
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
          treasury: e.treasury,
          relations: e.relations,
          artifacts: e.artifacts,
          expeditionsDone: e.expeditionsDone,
          tradeVolume: e.tradeVolume,
          sanctionedUntil: e.sanctionedUntil,
          admirals: e.admiralIds.length,
          expeditionRun: e.expeditionRun ?? null,
          legacy: e.legacy,
          legacyBonusPct: e.legacyBonusPct,
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
          cargo: f.cargo ?? null,
        };
      }),
    treaties: [...world.treaties]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((t) => [t.a, t.b, t.type]),
    prices: world.market.prices,
    agents: Object.keys(world.agents)
      .sort()
      .map((id) => {
        const a = world.agents[id];
        return { id, e: a.empireId, t: a.targetEmpireId ?? '', m: a.mission ?? '', p: a.progress, cd: a.cooldown, lvl: a.level };
      }),
    senate: {
      president: world.senate.president ?? '',
      terms: world.senate.termCount,
      streak: world.senate.consecutiveTerms,
    },
    admirals: Object.keys(world.admirals)
      .sort()
      .map((id) => {
        const a = world.admirals[id];
        return { id, e: a.empireId, lvl: a.level, spec: a.spec, f: a.fleetId ?? '' };
      }),
    colonyExtras: Object.keys(world.colonies)
      .sort()
      .map((id) => [id, world.colonies[id].empireId, world.colonies[id].unrest ?? 0, Math.floor(world.colonies[id].excavation ?? 0)]),
    victor: world.victor ? [world.victor.empireId, world.victor.reason] : null,
  };
  return hashValue(projection);
}
