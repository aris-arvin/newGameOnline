/**
 * Honest free-to-play monetization model (design prompt §19). The catalog may
 * only ever contain quality-of-life, cosmetic, or season-pass entitlements —
 * NEVER anything that grants a gameplay advantage (resources, ships, speed-ups,
 * combat power, credits). `auditCatalog` is the machine-checkable invariant that
 * keeps the game fair; a test asserts the shipped catalog passes it.
 */
export type EntitlementCategory = 'qol' | 'cosmetic' | 'season_pass';

export interface Entitlement {
  id: string;
  name: string;
  category: EntitlementCategory;
  description: string;
}

/** The only categories allowed to be sold. */
export const FAIR_CATEGORIES: EntitlementCategory[] = ['qol', 'cosmetic', 'season_pass'];

/**
 * Effect phrases that would betray a pay-to-win entitlement sneaking into the
 * catalog. Deliberately targets promises of a gameplay edge, not incidental
 * nouns (a cosmetic "ship skin" is fine; "buy ships" is not).
 */
const FORBIDDEN_EFFECT =
  /\b(instant|speed[- ]?up|pay[- ]?to[- ]?win)\b|(free|extra|bonus|buy|more)\s+(resources?|credits?|ships?|fleets?|research)|research boost|combat\s+(advantage|bonus|power|edge)|\+\s*\d+\s*%?\s*(damage|power|attack)/i;

export function isFair(e: Entitlement): boolean {
  if (!FAIR_CATEGORIES.includes(e.category)) return false;
  // Cosmetic/QoL descriptions must not promise a gameplay edge.
  return !FORBIDDEN_EFFECT.test(e.description);
}

/** Returns the offending (pay-to-win) entitlements; empty means the catalog is fair. */
export function auditCatalog(catalog: Entitlement[]): Entitlement[] {
  return catalog.filter((e) => !isFair(e));
}
