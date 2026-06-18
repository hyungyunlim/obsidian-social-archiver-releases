import { defineConfig } from 'vitest/config';

/**
 * Vitest for @social-archiver/cli-core. Pure TypeScript — no DOM, no Obsidian,
 * no Tauri. Tests import from ./src directly.
 */
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    globals: false,
    include: ['__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
