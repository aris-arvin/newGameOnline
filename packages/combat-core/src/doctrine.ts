/**
 * Doctrine engine v1 — programmable ship behaviour (design prompt §10.8).
 *
 * A doctrine is an ordered list of rules; the first rule whose condition holds
 * supplies the ship's order for the round. This is what fights on behalf of an
 * offline player (§2.2 "absence != helplessness"). Rules are plain data, so a
 * doctrine is a tradeable/steal-able crafted asset just like a blueprint.
 */
import type { HullClass } from './types.js';

export type DoctrineStance = 'close' | 'kite' | 'hold' | 'retreat';
export type TargetPreference = 'nearest' | 'weakest' | 'strongest' | 'biggest';

export type DoctrineCondition =
  | { kind: 'always' }
  | { kind: 'self_structure_below'; pct: number }
  | { kind: 'self_shields_below'; pct: number }
  | { kind: 'enemy_within'; dist: number }
  | { kind: 'enemy_beyond'; dist: number }
  | { kind: 'enemy_class_present'; hullClass: HullClass }
  | { kind: 'outnumbered' };

export interface DoctrineAction {
  target?: TargetPreference;
  stance?: DoctrineStance;
  /** Power split as percentages of a 300-point budget; normalised at use. */
  energy?: { shields: number; weapons: number; engines: number };
}

export interface DoctrineRule {
  condition: DoctrineCondition;
  action: DoctrineAction;
}

export interface Doctrine {
  id: string;
  name: string;
  rules: DoctrineRule[];
}

/** Resolved order for one ship for one round. */
export interface ResolvedOrder {
  target: TargetPreference;
  stance: DoctrineStance;
  energy: { shields: number; weapons: number; engines: number };
}

export const DEFAULT_ORDER: ResolvedOrder = {
  target: 'nearest',
  stance: 'close',
  energy: { shields: 100, weapons: 100, engines: 100 },
};

/** Facts about the acting ship's situation, evaluated by the engine each round. */
export interface DoctrineContext {
  selfStructurePct: number;
  selfShieldPct: number;
  nearestEnemyDist: number;
  enemyClasses: Set<HullClass>;
  friendlyCount: number;
  enemyCount: number;
}

function conditionHolds(condition: DoctrineCondition, ctx: DoctrineContext): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'self_structure_below':
      return ctx.selfStructurePct < condition.pct;
    case 'self_shields_below':
      return ctx.selfShieldPct < condition.pct;
    case 'enemy_within':
      return ctx.nearestEnemyDist <= condition.dist;
    case 'enemy_beyond':
      return ctx.nearestEnemyDist > condition.dist;
    case 'enemy_class_present':
      return ctx.enemyClasses.has(condition.hullClass);
    case 'outnumbered':
      return ctx.enemyCount > ctx.friendlyCount;
    default:
      return false;
  }
}

/** Evaluate a doctrine top-down; the first matching rule wins (over defaults). */
export function evaluateDoctrine(doctrine: Doctrine, ctx: DoctrineContext): ResolvedOrder {
  for (const rule of doctrine.rules) {
    if (conditionHolds(rule.condition, ctx)) {
      return {
        target: rule.action.target ?? DEFAULT_ORDER.target,
        stance: rule.action.stance ?? DEFAULT_ORDER.stance,
        energy: normalizeEnergy(rule.action.energy ?? DEFAULT_ORDER.energy),
      };
    }
  }
  return { ...DEFAULT_ORDER, energy: { ...DEFAULT_ORDER.energy } };
}

/** Keep the total power budget fixed at 300 so energy is a real trade-off. */
export function normalizeEnergy(e: { shields: number; weapons: number; engines: number }): {
  shields: number;
  weapons: number;
  engines: number;
} {
  const sum = e.shields + e.weapons + e.engines;
  if (sum <= 0) return { shields: 100, weapons: 100, engines: 100 };
  const scale = 300 / sum;
  const shields = Math.max(10, Math.round((e.shields * scale) / 5) * 5);
  const weapons = Math.max(10, Math.round((e.weapons * scale) / 5) * 5);
  const engines = Math.max(10, 300 - shields - weapons);
  return { shields, weapons, engines };
}

/** Preset doctrine library (§10.8). */
export const PRESET_DOCTRINES: Record<string, Doctrine> = {
  balanced: {
    id: 'balanced',
    name: 'Balanced Line',
    rules: [
      { condition: { kind: 'self_structure_below', pct: 25 }, action: { stance: 'retreat', energy: { shields: 160, weapons: 40, engines: 100 } } },
      { condition: { kind: 'always' }, action: { target: 'nearest', stance: 'close', energy: { shields: 100, weapons: 120, engines: 80 } } },
    ],
  },
  gunline: {
    id: 'gunline',
    name: 'Artillery Line',
    rules: [
      { condition: { kind: 'enemy_within', dist: 4 }, action: { target: 'nearest', stance: 'kite', energy: { shields: 120, weapons: 130, engines: 50 } } },
      { condition: { kind: 'always' }, action: { target: 'weakest', stance: 'kite', energy: { shields: 80, weapons: 150, engines: 70 } } },
    ],
  },
  brawler: {
    id: 'brawler',
    name: 'Close Brawler',
    rules: [
      { condition: { kind: 'self_structure_below', pct: 20 }, action: { stance: 'hold', energy: { shields: 150, weapons: 120, engines: 30 } } },
      { condition: { kind: 'always' }, action: { target: 'weakest', stance: 'close', energy: { shields: 90, weapons: 150, engines: 60 } } },
    ],
  },
  interceptor: {
    id: 'interceptor',
    name: 'Carrier Hunter',
    rules: [
      { condition: { kind: 'enemy_class_present', hullClass: 'carrier' }, action: { target: 'biggest', stance: 'close', energy: { shields: 80, weapons: 130, engines: 90 } } },
      { condition: { kind: 'always' }, action: { target: 'nearest', stance: 'close', energy: { shields: 100, weapons: 110, engines: 90 } } },
    ],
  },
};
