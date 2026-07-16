/**
 * Headless world simulator (design prompt §20). Generates a galaxy, seeds
 * empires + a colonization mission + a pirate faction, runs the economy and the
 * society layer (treaties, market, espionage, convoys/piracy, newbie
 * protection), prints how it all evolves, and proves the tick is deterministic
 * by re-running the identical procedure and comparing state hashes.
 *
 *   pnpm --filter @pure-galaxy/world-core run worldsim -- --seed 7 --ticks 60 --every 12
 */
import { loadWorldData, raceById } from '../src/data.js';
import { createWorld, tick, worldHash } from '../src/world.js';
import { createFleet } from '../src/fleet.js';
import { findPath } from '../src/galaxy.js';
import { habitability, makeStock } from '../src/colony.js';
import { spawnPirates, dispatchConvoy, PIRATE_EMPIRE } from '../src/piracy.js';
import { TRADE_COMMODITIES } from '../src/market.js';
import type { WorldData, WorldState } from '../src/types.js';
import { MATERIAL_KINDS } from '../src/types.js';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1]! : fallback;
}

/** Deterministic scenario setup (galaxy + colonization mission + pirates). */
function buildWorld(seed: number, data: WorldData, races: string[]): WorldState {
  const world = createWorld(seed, data, { races, galaxy: { sectors: 6, systemsPerSector: 5, laneNeighbors: 3 } });

  const emp0 = world.empires['emp0'];
  if (emp0) {
    const home = world.colonies[emp0.colonyIds[0]];
    const homeSystem = world.galaxy.planets[home.planetId].systemId;
    const race = raceById(data, emp0.raceId);
    const owned = new Set(Object.values(world.colonies).map((c) => c.planetId));
    let target: { planetId: string; systemId: string } | null = null;
    const seen = new Set<string>([homeSystem]);
    const queue = [homeSystem];
    while (queue.length && !target) {
      const sys = queue.shift()!;
      for (const pid of world.galaxy.systems[sys].planetIds) {
        if (!owned.has(pid) && habitability(world.galaxy.planets[pid], race, data) >= 30) {
          target = { planetId: pid, systemId: sys };
          break;
        }
      }
      for (const lane of world.galaxy.lanes[sys] ?? []) if (!seen.has(lane.to)) (seen.add(lane.to), queue.push(lane.to));
    }
    if (target) {
      const fleet = createFleet(world, 'emp0', homeSystem, [{ role: 'colony', power: 0 }, { role: 'warship', power: 12 }]);
      fleet.order = { type: 'colonize', path: findPath(world.galaxy, homeSystem, target.systemId), legProgress: 0, targetPlanetId: target.planetId };
    }
  }

  spawnPirates(world, data, 2);
  return world;
}

/** Deterministic per-tick scripting: dispatch one convoy once emp0 has 2 colonies. */
function stepWorld(world: WorldState, data: WorldData): void {
  const emp0 = world.empires['emp0'];
  const hasConvoy = Object.values(world.fleets).some((f) => f.empireId === 'emp0' && f.cargo);
  if (emp0 && emp0.colonyIds.length >= 2 && !hasConvoy && emp0.treasury.alloys > 20) {
    const cargo = makeStock({ alloys: Math.min(40, emp0.treasury.alloys) });
    emp0.treasury.alloys -= cargo.alloys;
    dispatchConvoy(world, 'emp0', emp0.colonyIds[1], emp0.colonyIds[0], cargo);
  }
  tick(world, data);
}

function empireLine(world: WorldState, empireId: string): string {
  const e = world.empires[empireId];
  let pop = 0;
  const mat: Record<string, number> = {};
  for (const cid of e.colonyIds) {
    const c = world.colonies[cid];
    if (!c) continue;
    pop += c.population;
    for (const m of MATERIAL_KINDS) mat[m] = (mat[m] ?? 0) + c.stock[m];
  }
  const treas = TRADE_COMMODITIES.map((m) => e.treasury[m]).join('/');
  return (
    `${e.name.padEnd(11)} col ${String(e.colonyIds.length).padStart(2)} pop ${String(pop).padStart(4)} ` +
    `cr ${String(e.credits).padStart(6)} sci ${e.research.physics}/${e.research.economics} tech ${e.unlockedTechs.length} ` +
    `treas[a/f/e/c] ${treas}`
  );
}

function main(): void {
  const data = loadWorldData();
  const seed = Number.parseInt(arg('seed', '7'), 10);
  const ticks = Number.parseInt(arg('ticks', '60'), 10);
  const every = Number.parseInt(arg('every', '12'), 10);
  const races = arg('races', 'sol,reptiloid,tumali,gerber').split(',');

  console.log(`\n=== PURE GALAXY world simulator (Phase 0 + Society) ===`);
  console.log(`seed: ${seed}  ticks: ${ticks}  empires: ${races.join(', ')} + pirates\n`);

  const world = buildWorld(seed, data, races);
  const g = world.galaxy;
  console.log(`Galaxy: ${g.sectors.length} sectors, ${Object.keys(g.systems).length} systems, ${Object.keys(g.planets).length} planets.`);
  console.log('Homeworlds:');
  for (const eid of Object.keys(world.empires).sort()) {
    const e = world.empires[eid];
    if (e.pirate) continue;
    const home = world.galaxy.planets[world.colonies[e.colonyIds[0]].planetId];
    console.log(`  ${e.name.padEnd(11)} ${home.name} (${home.biome}, size ${home.size}, rich ${home.richness}) hab ${habitability(home, raceById(data, e.raceId), data)}`);
  }

  console.log(`\nEconomy & society over time:`);
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, data);
    if ((t + 1) % every === 0 || t === ticks - 1) {
      console.log(`-- t=${world.time} --`);
      for (const eid of Object.keys(world.empires).sort()) {
        if (world.empires[eid].pirate) continue;
        console.log('  ' + empireLine(world, eid));
      }
      const prices = TRADE_COMMODITIES.map((c) => `${c[0]}${world.market.prices[c]}`).join(' ');
      const pirateFleets = world.empires[PIRATE_EMPIRE]?.fleetIds.length ?? 0;
      console.log(`  society: treaties ${world.treaties.length}, agents ${Object.keys(world.agents).length}, pirate fleets ${pirateFleets}, prices ${prices}`);
    }
  }

  const society = world.log.filter((e) => ['treaty', 'spy', 'convoy', 'battle', 'protection', 'colonized', 'tech'].includes(e.kind)).slice(-12);
  if (society.length) {
    console.log('\nSociety events:');
    for (const e of society) console.log(`  [t${e.time}] ${e.kind}: ${e.text}`);
  }

  // Determinism proof: identical procedure, fresh world, identical hash.
  const hashA = worldHash(world);
  const check = buildWorld(seed, data, races);
  for (let t = 0; t < ticks; t++) stepWorld(check, data);
  const hashB = worldHash(check);
  console.log(`\nState hash: ${hashA}  (deterministic: ${hashA === hashB ? 'YES' : 'NO'})`);
  console.log('');
}

main();
