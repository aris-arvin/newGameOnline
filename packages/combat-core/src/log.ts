/**
 * Event-sourced battle log (design prompt §10.11 replays). Every meaningful
 * state change is appended as a typed event. The ordered list of events IS the
 * replay, and its hash is the determinism fingerprint used by tests and the
 * autobattler (§10.12, §18.6).
 */
import type { Sector, WeaponType } from './types.js';
import type { Hex } from './hex.js';

export type BattleEvent =
  | { t: 'battle_start'; seed: number; sides: [string, string]; ships: number }
  | { t: 'round_start'; round: number }
  | { t: 'order'; round: number; ship: string; target: string | null; stance: string }
  | { t: 'move'; round: number; impulse: number; ship: string; to: Hex; facing: number }
  | {
      t: 'fire';
      round: number;
      impulse: number;
      ship: string;
      target: string;
      weapon: string;
      weaponType: WeaponType;
      hit: boolean;
      sector: Sector | -1;
      shieldDmg: number;
      armorDmg: number;
      structDmg: number;
    }
  | { t: 'intercept'; round: number; impulse: number; ship: string; target: string; stopped: number; leaked: number }
  | { t: 'crit'; round: number; impulse: number; ship: string; system: string }
  | { t: 'shield_down'; round: number; impulse: number; ship: string; sector: Sector }
  | { t: 'destroyed'; round: number; impulse: number; ship: string; by: string }
  | { t: 'morale_break'; round: number; ship: string }
  | { t: 'round_end'; round: number; aliveA: number; aliveB: number }
  | { t: 'battle_end'; round: number; winner: string | null; reason: string };

export class BattleLog {
  readonly events: BattleEvent[] = [];

  push(event: BattleEvent): void {
    this.events.push(event);
  }

  /** FNV-1a 32-bit hash over a canonical serialization of the event stream. */
  hash(): string {
    let h = 0x811c9dc5;
    const s = stableStringify(this.events);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Deterministic JSON: object keys sorted, no incidental whitespace. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
