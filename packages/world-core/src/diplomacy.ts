/**
 * Diplomacy: treaties, relations, and light AI diplomacy (design prompt §11).
 * `areHostile` ties this layer into combat — allied empires don't auto-battle,
 * and the pirate faction is hostile to everyone (§14.4). `research_exchange`
 * treaties speed research (§11.2), a bonus (not full tech sharing — the SF fix).
 */
import { Rng } from '@pure-galaxy/shared';
import type { Treaty, TreatyType, WorldData, WorldState } from './types.js';

/** Treaty types that make two empires refuse to fight each other. */
const PEACE_TREATIES: TreatyType[] = ['nonaggression', 'defensive', 'military', 'vassal'];

export function hasTreaty(world: WorldState, a: string, b: string, type?: TreatyType): boolean {
  return world.treaties.some(
    (t) =>
      ((t.a === a && t.b === b) || (t.a === b && t.b === a)) && (type === undefined || t.type === type),
  );
}

export function addTreaty(world: WorldState, a: string, b: string, type: TreatyType): Treaty | null {
  if (a === b || hasTreaty(world, a, b, type)) return null;
  const [x, y] = a < b ? [a, b] : [b, a];
  const treaty: Treaty = { id: `tr${world.nextId++}`, a: x, b: y, type, since: world.time };
  world.treaties.push(treaty);
  return treaty;
}

export function breakTreaty(world: WorldState, a: string, b: string, type: TreatyType): boolean {
  const before = world.treaties.length;
  world.treaties = world.treaties.filter(
    (t) => !(((t.a === a && t.b === b) || (t.a === b && t.b === a)) && t.type === type),
  );
  // Breaking a treaty damages relations (§11.1).
  if (world.treaties.length < before) {
    adjustRelations(world, a, b, -30);
    return true;
  }
  return false;
}

export function areAllied(world: WorldState, a: string, b: string): boolean {
  return PEACE_TREATIES.some((t) => hasTreaty(world, a, b, t));
}

export function areHostile(world: WorldState, a: string, b: string): boolean {
  if (a === b) return false;
  const ea = world.empires[a];
  const eb = world.empires[b];
  if (!ea || !eb) return false;
  if (ea.pirate || eb.pirate) return true;
  return !areAllied(world, a, b);
}

export function adjustRelations(world: WorldState, a: string, b: string, delta: number): void {
  const ea = world.empires[a];
  const eb = world.empires[b];
  if (ea) ea.relations[b] = clamp((ea.relations[b] ?? 0) + delta);
  if (eb) eb.relations[a] = clamp((eb.relations[a] ?? 0) + delta);
}

function clamp(v: number): number {
  return Math.max(-100, Math.min(100, v));
}

/** Research-speed bonus (integer percent) from research-exchange treaties (§11.2). */
export function researchExchangeBonus(world: WorldState, empireId: string): number {
  return world.treaties.some(
    (t) => t.type === 'research_exchange' && (t.a === empireId || t.b === empireId),
  )
    ? 15
    : 0;
}

/** AI diplomacy: relations drift, and friendly empires sign escalating treaties. */
export function diplomacyStep(world: WorldState, data: WorldData, rng: Rng): void {
  void data;
  const ids = Object.keys(world.empires)
    .filter((id) => !world.empires[id].pirate)
    .sort();

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const ea = world.empires[a];
      const eb = world.empires[b];
      ea.relations[b] ??= 0;
      eb.relations[a] ??= 0;

      const r = rng.fork((i * 131 + j) | 0);
      // Relations do a small biased random walk, so some pairs warm toward
      // alliance while others stay rivals (leaving room for espionage/piracy).
      adjustRelations(world, a, b, r.range(-2, 3));
      const rel = ea.relations[b] ?? 0;

      if (!hasTreaty(world, a, b, 'nonaggression') && rel >= 15 && r.percent(20)) {
        addTreaty(world, a, b, 'nonaggression');
        adjustRelations(world, a, b, 8);
        world.log.push({ time: world.time, kind: 'treaty', text: `${ea.name} & ${eb.name} sign a non-aggression pact` });
      } else if (hasTreaty(world, a, b, 'nonaggression') && !hasTreaty(world, a, b, 'trade') && rel >= 30 && r.percent(15)) {
        addTreaty(world, a, b, 'trade');
        adjustRelations(world, a, b, 6);
        world.log.push({ time: world.time, kind: 'treaty', text: `${ea.name} & ${eb.name} open a trade agreement` });
      } else if (
        hasTreaty(world, a, b, 'trade') &&
        !hasTreaty(world, a, b, 'research_exchange') &&
        rel >= 45 &&
        ea.unlockedTechs.length > 0 &&
        eb.unlockedTechs.length > 0 &&
        r.percent(12)
      ) {
        addTreaty(world, a, b, 'research_exchange');
        world.log.push({ time: world.time, kind: 'treaty', text: `${ea.name} & ${eb.name} begin research exchange` });
      }
    }
  }
}
