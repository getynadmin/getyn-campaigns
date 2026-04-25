import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config — Node environment (we only have backend/pure logic
 * tests in Phase 1). Path alias mirrors tsconfig so tests can import
 * the same `@/...` paths as the app.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
