import { useMemo, useState } from 'react';
import type {
  Blueprint,
  ComponentDef,
  InstalledComponent,
  Mount,
  Side,
  WeaponDef,
} from '@pure-galaxy/combat-core';
import type { BattleResult } from '@pure-galaxy/combat-core';
import { catalog, components, hulls, blueprints, blueprintMap, computeShipStats, runBattle } from '../engine';

const compById = new Map<string, ComponentDef>(components.map((c) => [c.id, c]));

function mountFor(def: ComponentDef): Mount {
  if (def.kind === 'weapon') {
    const w = def as WeaponDef;
    return w.mounts.includes('nose') ? 'nose' : w.mounts[0];
  }
  return 'internal';
}

function ships(prefix: string, bp: Blueprint, doctrine: string): Side['ships'] {
  return [0, 1, 2].map((i) => ({ id: `${prefix}-${i}`, blueprint: bp, doctrineId: doctrine, isFlagship: i === 0 }));
}

export function ShipLab() {
  const startBp = blueprintMap.get('bp_kinetic_frigate')!;
  const [hullId, setHullId] = useState(startBp.hullId);
  const [installed, setInstalled] = useState<InstalledComponent[]>(startBp.components.map((c) => ({ ...c })));
  const [addId, setAddId] = useState(components[0].id);
  const [enemyId, setEnemyId] = useState('bp_missile_destroyer');
  const [simSeed, setSimSeed] = useState(1);
  const [result, setResult] = useState<BattleResult | null>(null);

  const blueprint: Blueprint = useMemo(
    () => ({ id: 'custom', name: 'Custom Design', hullId, components: installed }),
    [hullId, installed],
  );
  const stats = useMemo(() => computeShipStats(blueprint, catalog), [blueprint]);

  const loadPreset = (id: string) => {
    const bp = blueprintMap.get(id)!;
    setHullId(bp.hullId);
    setInstalled(bp.components.map((c) => ({ ...c })));
    setResult(null);
  };

  const fight = () => {
    const you: Side = { id: 'you', name: 'Your design', ships: ships('you', blueprint, 'brawler') };
    const enemyBp = blueprintMap.get(enemyId)!;
    const foe: Side = { id: 'enemy', name: enemyBp.name, ships: ships('en', enemyBp, 'balanced') };
    setResult(runBattle([you, foe], catalog, { seed: simSeed }, {}));
  };

  const shieldSum = stats.shieldCapacity.reduce((a, b) => a + b, 0);
  const armorSum = stats.armor.reduce((a, b) => a + b.hp, 0);
  const youSurvivors = result?.survivors[0] ?? 0;
  const enemySurvivors = result?.survivors[1] ?? 0;

  return (
    <div className="lab">
      <div className="panel">
        <h3>Design</h3>
        <div className="add-row" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select onChange={(e) => loadPreset(e.target.value)} defaultValue="bp_kinetic_frigate">
            {blueprints.map((b) => (
              <option key={b.id} value={b.id}>
                Load: {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="kv" style={{ marginBottom: 10 }}>
          <span className="k">Hull</span>
          <select value={hullId} onChange={(e) => setHullId(e.target.value)}>
            {hulls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.class})
              </option>
            ))}
          </select>
        </div>

        <h3>Components ({installed.length})</h3>
        <div className="complist">
          {installed.map((c, idx) => (
            <div className="row" key={idx}>
              <span>
                {compById.get(c.defId)?.name ?? c.defId} <span className="muted">· {c.mount}</span>
              </span>
              <button className="btn" onClick={() => setInstalled(installed.filter((_, i) => i !== idx))}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="add-row" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <select value={addId} onChange={(e) => setAddId(e.target.value)} style={{ flex: 1 }}>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.kind})
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={() => {
              const def = compById.get(addId)!;
              setInstalled([...installed, { defId: addId, mount: mountFor(def) }]);
            }}
          >
            + Add
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="panel">
          <h3>
            Live stats{' '}
            {stats.valid ? (
              <span className="pill good">valid</span>
            ) : (
              <span className="pill bad">invalid</span>
            )}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
            <Stat label="Speed" value={stats.speed} />
            <Stat label="Structure" value={stats.maxStructure} />
            <Stat label="Shields" value={shieldSum} />
            <Stat label="Armor" value={armorSum} />
            <Stat label="Weapons" value={stats.weapons.length} />
            <Stat label="Point-defense" value={stats.pdRating} />
            <Stat label="Sensors" value={stats.sensors} />
            <Stat label="Power balance" value={stats.powerBalance} good={stats.powerBalance >= 0} />
          </div>
          {!stats.valid && (
            <p className="bad" style={{ marginTop: 8 }}>
              {stats.issues.join('; ')}
            </p>
          )}
        </div>

        <div className="panel">
          <h3>Sparring (3 v 3)</h3>
          <div className="add-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="muted">vs</span>
            <select value={enemyId} onChange={(e) => setEnemyId(e.target.value)}>
              {blueprints.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="muted">seed</span>
            <input
              className="seed"
              type="number"
              value={simSeed}
              onChange={(e) => setSimSeed(Number(e.target.value) || 0)}
            />
            <button className="btn" disabled={!stats.valid} onClick={fight}>
              Fight
            </button>
          </div>
          {!stats.valid && <p className="muted" style={{ marginTop: 8 }}>Fix the design to run a battle.</p>}
          {result && (
            <div style={{ marginTop: 12 }}>
              <p>
                Winner:{' '}
                <b className={result.winner === 'you' ? 'good' : result.winner === 'enemy' ? 'bad' : ''}>
                  {result.winner === 'you' ? 'Your design' : result.winner === 'enemy' ? blueprintMap.get(enemyId)?.name : 'Draw'}
                </b>{' '}
                <span className="muted">
                  by {result.reason} in {result.rounds} rounds
                </span>
              </p>
              <div className="kv">
                <span className="k">Survivors</span>
                <span>
                  you {youSurvivors} · enemy {enemySurvivors}
                </span>
                <span className="k">Event log</span>
                <span>
                  {result.log.events.length} events · hash <code>{result.logHash}</code>
                </span>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Deterministic: the same design + seed always produces this exact battle (WEGO tactical engine).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: number; good?: boolean }) {
  return (
    <div className="stat-row">
      <span className="muted">{label}</span>
      <b className={good === undefined ? '' : good ? 'good' : 'bad'}>{value}</b>
    </div>
  );
}
