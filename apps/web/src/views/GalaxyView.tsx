import { useMemo, useState } from 'react';
import { habitability } from '@pure-galaxy/world-core';
import type { WorldState } from '@pure-galaxy/world-core';
import { worldData, empireColor } from '../engine';

const REF_RACE = worldData.races.find((r) => r.id === 'sol')!;

export function GalaxyView({ world }: { world: WorldState }) {
  const [selected, setSelected] = useState<string | null>(null);

  // Which empire (if any) owns each system, by its first colony there.
  const ownerBySystem = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of Object.values(world.colonies)) {
      const sys = world.galaxy.planets[c.planetId]?.systemId;
      if (sys && !(sys in m)) m[sys] = c.empireId;
    }
    return m;
    // recompute whenever the world advances
  }, [world, world.time]);

  const systems = Object.values(world.galaxy.systems);

  const lanes = useMemo(() => {
    const seen = new Set<string>();
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const [from, ls] of Object.entries(world.galaxy.lanes)) {
      for (const lane of ls) {
        const key = from < lane.to ? `${from}|${lane.to}` : `${lane.to}|${from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = world.galaxy.systems[from];
        const b = world.galaxy.systems[lane.to];
        if (a && b) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    return out;
  }, [world]);

  const sel = selected ? world.galaxy.systems[selected] : null;

  return (
    <div className="galaxy-wrap">
      <svg className="galaxy" viewBox="-40 -40 1080 1080" role="img" aria-label="Galaxy map">
        {lanes.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#26304a" strokeWidth={1.2} />
        ))}
        {systems.map((s) => {
          const owner = ownerBySystem[s.id];
          const r = 5 + Math.min(5, s.planetIds.length);
          return (
            <g key={s.id}>
              <circle
                className="sys"
                cx={s.x}
                cy={s.y}
                r={r}
                fill={owner ? empireColor(owner) : '#39435e'}
                stroke={selected === s.id ? '#ffffff' : owner ? '#0b0e14' : '#232c44'}
                strokeWidth={selected === s.id ? 2.5 : 1}
                onClick={() => setSelected(s.id)}
              />
              {owner && (
                <text x={s.x + r + 3} y={s.y + 4} fontSize={13} fill="#8a93a6">
                  {s.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="panel">
        <h3>System inspector</h3>
        {!sel && <p className="muted">Click a star system on the map.</p>}
        {sel && (
          <>
            <div className="kv">
              <span className="k">System</span>
              <span>{sel.name}</span>
              <span className="k">Sector</span>
              <span>{sel.sectorId}</span>
              <span className="k">Owner</span>
              <span>
                {ownerBySystem[sel.id] ? (
                  <>
                    <span className="dot" style={{ background: empireColor(ownerBySystem[sel.id]) }} />
                    {world.empires[ownerBySystem[sel.id]]?.name ?? ownerBySystem[sel.id]}
                  </>
                ) : (
                  <span className="muted">unclaimed</span>
                )}
              </span>
            </div>
            <h3 style={{ marginTop: 14 }}>Planets ({sel.planetIds.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Planet</th>
                  <th>Biome</th>
                  <th className="num">Size</th>
                  <th className="num">Rich</th>
                  <th className="num">Hab*</th>
                </tr>
              </thead>
              <tbody>
                {sel.planetIds.map((pid) => {
                  const p = world.galaxy.planets[pid];
                  const hab = habitability(p, REF_RACE, worldData);
                  return (
                    <tr key={pid}>
                      <td>
                        {p.name}
                        {p.ruins ? <span className="pill" style={{ marginLeft: 6 }}>ruins</span> : null}
                        {p.belt ? <span className="pill" style={{ marginLeft: 6 }}>belt {p.belt}</span> : null}
                      </td>
                      <td>{p.biome}</td>
                      <td className="num">{p.size}</td>
                      <td className="num">{p.richness}</td>
                      <td className="num" style={{ color: hab >= 60 ? 'var(--good)' : hab >= 35 ? 'var(--warn)' : 'var(--bad)' }}>
                        {hab}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 8 }}>
              *Habitability for the Солы race, from biome × gravity × affinity.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
