/**
 * Seasons & Legacy (design prompt §15). A season ends on any victory or when it
 * times out; the end-of-season ceremony awards Legacy points (permanent account
 * progress) and titles. A soft restart then spins up a fresh galaxy that carries
 * Legacy forward as a capped (±5%) head start — solving the browser-MMO problem
 * of a stagnant world and unreachable veterans.
 */
import type { SeasonState, WorldData, WorldState } from './types.js';
import { empireRating } from './protection.js';

export function makeSeason(): SeasonState {
  return { number: 1, startTick: 0, status: 'active', endedTick: null, endReason: '' };
}

export function seasonCitizens(world: WorldState): string[] {
  return Object.keys(world.empires)
    .filter((id) => !world.empires[id].pirate && !world.empires[id].ancient)
    .sort();
}
const citizens = seasonCitizens;

/** Deterministic seed for the next season's galaxy. */
export function nextSeasonSeed(old: WorldState): number {
  return (old.seed ^ Math.imul(old.season.number + 1, 0x9e3779b1)) >>> 0;
}

/**
 * Carry Legacy/titles/head-start from the ended season into a freshly created
 * next-season world (§15 soft restart). `fresh` must have the same empires (same
 * races, in order) as `old`.
 */
export function carryLegacy(old: WorldState, fresh: WorldState): void {
  const oldIds = seasonCitizens(old);
  const newIds = seasonCitizens(fresh);
  for (let i = 0; i < newIds.length && i < oldIds.length; i++) {
    const oe = old.empires[oldIds[i]];
    const ne = fresh.empires[newIds[i]];
    ne.legacy = oe.legacy;
    ne.titles = [...oe.titles];
    ne.legacyBonusPct = oe.legacyBonusPct;
    const home = fresh.colonies[ne.colonyIds[0]];
    if (home) home.population += Math.floor((home.population * ne.legacyBonusPct) / 100);
    ne.credits += Math.min(500, oe.legacy);
  }
  fresh.season.number = old.season.number + 1;
}

/** Run each tick: end the season when a victory lands or the clock runs out. */
export function seasonStep(world: WorldState, data: WorldData): void {
  if (world.season.status !== 'active') return;
  const elapsed = world.time - world.season.startTick;
  if (world.victor || elapsed >= data.season.lengthTicks) {
    endSeason(world, data, world.victor ? 'victory' : 'time');
  }
}

/** End-of-season ceremony: award Legacy + titles and freeze the season. */
export function endSeason(world: WorldState, data: WorldData, reason: string): void {
  const season = world.season;
  if (season.status === 'ended') return;
  season.status = 'ended';
  season.endedTick = world.time;
  season.endReason = reason;

  const ids = citizens(world);
  const ranked = [...ids].sort((a, b) => empireRating(world, world.empires[b]) - empireRating(world, world.empires[a]) || (a < b ? -1 : 1));

  ranked.forEach((id, rank) => {
    const e = world.empires[id];
    let score = Math.floor(empireRating(world, e) / 50) + e.expeditionsDone * 20 + e.artifacts * 5;
    if (world.victor && world.victor.empireId === id) {
      score += data.season.championLegacy;
      e.titles.push(`S${season.number} Champion (${world.victor.reason})`);
    } else {
      e.titles.push(`S${season.number} #${rank + 1}`);
    }
    if (world.senate.president === id) score += world.senate.consecutiveTerms * 20;
    e.legacy += score;
    e.legacyBonusPct = Math.min(data.season.maxLegacyBonusPct, Math.floor(e.legacy / data.season.legacyPerBonusPct));
  });

  const champ = world.victor ? world.empires[world.victor.empireId]?.name : ranked[0] ? world.empires[ranked[0]].name : '—';
  world.log.push({ time: world.time, kind: 'season', text: `Season ${season.number} ended (${reason}). Champion: ${champ}` });
}
