/**
 * Tiny client smoke test against a running server: joins an empire, issues a
 * command, and prints a few streamed snapshots. Start the server first, then:
 *
 *   URL=ws://localhost:8787 pnpm --filter @pure-galaxy/server run smoke
 */
import { WebSocket } from 'ws';
import type { ServerMessage } from '../src/protocol.js';

const url = process.env.URL ?? 'ws://localhost:8787';
const ws = new WebSocket(url);
let snapshots = 0;

ws.on('open', () => ws.send(JSON.stringify({ type: 'join' })));

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString()) as ServerMessage;
  if (m.type === 'welcome') {
    console.log(`joined as ${m.empireId ?? 'spectator'} (season ${m.season}, t${m.tick})`);
    ws.send(JSON.stringify({ type: 'command', name: 'dispatch_expedition' }));
    ws.send(JSON.stringify({ type: 'command', name: 'colonize' }));
  } else if (m.type === 'ack') {
    console.log(`ack ${m.name}: ${m.ok ? 'OK' : 'NO'} — ${m.message}`);
  } else if (m.type === 'event') {
    console.log(`  [t${m.time}] ${m.kind}: ${m.text}`);
  } else if (m.type === 'snapshot') {
    const top = m.public.standings[0];
    console.log(`t=${m.tick}  leader ${top?.empire} (rating ${top?.rating})  my credits ${m.mine?.credits ?? '—'}`);
    if (++snapshots >= 3) {
      ws.close();
      process.exit(0);
    }
  }
});

ws.on('error', (e) => {
  console.error('connection error:', (e as Error).message);
  process.exit(1);
});
