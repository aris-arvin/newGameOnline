import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Allow importing engine source + JSON data from the monorepo packages.
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

// Proxy the auth REST endpoints to the game server so, from the browser's point
// of view, /auth is same-origin. That lets the HTTP-only refresh cookie flow
// without cross-site cookies (which need SameSite=None+Secure, i.e. HTTPS) —
// mirroring a production reverse-proxy setup. Applies to both `dev` and
// `preview`. Point at another server with SERVER_ORIGIN if needed.
const serverOrigin = process.env.SERVER_ORIGIN || 'http://localhost:8787';
const proxy = { '/auth': { target: serverOrigin, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [workspaceRoot] }, proxy },
  preview: { proxy },
  base: './',
});
