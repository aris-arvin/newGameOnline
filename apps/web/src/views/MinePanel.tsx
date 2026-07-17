import { useState } from 'react';
import type { MineView } from '../model';
import type { Ack } from '../net';

const GOVERNOR_PLANS = ['balanced', 'industry', 'science', 'breadbasket', 'fortress'];

/**
 * The live-mode command console: it renders the player's private "mine" view
 * and turns UI intents into validated commands sent to the authoritative
 * server. It never mutates state directly — every button is a request, and the
 * ack log shows the server's verdict.
 */
export function MinePanel({
  mine,
  acks,
  onCommand,
}: {
  mine: MineView | null;
  acks: Ack[];
  onCommand: (name: string, args?: Record<string, unknown>) => void;
}) {
  const [physics, setPhysics] = useState(50);
  const [economics, setEconomics] = useState(50);

  if (!mine) {
    return (
      <div className="panel">
        <h3>My Empire</h3>
        <p className="muted">
          Spectating — no empire claimed. Every playable slot may already be taken; commands are unavailable.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 340px' }}>
      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="panel">
          <h3>
            {mine.name} <span className="muted">({mine.empireId})</span>
          </h3>
          <div className="kv">
            <span className="k">Credits</span>
            <span>{mine.credits.toLocaleString()} cr</span>
            <span className="k">Focus</span>
            <span>{mine.focus}</span>
            <span className="k">Techs</span>
            <span>{mine.unlockedTechs.length}</span>
            <span className="k">Agents</span>
            <span>{mine.agents}</span>
            <span className="k">Admirals</span>
            <span>{mine.admirals}</span>
            <span className="k">Expeditions</span>
            <span>{mine.expeditionsDone}/5</span>
          </div>
          <div className="treasury">
            {Object.entries(mine.treasury).map(([k, v]) => (
              <span key={k} className="pill">
                {k} {Math.round(v)}
              </span>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Colonies ({mine.colonies.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Colony</th>
                <th className="num">Pop</th>
                <th>Regions</th>
                <th>Governor</th>
              </tr>
            </thead>
            <tbody>
              {mine.colonies.map((c) => (
                <tr key={c.id}>
                  <td>{c.planet}</td>
                  <td className="num">{c.population}</td>
                  <td className="muted">
                    {c.regions
                      .filter((r) => r.spec !== 'empty')
                      .map((r) => `${r.spec}·${r.level}`)
                      .join(' ') || '—'}
                  </td>
                  <td>
                    <select
                      className="seed"
                      value={GOVERNOR_PLANS.includes(c.governor) ? c.governor : 'balanced'}
                      onChange={(e) => onCommand('set_governor', { colonyId: c.id, plan: e.target.value })}
                    >
                      {GOVERNOR_PLANS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3>Fleets ({mine.fleets.length})</h3>
          {mine.fleets.length === 0 ? (
            <p className="muted">No standing fleets.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fleet</th>
                  <th>System</th>
                  <th className="num">Ships</th>
                  <th>Order</th>
                </tr>
              </thead>
              <tbody>
                {mine.fleets.map((f) => (
                  <tr key={f.id}>
                    <td>{f.id}</td>
                    <td>{f.systemId}</td>
                    <td className="num">{f.ships}</td>
                    <td className="muted">{f.order ?? 'idle'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="panel">
          <h3>Research</h3>
          <div className="slider-row">
            <label>Physics {physics}</label>
            <input type="range" min={0} max={100} value={physics} onChange={(e) => setPhysics(Number(e.target.value))} />
          </div>
          <div className="slider-row">
            <label>Economics {economics}</label>
            <input type="range" min={0} max={100} value={economics} onChange={(e) => setEconomics(Number(e.target.value))} />
          </div>
          <button className="btn primary" onClick={() => onCommand('set_research', { physics, economics })}>
            Set sliders
          </button>
          <div className="treasury" style={{ marginTop: 10 }}>
            {Object.entries(mine.research).map(([k, v]) => (
              <span key={k} className="pill">
                {k} {Math.round(v)}
              </span>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Orders</h3>
          <div className="cmd-buttons">
            <button className="btn primary" onClick={() => onCommand('colonize')}>
              Colonize nearest
            </button>
            <button className="btn primary" onClick={() => onCommand('dispatch_expedition')}>
              Dispatch expedition
            </button>
            <button className="btn primary" onClick={() => onCommand('recruit_admiral')}>
              Recruit admiral
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>Command log</h3>
          {acks.length === 0 ? (
            <p className="muted">No commands issued yet.</p>
          ) : (
            <ul className="ack-log">
              {[...acks].reverse().map((a, i) => (
                <li key={i} className={a.ok ? 'good' : 'bad'}>
                  <b>{a.name}</b> — {a.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
