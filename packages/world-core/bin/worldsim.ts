/**
 * Headless world simulator (design prompt §20 Phase-0 acceptance: a stable
 * economic tick). Generates a galaxy, seeds a few empires, injects one
 * colonization mission, runs N ticks printing the economy as it evolves, and
 * proves the tick is deterministic by re-running and comparing state hashes.
 *
 *   pnpm --filter @pure-galaxy/world-core run worldsim -- --seed 7 --ticks 40 --every 8
 */
import { loadWorldData, raceById } from '../src/data.js';
import { createWorld, tick, runTicks, worldHash } from '../src/world.js';
import { createFleet } from '../src/fleet.js';
import { findPath } from '../src/galaxy.js';
import { habitability } from '../src/colony.js';
import type { WorldData, WorldState } from '../src/types.js';
import { MATERIAL_KINDS } from '../src/types.js';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1]! : fallback;
}

/** Deterministically set up the world plus one colonization mission for emp0. */
function setupWorld(seed: number, data: WorldData, races: string[]): WorldState {
  const world = createWorld(seed, data, { races, galaxy: { sectors: 6, systemsPerSector: 5, laneNeighbors: 3 } });

  const emp0 = world.empires['emp0'];
  if (emp0) {
    const home = world.colonies[emp0.colonyIds[0]];
    const homeSystem = world.galaxy.planets[home.planetId].systemId;
    const race = raceById(data, emp0.raceId);
    // BFS outward for the nearest unowned, reasonably habitable planet.
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
      for (const lane of world.galaxy.lanes[sys] ?? []) {
        if (!seen.has(lane.to)) {
          seen.add(lane.to);
          queue.push(lane.to);
        }
      }
    }
    if (target) {
      const path = findPath(world.galaxy, homeSystem, target.systemId);
      const fleet = createFleet(world, 'emp0', homeSystem, [
        { role: 'colony', power: 0 },
        { role: 'warship', power: 12 },
      ]);
      fleet.order = { type: 'colonize', path, legProgress: 0, targetPlanetId: target.planetId };
    }
  }
  return world;
}

function empireLine(world: WorldState, empireId: string): string {
  const e = world.empires[empireId];
  if (!e) return '';
  let pop = 0;
  const mat: Record<string, number> = {};
  for (const cid of e.colonyIds) {
    const c = world.colonies[cid];
    if (!c) continue;
    pop += c.population;
    for (const m of MATERIAL_KINDS) mat[m] = (mat[m] ?? 0) + c.stock[m];
  }
  const matStr = `food ${mat['food'] ?? 0} / alloys ${mat['alloys'] ?? 0} / fuel ${mat['fuel'] ?? 0} / elec ${mat['electronics'] ?? 0}`;
  return (
    `${e.name.padEnd(11)} col ${String(e.colonyIds.length).padStart(2)} pop ${String(pop).padStart(4)} ` +
    `cr ${String(e.credits).padStart(5)} sci P/E ${e.research.physics}/${e.research.economics} ` +
    `techs ${e.unlockedTechs.length} | ${matStr}`
  );
}

function main(): void {
  const data = loadWorldData();
  const seed = Number.parseInt(arg('seed', '7'), 10);
  const ticks = Number.parseInt(arg('ticks', '40'), 10);
  const every = Number.parseInt(arg('every', '8'), 10);
  const races = arg('races', 'sol,reptiloid,tumali,gerber').split(',');

  console.log(`\n=== PURE GALAXY world simulator ===`);
  console.log(`seed: ${seed}  ticks: ${ticks}  empires: ${races.join(', ')}\n`);

  const world = setupWorld(seed, data, races);
  const g = world.galaxy;
  console.log(
    `Galaxy: ${g.sectors.length} sectors, ${Object.keys(g.systems).length} systems, ${Object.keys(g.planets).length} planets.`,
  );
  console.log('Homeworlds:');
  for (const eid of Object.keys(world.empires).sort()) {
    const e = world.empires[eid];
    const home = world.galaxy.planets[world.colonies[e.colonyIds[0]].planetId];
    console.log(
      `  ${e.name.padEnd(11)} ${home.name} (${home.biome}, grav ${home.gravity}, size ${home.size}, rich ${home.richness}` +
        `${home.belt ? `, belt ${home.belt}` : ''}) hab ${habitability(home, raceById(data, e.raceId), data)}`,
    );
  }

  console.log(`\nEconomy over time:`);
  for (let t = 0; t < ticks; t++) {
    tick(world, data);
    if ((t + 1) % every === 0 || t === ticks - 1) {
      console.log(`-- t=${world.time} --`);
      for (const eid of Object.keys(world.empires).sort()) console.log('  ' + empireLine(world, eid));
    }
  }

  const recent = world.log.slice(-8);
  if (recent.length) {
    console.log('\nRecent events:');
    for (const e of recent) console.log(`  [t${e.time}] ${e.kind}: ${e.text}`);
  }

  // Determinism proof: same procedure, fresh world, identical hash.
  const hashA = worldHash(world);
  const check = setupWorld(seed, data, races);
  runTicks(check, data, ticks);
  const hashB = worldHash(check);
  console.log(`\nState hash: ${hashA}  (deterministic: ${hashA === hashB ? 'YES' : 'NO'})`);
  console.log('');
}

main();
