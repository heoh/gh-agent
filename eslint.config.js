import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
]);
