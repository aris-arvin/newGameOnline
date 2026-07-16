/**
 * Season victory conditions (design prompt §15). Four equal paths:
 *  - diplomatic: hold the Senate presidency two terms running (§11.3),
 *  - science: complete all Gate expeditions (§13),
 *  - military: control >= X% of sectors for a sustained period,
 *  - economic: hold >= Y% of galactic trade turnover for a sustained period.
 * The first empire to satisfy any path is recorded as the season's victor.
 */
import type { Victor, WorldData, WorldState } from './types.js';

function citizens(world: WorldState): string[] {
  return Object.keys(world.empires)
    .filter((id) => !world.empires[id].pirate && !world.empires[id].ancient)
    .sort();
}

/** Fraction (percent) of sectors in which the empire owns the most colonies. */
export function sectorControlPct(world: WorldState, empireId: string): number {
  const sectors = world.galaxy.sectors;
  if (sectors.length === 0) return 0;
  let controlled = 0;
  for (const sector of sectors) {
    const counts: Record<string, number> = {};
    for (const sysId of sector.systemIds) {
      for (const pid of world.galaxy.systems[sysId].planetIds) {
        const colony = Object.values(world.colonies).find((c) => c.planetId === pid);
        if (colony) counts[colony.empireId] = (counts[colony.empireId] ?? 0) + 1;
      }
    }
    let leader = '';
    let best = 0;
    for (const [id, n] of Object.entries(counts)) {
      if (n > best) {
        best = n;
        leader = id;
      }
    }
    if (leader === empireId && best > 0) controlled++;
  }
  return Math.floor((controlled * 100) / sectors.length);
}

export function galacticTradeVolume(world: WorldState): number {
  let total = 0;
  for (const id of citizens(world)) total += world.empires[id].tradeVolume;
  return total;
}

/** Fraction (percent) of cumulative galactic trade turnover held by the empire. */
export function tradeSharePct(world: WorldState, empireId: string): number {
  const total = galacticTradeVolume(world);
  if (total <= 0) return 0;
  return Math.floor((world.empires[empireId].tradeVolume * 100) / total);
}

export function checkVictory(world: WorldState, data: WorldData): void {
  if (world.victor) return;
  const set = (empireId: string, reason: Victor['reason']): void => {
    world.victor = { empireId, reason, time: world.time };
    world.log.push({ time: world.time, kind: 'victory', text: `${world.empires[empireId]?.name ?? empireId} achieves a ${reason} victory!` });
  };

  // Diplomatic.
  if (world.senate.consecutiveTerms >= 2 && world.senate.president) {
    set(world.senate.president, 'diplomatic');
    return;
  }

  const ids = citizens(world);

  // Science.
  for (const id of ids) {
    if (world.empires[id].expeditionsDone >= data.expeditions.count) {
      set(id, 'science');
      return;
    }
  }

  // Military & economic, both requiring a sustained hold.
  for (const id of ids) {
    if (sectorControlPct(world, id) >= data.victory.militarySectorPct) {
      world.holds.military[id] = (world.holds.military[id] ?? 0) + 1;
      if (world.holds.military[id] >= data.victory.militaryHoldTicks) {
        set(id, 'military');
        return;
      }
    } else {
      world.holds.military[id] = 0;
    }

    const marketMature = galacticTradeVolume(world) >= data.victory.economicMinVolume;
    if (marketMature && tradeSharePct(world, id) >= data.victory.economicSharePct) {
      world.holds.economic[id] = (world.holds.economic[id] ?? 0) + 1;
      if (world.holds.economic[id] >= data.victory.economicHoldTicks) {
        set(id, 'economic');
        return;
      }
    } else {
      world.holds.economic[id] = 0;
    }
  }
}
