/**
 * Science: six-school research is scoped to two schools for the Phase-0 MVP
 * (§7, §20). Research potential accumulates into per-school pools and crosses
 * milestone thresholds to unlock empire-wide bonuses. Also the single place
 * that aggregates race modifiers + unlocked techs into output multipliers.
 */
import type { Empire, WorldData } from './types.js';
import { raceById } from './data.js';

export type OutputCategory = 'mining' | 'industry' | 'science' | 'farm' | 'trade' | 'growth';

/**
 * Output multiplier (integer percent, 100 = neutral) for an empire in a given
 * category, combining its race's innate modifier with unlocked tech bonuses.
 */
export function empireMultiplier(empire: Empire, category: OutputCategory, data: WorldData): number {
  const race = raceById(data, empire.raceId);
  let pct = race.mods[category] ?? 100;
  for (const techId of empire.unlockedTechs) {
    const tech = data.techs.find((t) => t.id === techId);
    if (!tech) continue;
    if (category !== 'growth') {
      const bonus = tech.bonus[category as Exclude<OutputCategory, 'growth'>];
      if (bonus) pct += bonus;
    }
  }
  return pct;
}

/** Add research potential to the empire, split by its school sliders. */
export function accrueResearch(empire: Empire, potential: number, data: WorldData): void {
  if (potential <= 0) return;
  const sliders = empire.researchSliders;
  const total = sliders.physics + sliders.economics || 1;
  const toPhysics = Math.floor((potential * sliders.physics) / total);
  empire.research.physics += toPhysics;
  empire.research.economics += potential - toPhysics;
  void data;
}

/** Unlock any techs whose threshold has been reached; returns newly unlocked ids. */
export function checkTechUnlocks(empire: Empire, data: WorldData): string[] {
  const unlocked: string[] = [];
  for (const tech of data.techs) {
    if (empire.unlockedTechs.includes(tech.id)) continue;
    if (empire.research[tech.school] >= tech.threshold) {
      empire.unlockedTechs.push(tech.id);
      unlocked.push(tech.id);
    }
  }
  return unlocked;
}
