import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Allow importing engine source + JSON data from the monorepo packages.
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [workspaceRoot] } },
  base: './',
});
