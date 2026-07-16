/**
 * The Ancients and their raids (design prompt §13). A powerful NPC faction
 * launches periodic, escalating raids against the strongest colony. A colony's
 * defense = military districts + stationed fleets + admirals. Repelling a raid
 * yields artifacts, credits and reverse-engineered research; a successful raid
 * damages the colony. This is the PvE pressure that rewards a standing defense.
 */
import { Rng } from '@pure-galaxy/shared';
import type { Colony, WorldData, WorldState } from './types.js';
import { makeStock } from './colony.js';
import { fleetPower } from './fleet.js';
import { admiralBonus } from './admiral.js';

export const ANCIENT_EMPIRE = 'empAncient';

export function spawnAncients(world: WorldState, data: WorldData): void {
  if (world.empires[ANCIENT_EMPIRE]) return;
  world.empires[ANCIENT_EMPIRE] = {
    id: ANCIENT_EMPIRE,
    name: 'Древние',
    raceId: data.races[0].id,
    credits: 0,
    focus: 0,
    research: { physics: 0, economics: 0 },
    researchSliders: { physics: 50, economics: 50 },
    unlockedTechs: [],
    colonyIds: [],
    fleetIds: [],
    isNpc: true,
    treasury: makeStock(),
    foundedTick: world.time,
    relations: {},
    counterIntel: 0,
    pirate: false,
    ancient: true,
    artifacts: 0,
    expeditionsDone: 0,
    tradeVolume: 0,
    sanctionedUntil: 0,
    admiralIds: [],
    legacy: 0,
    titles: [],
    legacyBonusPct: 0,
  };
}

/** Colony defense strength: military districts + stationed fleets + admirals. */
export function colonyDefense(world: WorldState, colony: Colony, data: WorldData): number {
  let def = 0;
  for (const r of colony.regions) {
    if (r.spec === 'military') def += (data.regionBase.military.defense ?? 0) * r.level;
  }
  const sys = world.galaxy.planets[colony.planetId].systemId;
  for (const fid of Object.keys(world.fleets).sort()) {
    const f = world.fleets[fid];
    if (f.empireId === colony.empireId && f.systemId === sys) {
      def += fleetPower(f) + admiralBonus(world, f.id, data);
    }
  }
  return def;
}

export function ancientsStep(world: WorldState, data: WorldData, rng: Rng): void {
  if (!world.empires[ANCIENT_EMPIRE]) return;
  const cfg = data.ancients;
  if (world.time < cfg.firstRaidTick) return;
  if ((world.time - cfg.firstRaidTick) % cfg.raidInterval !== 0) return;

  const raidNumber = Math.floor((world.time - cfg.firstRaidTick) / cfg.raidInterval);
  const raidPower = cfg.raidPower + cfg.raidGrowth * raidNumber;

  // Target the strongest (highest-population) player colony.
  let target: Colony | null = null;
  let bestPop = -1;
  for (const eid of Object.keys(world.empires).sort()) {
    const e = world.empires[eid];
    if (e.pirate || e.ancient) continue;
    for (const cid of e.colonyIds) {
      const c = world.colonies[cid];
      if (c && c.population > bestPop) {
        bestPop = c.population;
        target = c;
      }
    }
  }
  if (!target) return;

  const defender = world.empires[target.empireId];
  const planet = world.galaxy.planets[target.planetId];
  const defense = colonyDefense(world, target, data);
  const r = rng.fork(world.time | 0);
  const defRoll = defense * 100 + r.int(defense * 40 + 1);
  const atkRoll = raidPower * 100 + r.int(raidPower * 40 + 1);

  if (defRoll >= atkRoll) {
    defender.artifacts += 1;
    defender.credits += cfg.raidPower;
    defender.research.physics += 30;
    world.log.push({ time: world.time, kind: 'ancients', text: `${defender.name} repelled an Ancient raid at ${planet.name} (reward: artifact + tech)` });
  } else {
    target.population = Math.max(1, Math.floor(target.population * 0.7));
    const developed = target.regions.filter((rg) => rg.level > 0);
    if (developed.length > 0) developed[r.int(developed.length)].level -= 1;
    world.log.push({ time: world.time, kind: 'ancients', text: `Ancient raid devastated ${planet.name}` });
  }
}
