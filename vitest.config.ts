import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 75,
        branches: 64,
        functions: 82,
        lines: 75,
      },
    },
  },
});
