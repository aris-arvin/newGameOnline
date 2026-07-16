/**
 * The per-colony economic step (design prompt §5, §6): staffing & energy
 * throttles, resource extraction, production recipes, construction progress,
 * population growth/starvation, research potential, and credits. Deterministic
 * integer arithmetic — no randomness, so the economy tick is perfectly stable.
 */
import type { Colony, Empire, Planet, RaceDef, WorldData, WorldEvent } from './types.js';
import { countSpec, populationCap } from './colony.js';
import { applyBuildOrder } from './governor.js';
import { empireMultiplier } from './science.js';

export interface EconomyResult {
  research: number;
  credits: number;
  events: WorldEvent[];
}

export function economyStep(
  colony: Colony,
  planet: Planet,
  empire: Empire,
  race: RaceDef,
  data: WorldData,
  time: number,
): EconomyResult {
  const econ = data.economy;
  const rb = data.regionBase;
  const events: WorldEvent[] = [];

  // --- Staffing & energy throttles -------------------------------------
  let totalJobs = 0;
  for (const r of colony.regions) {
    if (r.spec !== 'empty' && r.spec !== 'housing') totalJobs += r.level;
  }
  const workerCapacity = totalJobs * econ.workersPerJob;
  const fillRatio = workerCapacity > 0 ? Math.min(100, Math.floor((colony.population * 100) / workerCapacity)) : 100;

  const energyProd = econ.energyBase + econ.energyPerRegion * colony.regions.length;
  let energyCons = 0;
  for (const r of colony.regions) energyCons += econ.energyPerLevel * r.level;
  const energyRatio = energyCons > 0 ? Math.min(100, Math.floor((energyProd * 100) / energyCons)) : 100;

  const throttle = Math.min(fillRatio, energyRatio); // percent applied to all production

  const mineM = empireMultiplier(empire, 'mining', data);
  const indM = empireMultiplier(empire, 'industry', data);
  const sciM = empireMultiplier(empire, 'science', data);
  const farmM = empireMultiplier(empire, 'farm', data);
  const tradeM = empireMultiplier(empire, 'trade', data);
  const biome = data.biomes[planet.biome];

  const scale = (base: number, pct: number, cluster: number): number =>
    Math.floor((((base * pct) / 100) * throttle * cluster) / 10000);

  const clusterOf = (spec: Colony['regions'][number]['spec']): number =>
    Math.min(150, 100 + 10 * (countSpec(colony, spec) - 1));

  // --- Extraction & flat outputs ---------------------------------------
  let research = 0;
  let credits = econ.baseCreditsPerColony;
  let ip = Math.floor((econ.baseIp * throttle) / 100);

  for (const r of colony.regions) {
    if (r.level <= 0 || r.spec === 'empty') continue;
    const cluster = clusterOf(r.spec);
    switch (r.spec) {
      case 'mining':
        colony.stock.metals += scale((rb.mining.metals ?? 0) * r.level * planet.richness, mineM, cluster);
        colony.stock.minerals += scale((rb.mining.minerals ?? 0) * r.level * planet.richness, mineM, cluster);
        break;
      case 'extractor':
        colony.stock.gas += scale(((rb.extractor.gas ?? 0) + biome.gasBonus) * r.level, mineM, cluster);
        break;
      case 'farm':
        colony.stock.food += scale((rb.farm.food ?? 0) * r.level * biome.fertility, farmM, cluster);
        colony.stock.organics += scale((rb.farm.organics ?? 0) * r.level * biome.fertility, farmM, cluster);
        break;
      case 'science':
        research += scale((rb.science.research ?? 0) * r.level, sciM, cluster);
        break;
      case 'spaceport':
        credits += scale((rb.spaceport.credits ?? 0) * r.level, tradeM, cluster);
        if (planet.belt > 0) {
          colony.stock.exotic += scale((rb.spaceport.exotic ?? 0) * r.level * planet.belt, mineM, cluster);
        }
        break;
      case 'industry':
        ip += scale((rb.industry.ip ?? 0) * r.level, indM, cluster);
        break;
      default:
        break;
    }
  }

  // --- Production recipes (priority order) -----------------------------
  for (const recipe of data.recipes) {
    if (ip < recipe.ipCost) continue;
    let runs = Math.floor(ip / recipe.ipCost);
    for (const [res, amt] of Object.entries(recipe.inputs)) {
      runs = Math.min(runs, Math.floor(colony.stock[res as keyof typeof colony.stock] / (amt ?? 1)));
    }
    runs = Math.min(runs, 40); // per-recipe throughput cap
    if (runs <= 0) continue;
    for (const [res, amt] of Object.entries(recipe.inputs)) {
      colony.stock[res as keyof typeof colony.stock] -= (amt ?? 0) * runs;
    }
    for (const [mat, amt] of Object.entries(recipe.outputs)) {
      colony.stock[mat as keyof typeof colony.stock] += (amt ?? 0) * runs;
    }
    ip -= runs * recipe.ipCost;
  }

  // --- Construction ----------------------------------------------------
  if (colony.buildQueue.length > 0 && ip > 0) {
    const order = colony.buildQueue[0];
    order.progress += ip;
    if (order.progress >= order.cost) {
      applyBuildOrder(colony, order);
      colony.buildQueue.shift();
      events.push({ time, kind: 'build', text: `${colony.id}: ${order.label}` });
    }
  }

  // --- Population ------------------------------------------------------
  const foodNeed = colony.population;
  if (colony.stock.food >= foodNeed) {
    colony.stock.food -= foodNeed;
    const cap = populationCap(colony, planet, race, data);
    if (colony.population < cap) {
      const growthPct = Math.max(1, Math.floor((race.growthPct * empireMultiplier(empire, 'growth', data)) / 100));
      let growth = Math.floor((colony.population * growthPct) / econ.popGrowthDivisor);
      if (growth < 1) growth = 1;
      colony.population = Math.min(cap, colony.population + growth);
    }
  } else {
    const deficit = foodNeed - colony.stock.food;
    colony.stock.food = 0;
    colony.population = Math.max(1, colony.population - Math.max(1, Math.floor(deficit / 2)));
    events.push({ time, kind: 'starvation', text: `${colony.id}: famine (-pop)` });
  }

  // --- Credits ---------------------------------------------------------
  let upkeep = 0;
  for (const r of colony.regions) upkeep += econ.upkeepPerRegionLevel * r.level;
  credits += Math.floor((colony.population * econ.taxPerPop) / 10) - upkeep;

  return { research, credits, events };
}
