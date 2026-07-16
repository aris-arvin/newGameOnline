/**
 * AI governors and development plans (design prompt §6.4): when a colony's
 * build queue is empty, the governor enqueues the next sensible development so
 * the colony keeps growing while the player is offline (§2.2).
 */
import type { BuildOrder, Colony, Planet, RegionSpec, WorldData } from './types.js';
import { countSpec } from './colony.js';

/** Target region-mix weights per plan. */
export const PLAN_WEIGHTS: Record<string, Partial<Record<RegionSpec, number>>> = {
  balanced: { farm: 3, mining: 2, industry: 2, science: 2, housing: 2, spaceport: 1, extractor: 1 },
  industry: { mining: 3, industry: 3, farm: 1, housing: 2, spaceport: 1, science: 1, extractor: 1 },
  science: { science: 3, housing: 2, farm: 2, industry: 2, mining: 1 },
  breadbasket: { farm: 4, housing: 3, industry: 1, mining: 1 },
  fortress: { military: 3, industry: 2, housing: 2, mining: 2, farm: 1 },
};

const SPEC_ORDER: RegionSpec[] = [
  'housing',
  'farm',
  'mining',
  'extractor',
  'industry',
  'science',
  'spaceport',
  'military',
];

function pickDeficitSpec(colony: Colony, weights: Partial<Record<RegionSpec, number>>): RegionSpec | null {
  let best: RegionSpec | null = null;
  let bestDeficit = 0;
  for (const spec of SPEC_ORDER) {
    const weight = weights[spec] ?? 0;
    if (weight <= 0) continue;
    const deficit = weight - countSpec(colony, spec);
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = spec;
    }
  }
  return best;
}

function pickDevelopRegion(colony: Colony, weights: Partial<Record<RegionSpec, number>>): number {
  let best = -1;
  let bestLevel = Number.POSITIVE_INFINITY;
  for (let i = 0; i < colony.regions.length; i++) {
    const r = colony.regions[i];
    if (r.spec === 'empty' || (weights[r.spec] ?? 0) <= 0) continue;
    if (r.level < bestLevel) {
      bestLevel = r.level;
      best = i;
    }
  }
  return best;
}

export function governorStep(colony: Colony, planet: Planet, data: WorldData): void {
  if (colony.governor === '' || colony.buildQueue.length > 0) return;
  const weights = PLAN_WEIGHTS[colony.governor] ?? PLAN_WEIGHTS.balanced;
  const econ = data.economy;

  // 1. Turn an empty region into the most-needed specialization.
  const emptyIdx = colony.regions.findIndex((r) => r.spec === 'empty');
  const targetSpec = pickDeficitSpec(colony, weights);
  if (emptyIdx >= 0 && targetSpec) {
    colony.buildQueue.push({
      kind: 'respec',
      regionIndex: emptyIdx,
      newSpec: targetSpec,
      cost: econ.addRegionCost,
      progress: 0,
      label: `Develop ${targetSpec} district`,
    });
    return;
  }

  // 2. Claim another region slot if the planet has room.
  if (colony.regions.length < planet.regionSlots) {
    colony.buildQueue.push({
      kind: 'add_region',
      cost: econ.addRegionCost,
      progress: 0,
      label: 'Terraform new district',
    });
    return;
  }

  // 3. Otherwise deepen an existing weighted district.
  const devIdx = pickDevelopRegion(colony, weights);
  if (devIdx >= 0) {
    const lvl = colony.regions[devIdx].level;
    colony.buildQueue.push({
      kind: 'develop',
      regionIndex: devIdx,
      cost: econ.developBaseCost + econ.developCostPerLevel * lvl,
      progress: 0,
      label: `Upgrade ${colony.regions[devIdx].spec} to L${lvl + 1}`,
    });
  }
}

/** Apply a completed build order to the colony. */
export function applyBuildOrder(colony: Colony, order: BuildOrder): void {
  switch (order.kind) {
    case 'develop':
      if (order.regionIndex !== undefined && colony.regions[order.regionIndex]) {
        colony.regions[order.regionIndex].level += 1;
      }
      break;
    case 'respec':
      if (order.regionIndex !== undefined && order.newSpec && colony.regions[order.regionIndex]) {
        const r = colony.regions[order.regionIndex];
        r.spec = order.newSpec;
        if (r.level < 1) r.level = 1;
      }
      break;
    case 'add_region':
      colony.regions.push({ spec: 'empty', level: 0 });
      break;
    default:
      break;
  }
}
