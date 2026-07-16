/**
 * Empire rating and newbie protection (design prompt §14.1). A young or weak
 * empire is shielded from attacks and piracy; protection lifts once it crosses
 * the rating threshold OR the grace period ends — whichever comes first.
 */
import type { Empire, WorldData, WorldState } from './types.js';

/** A rough power score: population + development + fleets (§11.3 senate-weight-ish). */
export function empireRating(world: WorldState, empire: Empire): number {
  let pop = 0;
  let levels = 0;
  for (const cid of empire.colonyIds) {
    const c = world.colonies[cid];
    if (!c) continue;
    pop += c.population;
    for (const r of c.regions) levels += r.level;
  }
  let fleetPower = 0;
  for (const fid of empire.fleetIds) {
    const f = world.fleets[fid];
    if (f) for (const s of f.ships) fleetPower += s.power;
  }
  return pop * 4 + levels * 15 + fleetPower * 2 + empire.colonyIds.length * 50;
}

/** True while the empire still enjoys newbie protection. */
export function isProtected(world: WorldState, empire: Empire, data: WorldData): boolean {
  if (empire.pirate) return false;
  const age = world.time - empire.foundedTick;
  if (age >= data.protection.graceTicks) return false;
  return empireRating(world, empire) < data.protection.ratingThreshold;
}

/** Detect empires whose protection lifted this tick (for events/tutorial). */
export function protectionStep(world: WorldState, data: WorldData): void {
  for (const id of Object.keys(world.empires).sort()) {
    const e = world.empires[id];
    if (e.pirate) continue;
    const age = world.time - e.foundedTick;
    const protectedNow = isProtected(world, e, data);
    // Log the transition exactly once, when age first reaches the grace edge
    // or rating first crosses the threshold.
    if (!protectedNow && (age === data.protection.graceTicks || (age < data.protection.graceTicks && empireRating(world, e) >= data.protection.ratingThreshold && age > 0))) {
      const already = world.log.some((l) => l.kind === 'protection' && l.text.includes(e.name));
      if (!already) {
        world.log.push({ time: world.time, kind: 'protection', text: `${e.name} exits newbie protection` });
      }
    }
  }
}
