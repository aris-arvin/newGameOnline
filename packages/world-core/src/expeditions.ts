/**
 * Expeditions to the Gates of the Ancients (design prompt §13, the Antaran-X
 * analog). A PvE race of escalating expeditions; completing all of them is the
 * science-expedition victory (§15). An empire's expedition strength comes from
 * its fleets, research, admirals and artifacts.
 */
import { Rng } from '@pure-galaxy/shared';
import type { WorldData, WorldState } from './types.js';
import { fleetPower } from './fleet.js';
import { admiralBonus } from './admiral.js';

export function expeditionStrength(world: WorldState, empireId: string, data: WorldData): number {
  const e = world.empires[empireId];
  if (!e) return 0;
  let fleet = 0;
  for (const fid of e.fleetIds) {
    const f = world.fleets[fid];
    if (f) fleet += fleetPower(f) + admiralBonus(world, f.id, data);
  }
  const science = Math.floor((e.research.physics + e.research.economics) / 5);
  return fleet + science + e.artifacts * 20;
}

/** Begin the empire's next expedition if it can afford and qualify for it. */
export function dispatchExpedition(world: WorldState, empireId: string, data: WorldData): boolean {
  const e = world.empires[empireId];
  const cfg = data.expeditions;
  if (!e || e.expeditionRun || e.expeditionsDone >= cfg.count) return false;
  if (e.credits < cfg.costCredits) return false;
  if (e.research.physics + e.research.economics < cfg.minResearch) return false;
  e.credits -= cfg.costCredits;
  e.expeditionRun = { stage: e.expeditionsDone + 1, progress: 0 };
  world.log.push({ time: world.time, kind: 'expedition', text: `${e.name} launched expedition ${e.expeditionRun.stage}/${cfg.count}` });
  return true;
}

export function expeditionsStep(world: WorldState, data: WorldData, rng: Rng): void {
  const cfg = data.expeditions;
  const ids = Object.keys(world.empires).filter((id) => !world.empires[id].pirate && !world.empires[id].ancient).sort();

  for (const eid of ids) {
    const e = world.empires[eid];
    // AI dispatch.
    if (!e.expeditionRun) {
      const r = rng.fork(hashStr(eid));
      if (e.expeditionsDone < cfg.count && e.credits >= cfg.costCredits && r.percent(20)) {
        dispatchExpedition(world, eid, data);
      }
      continue;
    }

    // Advance and resolve.
    e.expeditionRun.progress++;
    if (e.expeditionRun.progress < cfg.durationTicks) continue;

    const stage = e.expeditionRun.stage;
    const difficulty = cfg.baseDifficulty + cfg.difficultyStep * (stage - 1);
    const strength = expeditionStrength(world, eid, data);
    const r = rng.fork((hashStr(eid) ^ (world.time * 2654435761)) | 0);
    const success = strength * 100 + r.int(strength * 30 + 1) >= difficulty * 100 + r.int(difficulty * 30 + 1);

    if (success) {
      e.expeditionsDone = stage;
      world.log.push({ time: world.time, kind: 'expedition', text: `${e.name} completed expedition ${stage}/${cfg.count}` });
    } else {
      world.log.push({ time: world.time, kind: 'expedition', text: `${e.name}'s expedition ${stage} failed` });
    }
    e.expeditionRun = undefined;
  }
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0;
}
