import { defineConfig } from 'vitest/config';

// Tests for the main-process code (data sources, sign-in, settings). Kept
// separate from vite.config.ts, which builds the dashboard page.
export default defineConfig({
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
