import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict CSP for the packaged app. Skipped in dev because the React
// fast-refresh preamble is an inline script.
const csp: Plugin = {
  name: 'hub-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  plugins: [react(), csp],
  root: 'src/renderer',
  // Relative paths so the built page loads from file:// inside Electron.
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
