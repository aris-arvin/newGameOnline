import type { WorldState } from '@pure-galaxy/world-core';
import { spectateSnapshot, worldData, empireColor } from '../engine';

export function EmpireView({ world }: { world: WorldState }) {
  const snap = spectateSnapshot(world, worldData);
  const idByName: Record<string, string> = {};
  for (const id of Object.keys(world.empires)) idByName[world.empires[id].name] = id;
  const lastReso = world.senate.resolutionLog[world.senate.resolutionLog.length - 1];

  return (
    <>
      {snap.victor && (
        <div className="victor-banner">
          🏆 {snap.victor.empire} — {snap.victor.reason.toUpperCase()} victory (season {snap.season})
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div className="panel">
          <h3>Standings — season {snap.season}</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Empire</th>
                <th className="num">Rating</th>
                <th className="num">Col</th>
                <th className="num">Pop</th>
                <th className="num">Credits</th>
                <th className="num">Exp</th>
                <th className="num">Artifacts</th>
                <th className="num">Legacy</th>
              </tr>
            </thead>
            <tbody>
              {snap.standings.map((s, i) => (
                <tr key={s.empire}>
                  <td>{i + 1}</td>
                  <td>
                    <span className="dot" style={{ background: empireColor(idByName[s.empire] ?? '') }} />
                    {s.empire} {s.president ? <span title="Senate President">★</span> : null}
                  </td>
                  <td className="num">{s.rating}</td>
                  <td className="num">{s.colonies}</td>
                  <td className="num">{s.population}</td>
                  <td className="num">{s.credits}</td>
                  <td className="num">{s.expeditions}/5</td>
                  <td className="num">{s.artifacts}</td>
                  <td className="num">{s.legacy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel">
            <h3>Galactic Senate</h3>
            <div className="kv">
              <span className="k">President</span>
              <span>{snap.senate.president || <span className="muted">—</span>}</span>
              <span className="k">Term</span>
              <span>{snap.senate.term}</span>
              <span className="k">Streak</span>
              <span>{snap.senate.streak} {snap.senate.streak >= 2 ? <span className="good">(win)</span> : null}</span>
            </div>
            {lastReso && (
              <p className="muted" style={{ marginTop: 10 }}>
                Last resolution: <b>{lastReso.type}</b> — {lastReso.passed ? <span className="good">passed</span> : <span className="bad">failed</span>}
              </p>
            )}
          </div>

          <div className="panel">
            <h3>Federation market</h3>
            <table>
              <tbody>
                {Object.entries(snap.prices).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num">{v} cr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Society</h3>
            <div className="kv">
              <span className="k">Treaties</span>
              <span>{world.treaties.length}</span>
              <span className="k">Active agents</span>
              <span>{Object.keys(world.agents).length}</span>
              <span className="k">Admirals</span>
              <span>{Object.keys(world.admirals).length}</span>
              <span className="k">Galaxy</span>
              <span>
                {snap.galaxy.sectors} sectors · {snap.galaxy.systems} systems · {snap.galaxy.planets} planets
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
