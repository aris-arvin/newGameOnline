import { useMemo, useState } from 'react';
import { habitability } from '@pure-galaxy/world-core';
import type { Planet } from '@pure-galaxy/world-core';
import { worldData, empireColor } from '../engine';
import type { EmpireInfo, GalaxyDto, Ownership } from '../model';

const REF_RACE = worldData.races.find((r) => r.id === 'sol')!;

export function GalaxyView({ galaxy, ownership, empires }: { galaxy: GalaxyDto; ownership: Ownership; empires: EmpireInfo[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const nameById = useMemo(() => Object.fromEntries(empires.map((e) => [e.id, e.name])), [empires]);
  const systemById = useMemo(() => Object.fromEntries(galaxy.systems.map((s) => [s.id, s])), [galaxy]);

  const lanes = useMemo(
    () =>
      galaxy.lanes
        .map((l) => ({ a: systemById[l.from], b: systemById[l.to] }))
        .filter((l) => l.a && l.b),
    [galaxy, systemById],
  );

  const sel = selected ? systemById[selected] : null;

  return (
    <div className="galaxy-wrap">
      <svg className="galaxy" viewBox="-40 -40 1080 1080" role="img" aria-label="Galaxy map">
        {lanes.map((l, i) => (
          <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="#26304a" strokeWidth={1.2} />
        ))}
        {galaxy.systems.map((s) => {
          const owner = ownership[s.id];
          const r = 5 + Math.min(5, s.planets.length);
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
                {ownership[sel.id] ? (
                  <>
                    <span className="dot" style={{ background: empireColor(ownership[sel.id]) }} />
                    {nameById[ownership[sel.id]] ?? ownership[sel.id]}
                  </>
                ) : (
                  <span className="muted">unclaimed</span>
                )}
              </span>
            </div>
            <h3 style={{ marginTop: 14 }}>Planets ({sel.planets.length})</h3>
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
                {sel.planets.map((p) => {
                  const hab = habitability(p as unknown as Planet, REF_RACE, worldData);
                  return (
                    <tr key={p.id}>
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
