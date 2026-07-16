/**
 * Balance meta-runner (design prompt §18.6): headless mass simulation.
 *
 * Runs many seeds of a matchup to report win-rate and average round count, and
 * prints a weapon x armour TTK matrix so the rock-paper-scissors layer (§10.6)
 * can be validated numerically. This is the harness a shipped game would run in
 * CI on every balance change.
 *
 *   pnpm --filter @pure-galaxy/combat-core run meta -- --runs 500
 */
import { loadDefaultCatalog, loadBlueprintMap } from '../src/data.js';
import { Catalog } from '../src/catalog.js';
import { runBattle } from '../src/battle.js';
import type { ArmorType, Blueprint, FleetShip, Side, WeaponType } from '../src/types.js';

const BLUEPRINTS = loadBlueprintMap();
function blueprint(id: string): Blueprint {
  const bp = BLUEPRINTS.get(id);
  if (!bp) throw new Error(`Unknown blueprint ${id}`);
  return bp;
}

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1]! : fallback;
}

function sideOf(id: string, bp: Blueprint, count: number, doctrine: string): Side {
  const ships: FleetShip[] = [];
  for (let i = 0; i < count; i++) {
    ships.push({ id: `${id}-${i}`, blueprint: bp, doctrineId: doctrine, isFlagship: i === 0 });
  }
  return { id, name: id, ships };
}

function winrate(a: Side, b: Side, catalog: Catalog, runs: number) {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let rounds = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const r = runBattle(
      [structuredClone(a), structuredClone(b)],
      catalog,
      { seed },
      {},
    );
    rounds += r.rounds;
    if (r.winner === a.id) aWins++;
    else if (r.winner === b.id) bWins++;
    else draws++;
  }
  return { aWins, bWins, draws, avgRounds: (rounds / runs).toFixed(1) };
}

/** A minimal one-weapon / one-armour ship for isolating the type match-up. */
function duelShip(id: string, weapon: WeaponType, armor: ArmorType, pd = false): Blueprint {
  const weaponId = weapon === 'kinetic' ? 'railgun_m' : weapon === 'beam' ? 'laser_m' : 'missile_s';
  const armorId =
    armor === 'plated' ? 'armor_plate_m' : armor === 'ablative' ? 'armor_ablative_m' : 'armor_composite_m';
  return {
    id,
    name: id,
    hullId: 'hull_frigate',
    components: [
      { defId: weaponId, mount: 'nose' },
      { defId: weaponId, mount: 'nose' },
      { defId: 'engine_m', mount: 'side' },
      { defId: 'engine_m', mount: 'side' },
      { defId: armorId, mount: 'rear' },
      { defId: 'reactor_m', mount: 'internal' },
      { defId: armorId, mount: 'internal' },
      { defId: pd ? 'pd_m' : 'shield_s', mount: 'internal' },
    ],
  };
}

function mixedSide(id: string, entries: [string, number, string][]): Side {
  const ships: FleetShip[] = [];
  for (const [bp, n, doc] of entries) {
    for (let i = 0; i < n; i++) {
      ships.push({ id: `${id}-${bp}-${i}`, blueprint: blueprint(bp), doctrineId: doc, isFlagship: ships.length === 0 });
    }
  }
  return { id, name: id, ships };
}

function main(): void {
  const catalog = loadDefaultCatalog();
  const runs = Number.parseInt(arg('runs', '400'), 10);

  console.log(`\n=== PURE GALAXY balance meta (${runs} seeds/matchup) ===\n`);

  // Weapon x armour TTK matrix: attacker (1 ship) vs a punching-bag of each armour.
  const weapons: WeaponType[] = ['kinetic', 'beam', 'missile'];
  const armors: ArmorType[] = ['plated', 'ablative', 'composite'];
  console.log('Rounds-to-kill matrix (attacker rows, defender armour cols; lower = attacker better).');
  console.log('(No point-defense on defenders here — missiles are unopposed; see the PD counter below.)');
  console.log('           ' + armors.map((a) => a.padStart(10)).join(''));
  for (const w of weapons) {
    const cells: string[] = [];
    for (const a of armors) {
      const atk = sideOf('atk', duelShip('atk', w, 'plated'), 1, 'brawler');
      const def = sideOf('def', duelShip('def', 'kinetic', a), 1, 'hold_target');
      // Defender holds & barely fights so we measure the attacker's kill speed.
      let sumRounds = 0;
      let kills = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const r = runBattle([structuredClone(atk), structuredClone(def)], catalog, { seed }, {});
        if (r.winner === 'atk') {
          kills++;
          sumRounds += r.rounds;
        }
      }
      cells.push(kills > 0 ? `${(sumRounds / kills).toFixed(1)}(${Math.round((kills * 100) / runs)}%)` : '  --  ');
    }
    console.log(w.padEnd(11) + cells.map((c) => c.padStart(10)).join(''));
  }

  // Point-defense counter: the same missile attacker vs a bare hull and a PD hull.
  console.log('\nPoint-defense counter (missile attacker win-rate):');
  {
    const atk = sideOf('atk', duelShip('atk', 'missile', 'plated'), 2, 'brawler');
    const bare = winrate(atk, sideOf('def', duelShip('def', 'kinetic', 'plated', false), 2, 'brawler'), catalog, runs);
    const screened = winrate(atk, sideOf('def', duelShip('def', 'kinetic', 'plated', true), 2, 'brawler'), catalog, runs);
    console.log(`  vs no point-defense:  ${Math.round((bare.aWins * 100) / runs)}% (avg ${bare.avgRounds} rounds)`);
    console.log(`  vs PD-screened hull:  ${Math.round((screened.aWins * 100) / runs)}% (avg ${screened.avgRounds} rounds)`);
  }

  // Fleet matchups showing counters at squadron scale.
  console.log('\nFleet matchups:');
  const matchups: [string, Side, Side][] = [
    [
      'missile wing vs brawl+escort',
      sideOf('missile', blueprint('bp_missile_destroyer'), 3, 'gunline'),
      mixedSide('combined', [
        ['bp_kinetic_frigate', 2, 'brawler'],
        ['bp_pd_escort', 1, 'interceptor'],
      ]),
    ],
    [
      'kinetic vs beam (frigates)',
      sideOf('kinetic', blueprint('bp_kinetic_frigate'), 3, 'brawler'),
      sideOf('beam', blueprint('bp_beam_frigate'), 3, 'balanced'),
    ],
  ];
  for (const [label, a, b] of matchups) {
    const wr = winrate(a, b, catalog, runs);
    console.log(
      `  ${label.padEnd(28)} ${a.id} ${wr.aWins} / draw ${wr.draws} / ${wr.bWins} ${b.id}  (avg ${wr.avgRounds} rounds)`,
    );
  }
  console.log('');
}

main();
