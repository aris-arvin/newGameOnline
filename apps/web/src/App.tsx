import { useEffect, useRef, useState } from 'react';
import { newWorld, advance } from './engine';
import type { WorldState } from './engine';
import { localGameView } from './model';
import type { GameView } from './model';
import { LiveClient } from './net';
import { GalaxyView } from './views/GalaxyView';
import { EmpireView } from './views/EmpireView';
import { ShipLab } from './views/ShipLab';
import { MinePanel } from './views/MinePanel';

type Tab = 'galaxy' | 'empire' | 'mine' | 'lab';
type Mode = 'local' | 'live';

const DEFAULT_WS =
  typeof location !== 'undefined' ? `ws://${location.hostname || 'localhost'}:8787` : 'ws://localhost:8787';

const STATUS_LABEL: Record<string, string> = {
  disconnected: 'offline',
  connecting: 'connecting…',
  connected: 'live',
  error: 'error',
};

export function App() {
  const [mode, setMode] = useState<Mode>('local');
  const [tab, setTab] = useState<Tab>('galaxy');

  // --- Local sandbox ---
  const worldRef = useRef<WorldState>(newWorld(7));
  const [seedInput, setSeedInput] = useState(7);
  const [, bump] = useState(0);
  const rerender = () => bump((v) => v + 1);

  // --- Live client ---
  const clientRef = useRef<LiveClient | null>(null);
  if (!clientRef.current) clientRef.current = new LiveClient();
  const client = clientRef.current;
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);

  useEffect(() => client.subscribe(rerender), [client]);
  useEffect(() => {
    if (mode !== 'live') client.disconnect();
  }, [mode, client]);

  const step = (n: number) => {
    advance(worldRef.current, n);
    rerender();
  };
  const reset = () => {
    worldRef.current = newWorld(seedInput);
    rerender();
  };

  // Both modes converge on a single GameView; the views never learn which won.
  const view: GameView | null = mode === 'local' ? localGameView(worldRef.current) : client.view;

  const clock = view ? view.snapshot.time : 0;
  const season = view ? view.snapshot.season : 0;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          PURE GALAXY <small>vertical slice</small>
        </div>
        <nav className="tabs">
          <button className={tab === 'galaxy' ? 'active' : ''} onClick={() => setTab('galaxy')}>
            Galaxy
          </button>
          <button className={tab === 'empire' ? 'active' : ''} onClick={() => setTab('empire')}>
            Empires
          </button>
          {mode === 'live' && (
            <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
              My Empire
            </button>
          )}
          <button className={tab === 'lab' ? 'active' : ''} onClick={() => setTab('lab')}>
            Ship Lab
          </button>
        </nav>

        <div className="mode-toggle">
          <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>
            Local
          </button>
          <button
            className={mode === 'live' ? 'active' : ''}
            onClick={() => {
              setMode('live');
              if (tab === 'mine') setTab('galaxy');
            }}
          >
            Live
          </button>
        </div>
      </header>

      <div className="subbar">
        <span className="clock">t={clock}</span>
        <span className="season">S{season}</span>
        {mode === 'local' ? (
          <>
            <button className="btn" onClick={() => step(1)}>
              +1
            </button>
            <button className="btn" onClick={() => step(10)}>
              +10
            </button>
            <button className="btn" onClick={() => step(50)}>
              +50
            </button>
            <span className="muted">seed</span>
            <input
              className="seed"
              type="number"
              value={seedInput}
              onChange={(e) => setSeedInput(Number(e.target.value) || 0)}
            />
            <button className="btn" onClick={reset}>
              New
            </button>
          </>
        ) : (
          <>
            <input className="ws-url" type="text" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
            {client.status === 'connected' ? (
              <button className="btn" onClick={() => client.disconnect()}>
                Disconnect
              </button>
            ) : (
              <button className="btn primary" onClick={() => client.connect(wsUrl)}>
                Connect
              </button>
            )}
            <span className={`conn conn-${client.status}`}>{STATUS_LABEL[client.status] ?? client.status}</span>
            {client.empireId ? (
              <span className="badge">empire {client.empireId}</span>
            ) : client.status === 'connected' ? (
              <span className="badge muted">spectator</span>
            ) : null}
            {client.lastError && <span className="bad">{client.lastError}</span>}
          </>
        )}
      </div>

      <main>
        {!view ? (
          <div className="panel">
            <h3>Not connected</h3>
            <p className="muted">
              Start the server (<code>pnpm --filter @pure-galaxy/server run serve</code>) and press Connect to join a
              live galaxy, or switch to Local to run the simulation in your browser.
            </p>
          </div>
        ) : (
          <>
            {tab === 'galaxy' && (
              <GalaxyView galaxy={view.galaxy} ownership={view.ownership} empires={view.empires} />
            )}
            {tab === 'empire' && (
              <EmpireView snapshot={view.snapshot} society={view.society} empires={view.empires} />
            )}
            {tab === 'mine' && mode === 'live' && (
              <MinePanel mine={view.mine} acks={client.acks} onCommand={(n, a) => client.sendCommand(n, a)} />
            )}
            {tab === 'lab' && <ShipLab />}
          </>
        )}
      </main>

      {view && view.events.length > 0 && (
        <footer className="events">
          <span className="events-label">Feed</span>
          {view.events.slice(-6).map((e, i) => (
            <span key={i} className={`event event-${e.kind}`}>
              <span className="event-time">t{e.time}</span> {e.text}
            </span>
          ))}
        </footer>
      )}
    </div>
  );
}
