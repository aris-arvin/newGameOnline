/**
 * Archaeology & artifacts (design prompt §13). Colonies on planets with ruins
 * slowly excavate; each artifact recovered yields credits, and a fraction are
 * "Ancient devices" that grant a lasting boost (here a research windfall).
 */
import { Rng } from '@pure-galaxy/shared';
import type { WorldData, WorldState } from './types.js';

export function archaeologyStep(world: WorldState, data: WorldData, rng: Rng): void {
  const cfg = data.archaeology;
  for (const eid of Object.keys(world.empires).sort()) {
    const empire = world.empires[eid];
    if (empire.pirate || empire.ancient) continue;
    for (const cid of empire.colonyIds) {
      const colony = world.colonies[cid];
      if (!colony) continue;
      const planet = world.galaxy.planets[colony.planetId];
      if (!planet.ruins) continue;

      // Science districts dig faster.
      const sci = colony.regions.some((r) => r.spec === 'science') ? 2 : 1;
      colony.excavation = (colony.excavation ?? 0) + cfg.excavationPerTick * sci;

      if (colony.excavation >= cfg.artifactThreshold) {
        colony.excavation -= cfg.artifactThreshold;
        empire.artifacts += 1;
        const r = rng.fork(hashStr(cid) ^ world.time);
        if (r.percent(cfg.deviceChancePct)) {
          empire.research.physics += 40;
          empire.research.economics += 40;
          world.log.push({ time: world.time, kind: 'artifact', text: `${empire.name} activated an Ancient Device on ${planet.name}` });
        } else {
          empire.credits += cfg.creditReward;
          world.log.push({ time: world.time, kind: 'artifact', text: `${empire.name} recovered an artifact on ${planet.name}` });
        }
      }
    }
  }
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0;
}
