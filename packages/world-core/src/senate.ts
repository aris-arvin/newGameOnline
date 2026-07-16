/**
 * The Galactic Senate (design prompt §11.3): representation by senate weight
 * (economy + population + reputation — NOT military), weekly sessions that pass
 * resolutions, and a president elected each term. Winning the presidency two
 * terms running is a diplomatic victory (§15). Proposing costs imperial focus
 * (§6.5).
 */
import { Rng } from '@pure-galaxy/shared';
import type { Empire, SenateState, WorldData, WorldState } from './types.js';

export function makeSenate(data: WorldData): SenateState {
  return {
    president: null,
    presidentSince: 0,
    consecutiveTerms: 0,
    termCount: 0,
    nextSession: data.senate.sessionInterval,
    nextElection: data.senate.termLength,
    resolutionLog: [],
  };
}

/** Senate weight: economy + population + reputation (military does NOT count). */
export function senateWeight(world: WorldState, empire: Empire): number {
  let pop = 0;
  for (const cid of empire.colonyIds) pop += world.colonies[cid]?.population ?? 0;
  const economy = Math.floor(Math.max(0, empire.credits) / 50) + empire.colonyIds.length * 20;
  let reputation = world.treaties.filter((t) => t.a === empire.id || t.b === empire.id).length * 5;
  for (const v of Object.values(empire.relations)) if (v > 0) reputation += Math.floor(v / 10);
  return economy + pop + reputation;
}

function citizens(world: WorldState): string[] {
  return Object.keys(world.empires)
    .filter((id) => !world.empires[id].pirate && !world.empires[id].ancient)
    .sort();
}

export function senateStep(world: WorldState, data: WorldData, rng: Rng): void {
  const senate = world.senate;

  if (world.time >= senate.nextElection) {
    runElection(world);
    senate.nextElection += data.senate.termLength;
  }
  if (world.time >= senate.nextSession) {
    runSession(world, data, rng);
    senate.nextSession += data.senate.sessionInterval;
  }
}

function runElection(world: WorldState): void {
  const senate = world.senate;
  const ids = citizens(world);
  if (ids.length === 0) return;
  let winner = ids[0];
  let best = senateWeight(world, world.empires[winner]);
  for (const id of ids) {
    const w = senateWeight(world, world.empires[id]);
    if (w > best) {
      best = w;
      winner = id;
    }
  }
  senate.termCount++;
  senate.consecutiveTerms = winner === senate.president ? senate.consecutiveTerms + 1 : 1;
  senate.president = winner;
  senate.presidentSince = world.time;
  world.log.push({
    time: world.time,
    kind: 'senate',
    text: `${world.empires[winner].name} elected President (term ${senate.termCount}, streak ${senate.consecutiveTerms})`,
  });
}

const RESOLUTIONS = ['galactic_tax', 'sanction', 'fund_expedition'] as const;

function runSession(world: WorldState, data: WorldData, rng: Rng): void {
  const senate = world.senate;
  const ids = citizens(world);
  if (ids.length < 2) return;

  // The president (or the heaviest member) proposes, paying focus.
  const proposer = senate.president && world.empires[senate.president] ? senate.president : ids[0];
  const pe = world.empires[proposer];
  if (pe.focus < data.senate.proposalFocusCost) return;
  pe.focus -= data.senate.proposalFocusCost;

  const type = RESOLUTIONS[senate.resolutionLog.length % RESOLUTIONS.length];
  const ratings = ids.map((id) => senateWeight(world, world.empires[id])).sort((a, b) => a - b);
  const median = ratings[Math.floor(ratings.length / 2)];

  // Pick a sanction target: the member with the worst reputation.
  let target = ids[0];
  let worst = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const rep = Object.values(world.empires[id].relations).reduce((a, v) => a + v, 0);
    if (rep < worst) {
      worst = rep;
      target = id;
    }
  }

  // Weighted vote by self-interest.
  let yes = 0;
  let no = 0;
  for (const id of ids) {
    const e = world.empires[id];
    const weight = senateWeight(world, e);
    let voteYes: boolean;
    switch (type) {
      case 'galactic_tax':
        voteYes = senateWeight(world, e) <= median; // the poorer half wants redistribution
        break;
      case 'sanction':
        voteYes = id !== target && (e.relations[target] ?? 0) <= 0;
        break;
      default:
        voteYes = e.research.physics + e.research.economics >= data.expeditions.minResearch;
        break;
    }
    if (voteYes) yes += weight;
    else no += weight;
  }
  const passed = yes > no;
  if (passed) applyResolution(world, data, type, target, median);

  senate.resolutionLog.push({ tick: world.time, type, passed, text: describeResolution(world, type, target) });
  if (senate.resolutionLog.length > 20) senate.resolutionLog.shift();
  world.log.push({
    time: world.time,
    kind: 'senate',
    text: `Resolution ${type} ${passed ? 'PASSED' : 'failed'} (${yes} vs ${no})`,
  });
  void rng;
}

function applyResolution(world: WorldState, data: WorldData, type: string, target: string, median: number): void {
  const ids = citizens(world);
  switch (type) {
    case 'galactic_tax': {
      let fund = 0;
      for (const id of ids) {
        const e = world.empires[id];
        const tax = Math.floor((Math.max(0, e.credits) * data.senate.taxRate) / 100);
        e.credits -= tax;
        fund += tax;
      }
      const recipients = ids.filter((id) => senateWeight(world, world.empires[id]) < median);
      if (recipients.length > 0) {
        const share = Math.floor(fund / recipients.length);
        for (const id of recipients) world.empires[id].credits += share;
      } else {
        world.galacticFund += fund;
      }
      break;
    }
    case 'sanction':
      world.empires[target].sanctionedUntil = world.time + data.senate.sanctionTicks;
      break;
    case 'fund_expedition': {
      // Fund the science leader's programme.
      let leader = ids[0];
      let best = -1;
      for (const id of ids) {
        const r = world.empires[id].research.physics + world.empires[id].research.economics;
        if (r > best) {
          best = r;
          leader = id;
        }
      }
      world.empires[leader].credits += data.expeditions.costCredits;
      break;
    }
    default:
      break;
  }
}

function describeResolution(world: WorldState, type: string, target: string): string {
  if (type === 'sanction') return `sanction ${world.empires[target]?.name ?? target}`;
  return type;
}
