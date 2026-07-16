/**
 * Espionage v1 (design prompt §12): agents run missions (recon / sabotage /
 * steal_tech) against a target empire and resolve against its counter-intel.
 * Success advances the sponsor; a botched mission is a caught agent and a
 * diplomatic scandal (relations hit).
 */
import { Rng } from '@pure-galaxy/shared';
import type { Agent, MissionKind, WorldData, WorldState } from './types.js';
import { adjustRelations, areHostile } from './diplomacy.js';
import { TRADE_COMMODITIES } from './market.js';

export function trainAgent(world: WorldState, empireId: string, data: WorldData): Agent | null {
  const empire = world.empires[empireId];
  if (!empire || empire.credits < data.espionage.agentCost) return null;
  empire.credits -= data.espionage.agentCost;
  const agent: Agent = { id: `ag${world.nextId++}`, empireId, level: 1, progress: 0, cooldown: 0 };
  world.agents[agent.id] = agent;
  return agent;
}

export function assignMission(agent: Agent, targetEmpireId: string, mission: MissionKind): void {
  agent.targetEmpireId = targetEmpireId;
  agent.mission = mission;
  agent.progress = 0;
}

/** Effective counter-intelligence of a target (grows with empire size). */
function counterIntel(world: WorldState, targetId: string): number {
  const t = world.empires[targetId];
  if (!t) return 0;
  return t.counterIntel + t.colonyIds.length * 4;
}

export function espionageStep(world: WorldState, data: WorldData, rng: Rng): void {
  const empireIds = Object.keys(world.empires).filter((id) => !world.empires[id].pirate).sort();

  // AI: occasionally recruit and deploy an agent against a rival.
  for (const eid of empireIds) {
    const e = world.empires[eid];
    const hasAgent = Object.values(world.agents).some((a) => a.empireId === eid);
    const r = rng.fork(hashStr(eid));
    if (!hasAgent && e.credits >= data.espionage.agentCost * 2 && r.percent(12)) {
      const targets = empireIds.filter((t) => t !== eid && areHostile(world, eid, t));
      if (targets.length > 0) {
        // Prefer stealing from the most advanced rival.
        const target = targets.reduce((best, t) =>
          world.empires[t].unlockedTechs.length > world.empires[best].unlockedTechs.length ? t : best,
        targets[0]);
        const agent = trainAgent(world, eid, data);
        if (agent) {
          const stealable = world.empires[target].unlockedTechs.filter((t) => !e.unlockedTechs.includes(t));
          const mission: MissionKind = stealable.length > 0 ? 'steal_tech' : r.percent(50) ? 'sabotage' : 'recon';
          assignMission(agent, target, mission);
        }
      }
    }
  }

  // Resolve active missions.
  for (const id of Object.keys(world.agents).sort()) {
    const agent = world.agents[id];
    if (agent.cooldown > 0) {
      agent.cooldown--;
      continue;
    }
    if (!agent.mission || !agent.targetEmpireId) continue;
    agent.progress++;
    if (agent.progress < data.espionage.missionTicks) continue;

    const r = rng.fork(hashStr(id) ^ world.time);
    const success = data.espionage.baseSuccess + agent.level * 5 - counterIntel(world, agent.targetEmpireId);
    resolveMission(world, agent, r.percent(Math.max(5, Math.min(90, success))), data);
    agent.progress = 0;
    agent.cooldown = data.espionage.missionTicks;
  }
}

function resolveMission(world: WorldState, agent: Agent, success: boolean, data: WorldData): void {
  const sponsor = world.empires[agent.empireId];
  const target = world.empires[agent.targetEmpireId!];
  if (!sponsor || !target) return;

  if (!success) {
    // Caught: scandal + relations hit, agent lies low.
    adjustRelations(world, agent.empireId, agent.targetEmpireId!, -20);
    world.log.push({ time: world.time, kind: 'spy', text: `${target.name} caught a ${sponsor.name} agent` });
    agent.level = Math.max(1, agent.level); // no promotion
    return;
  }

  agent.level += 1;
  switch (agent.mission) {
    case 'recon':
      world.log.push({ time: world.time, kind: 'spy', text: `${sponsor.name} scouted ${target.name}` });
      break;
    case 'steal_tech': {
      const stealable = target.unlockedTechs.filter((t) => !sponsor.unlockedTechs.includes(t));
      if (stealable.length > 0) {
        const tech = stealable.slice().sort()[0];
        sponsor.unlockedTechs.push(tech);
        world.log.push({ time: world.time, kind: 'spy', text: `${sponsor.name} stole tech "${tech}" from ${target.name}` });
      }
      break;
    }
    case 'sabotage': {
      // Destroy the target's largest tradable stockpile.
      let best: (typeof TRADE_COMMODITIES)[number] = TRADE_COMMODITIES[0];
      for (const c of TRADE_COMMODITIES) if (target.treasury[c] > target.treasury[best]) best = c;
      target.treasury[best] = Math.max(0, target.treasury[best] - data.espionage.sabotageLoss);
      world.log.push({ time: world.time, kind: 'spy', text: `${sponsor.name} sabotaged ${target.name}'s ${best} stores` });
      break;
    }
    default:
      break;
  }
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0);
  return h | 0;
}
