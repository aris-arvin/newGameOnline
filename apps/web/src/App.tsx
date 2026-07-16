import { useRef, useState } from 'react';
import { newWorld, advance } from './engine';
import type { WorldState } from './engine';
import { GalaxyView } from './views/GalaxyView';
import { EmpireView } from './views/EmpireView';
import { ShipLab } from './views/ShipLab';

type Tab = 'galaxy' | 'empire' | 'lab';

export function App() {
  const worldRef = useRef<WorldState>(newWorld(7));
  const [seedInput, setSeedInput] = useState(7);
  const [tab, setTab] = useState<Tab>('galaxy');
  const [, bump] = useState(0);
  const rerender = () => bump((v) => v + 1);
  const world = worldRef.current;

  const step = (n: number) => {
    advance(world, n);
    rerender();
  };
  const reset = () => {
    worldRef.current = newWorld(seedInput);
    rerender();
  };

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
          <button className={tab === 'lab' ? 'active' : ''} onClick={() => setTab('lab')}>
            Ship Lab
          </button>
        </nav>
        <div className="controls">
          <span className="clock">t={world.time}</span>
          <span className="season">
            S{world.season.number}
            {world.season.status === 'ended' ? ' · ended' : ''}
          </span>
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
        </div>
      </header>
      <main>
        {tab === 'galaxy' && <GalaxyView world={world} />}
        {tab === 'empire' && <EmpireView world={world} />}
        {tab === 'lab' && <ShipLab />}
      </main>
    </div>
  );
}
