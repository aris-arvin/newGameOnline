/**
 * Run the authoritative PURE GALAXY server.
 *
 *   PORT=8787 TICK_MS=2000 pnpm --filter @pure-galaxy/server run serve
 */
import { loadWorldData, nodeTacticalResolver } from '@pure-galaxy/world-core/node';
import { GameServer } from '../src/server.js';
import { FilePersistence } from '../src/persistence.js';
import { AccountStore, FileAccountPersistence } from '../src/auth.js';

const data = loadWorldData();
const resolver = nodeTacticalResolver();
const port = Number(process.env.PORT ?? 8787);
const tickMs = Number(process.env.TICK_MS ?? 2000);

const server = new GameServer({
  data,
  resolver,
  persistence: new FilePersistence('.data/world.json'),
  accounts: new AccountStore(new FileAccountPersistence('.data/accounts.json')),
  tickIntervalMs: tickMs,
  autoTick: true,
  autosaveEveryTicks: 10,
});

server.start(port).then((p) => {
  console.log(`PURE GALAXY server listening on http://localhost:${p}`);
  console.log(`  REST:  GET /health, GET /state`);
  console.log(`  auth:  POST /auth/register, POST /auth/login, GET /auth/me`);
  console.log(`  WS:    ws://localhost:${p}  (join {token}, command, ping)`);
  console.log(`  tick:  every ${tickMs}ms, autosaving to .data/{world,accounts}.json`);
});

process.on('SIGINT', () => {
  console.log('\nshutting down…');
  server.stop().then(() => process.exit(0));
});
