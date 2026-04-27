import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cacheDir = path.resolve('.cache/npm');
mkdirSync(cacheDir, { recursive: true });

const result = spawnSync('npm', ['pack', '--dry-run'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_cache: cacheDir,
    NPM_CONFIG_CACHE: cacheDir,
  },
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error instanceof Error) {
  console.error(result.error.message);
}

process.exit(1);
