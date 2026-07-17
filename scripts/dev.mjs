#!/usr/bin/env node
/**
 * One-command local dev: runs the authoritative server and the Vite web client
 * together, prefixes their output, and shuts both down cleanly on Ctrl-C.
 * Dependency-free — just Node's child_process.
 *
 *   pnpm dev
 *
 * The web dev server proxies /auth to the game server, so the whole thing is
 * same-origin in the browser (the HTTP-only refresh cookie works over plain
 * localhost). Open the printed Vite URL, switch to "Live", and register.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const PORT = process.env.PORT ?? '8787';
const TICK_MS = process.env.TICK_MS ?? '2000';

const procs = [
  {
    name: 'server',
    color: '\x1b[36m', // cyan
    cmd: 'pnpm',
    args: ['--filter', '@pure-galaxy/server', 'run', 'serve'],
    env: { ...process.env, PORT, TICK_MS },
  },
  {
    name: 'web',
    color: '\x1b[35m', // magenta
    cmd: 'pnpm',
    args: ['--filter', '@pure-galaxy/web', 'run', 'dev'],
    env: process.env,
  },
];

const RESET = '\x1b[0m';
const children = [];
let shuttingDown = false;

function prefix(name, color, stream, sink) {
  const rl = createInterface({ input: stream });
  rl.on('line', (line) => sink.write(`${color}[${name}]${RESET} ${line}\n`));
}

for (const p of procs) {
  // `detached` puts each child in its own process group so we can signal the
  // whole tree (pnpm → tsx/vite), not just the pnpm wrapper — otherwise the
  // real server/Vite would be orphaned on Ctrl-C.
  const child = spawn(p.cmd, p.args, { env: p.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(child);
  prefix(p.name, p.color, child.stdout, process.stdout);
  prefix(p.name, p.color, child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`${p.color}[${p.name}]${RESET} exited with code ${code} — stopping the other process`);
    shutdown(code ?? 1);
  });
}

function killGroup(child, signal) {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, signal); // negative pid → the whole process group
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) killGroup(c, 'SIGINT');
  // Give children a moment to flush/checkpoint, then force-exit.
  setTimeout(() => {
    for (const c of children) killGroup(c, 'SIGKILL');
    process.exit(code);
  }, 1500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting PURE GALAXY locally…');
console.log(`  server → http://localhost:${PORT}  (tick ${TICK_MS}ms)`);
console.log('  web    → Vite will print its URL below; open it and switch to "Live".\n');
