/**
 * Headless autobattler (design prompt §18.6, §21.2).
 *
 * Runs a single scripted battle and prints a human-readable report plus the
 * deterministic event-log hash. Re-running with the same --seed reproduces the
 * exact same hash — the core guarantee the whole engine is built around.
 *
 *   pnpm --filter @pure-galaxy/combat-core run autobattle -- --seed 7 --scenario demo --verbose
 */
import { loadDefaultCatalog, loadBlueprintMap } from '../src/data.js';
import { runBattle } from '../src/battle.js';
import { computeShipStats } from '../src/blueprint.js';
import type { Blueprint, FleetShip, Side } from '../src/types.js';

interface Squadron {
  bpId: string;
  count: number;
  doctrine: string;
  flagship?: boolean;
}

interface Scenario {
  name: string;
  a: { id: string; name: string; squads: Squadron[] };
  b: { id: string; name: string; squads: Squadron[] };
}

const SCENARIOS: Record<string, Scenario> = {
  demo: {
    name: 'Kinetic line vs beam line (matched flagships)',
    a: {
      id: 'reptiloid',
      name: 'Reptiloid Line',
      squads: [
        { bpId: 'bp_cruiser_flagship', count: 1, doctrine: 'brawler', flagship: true },
        { bpId: 'bp_kinetic_frigate', count: 3, doctrine: 'brawler' },
      ],
    },
    b: {
      id: 'gerber',
      name: 'Gerber Line',
      squads: [
        { bpId: 'bp_cruiser_flagship', count: 1, doctrine: 'brawler', flagship: true },
        { bpId: 'bp_beam_frigate', count: 3, doctrine: 'brawler' },
      ],
    },
  },
  duel: {
    name: 'Kinetic frigate vs beam frigate',
    a: { id: 'reptiloid', name: 'Reptiloid', squads: [{ bpId: 'bp_kinetic_frigate', count: 1, doctrine: 'brawler', flagship: true }] },
    b: { id: 'gerber', name: 'Gerber', squads: [{ bpId: 'bp_beam_frigate', count: 1, doctrine: 'balanced', flagship: true }] },
  },
  brawl: {
    name: 'Mirror brawl (4v4 gun frigates)',
    a: { id: 'red', name: 'Red', squads: [{ bpId: 'bp_kinetic_frigate', count: 4, doctrine: 'brawler', flagship: true }] },
    b: { id: 'blue', name: 'Blue', squads: [{ bpId: 'bp_kinetic_frigate', count: 4, doctrine: 'gunline', flagship: true }] },
  },
};

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

function buildSide(
  spec: Scenario['a'],
  blueprints: Map<string, Blueprint>,
): Side {
  const ships: FleetShip[] = [];
  let flagged = false;
  for (const sq of spec.squads) {
    const bp = blueprints.get(sq.bpId);
    if (!bp) throw new Error(`Unknown blueprint ${sq.bpId}`);
    for (let i = 0; i < sq.count; i++) {
      const isFlag = !!sq.flagship && !flagged && i === 0;
      if (isFlag) flagged = true;
      ships.push({
        id: `${spec.id}-${sq.bpId.replace('bp_', '')}-${i + 1}`,
        blueprint: bp,
        doctrineId: sq.doctrine,
        isFlagship: isFlag,
      });
    }
  }
  return { id: spec.id, name: spec.name, ships };
}

function main(): void {
  const catalog = loadDefaultCatalog();
  const blueprints = loadBlueprintMap();
  const seed = Number.parseInt(arg('seed', '1')!, 10);
  const scenarioKey = arg('scenario', 'demo')!;
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    console.error(`Unknown scenario "${scenarioKey}". Options: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n=== PURE GALAXY autobattler ===`);
  console.log(`scenario: ${scenarioKey} — ${scenario.name}`);
  console.log(`seed: ${seed}\n`);

  // Blueprint validity report (server-authoritative stat compile, §8).
  console.log('Blueprint check:');
  const seen = new Set<string>();
  for (const spec of [scenario.a, scenario.b]) {
    for (const sq of spec.squads) {
      if (seen.has(sq.bpId)) continue;
      seen.add(sq.bpId);
      const bp = blueprints.get(sq.bpId)!;
      const st = computeShipStats(bp, catalog);
      const flag = st.valid ? 'ok ' : 'BAD';
      console.log(
        `  [${flag}] ${bp.name.padEnd(28)} spd ${st.speed} struct ${st.maxStructure} ` +
          `shield ${st.shieldCapacity.reduce((a, x) => a + x, 0)} armor ${st.armor.reduce((a, x) => a + x.hp, 0)} ` +
          `pwr ${st.powerBalance >= 0 ? '+' : ''}${st.powerBalance} pd ${st.pdRating} weapons ${st.weapons.length}`,
      );
      if (!st.valid) console.log(`         issues: ${st.issues.join('; ')}`);
    }
  }

  const sideA = buildSide(scenario.a, blueprints);
  const sideB = buildSide(scenario.b, blueprints);

  const result = runBattle([sideA, sideB], catalog, { seed }, {});

  // Determinism self-check: same seed must reproduce the identical log hash.
  const again = runBattle([buildSide(scenario.a, blueprints), buildSide(scenario.b, blueprints)], catalog, { seed }, {});
  const deterministic = again.logHash === result.logHash;

  console.log(`\nResult: ${result.winner ? `${result.winner} wins` : 'draw'} by ${result.reason} in ${result.rounds} round(s).`);
  console.log(`Survivors — ${sideA.id}: ${result.survivors[0]}, ${sideB.id}: ${result.survivors[1]}`);
  console.log(`Event log: ${result.log.events.length} events, hash ${result.logHash} (deterministic: ${deterministic ? 'YES' : 'NO'})`);

  console.log('\nFinal ships:');
  for (const s of result.ships) {
    const state = !s.alive ? 'destroyed' : s.withdrawn ? 'withdrew' : `${s.structurePct}% struct`;
    console.log(`  ${s.side.padEnd(10)} ${s.id.padEnd(28)} ${s.hullClass.padEnd(12)} ${state}`);
  }

  if (hasFlag('verbose')) {
    console.log('\nEvent log:');
    for (const e of result.log.events) console.log('  ' + JSON.stringify(e));
  }
  console.log('');
}

main();
