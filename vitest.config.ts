import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 78,
        branches: 68,
        functions: 85,
        lines: 78,
      },
    },
  },
});
