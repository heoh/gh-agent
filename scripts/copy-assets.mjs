import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');
const sourceFile = path.join(projectRoot, 'src', 'core', 'default-agents.md');
const targetDir = path.join(projectRoot, 'dist', 'core');
const targetFile = path.join(targetDir, 'default-agents.md');

await mkdir(targetDir, { recursive: true });
await cp(sourceFile, targetFile, { force: true });
